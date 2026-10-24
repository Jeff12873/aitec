// Retrouver les passages qui répondent à une question.
//
// Deux recherches sont combinées :
//   - par mots-clés (SQLite FTS5) : trouve les références exactes (« 6205-2RS », « P-200 ») ;
//   - par le sens (vecteurs)      : trouve « surchauffe du moteur » quand la notice dit « température excessive ».
// Les deux classements sont fusionnés (méthode « RRF » : on additionne 1 / (60 + rang)).

import { db } from '../../lib/base.js'
import { etatPartage } from 'ktec/partage.js'
import { iaInstallee, vecteurs } from 'ktec/ia.js'

const MOTS_VIDES = new Set(
  `le la les l de des du d un une et ou à au aux en pour par sur sous dans avec sans est sont été être avoir ai as a ont
   quel quelle quels quelles comment combien pourquoi que qu qui quoi quand où ce cet cette ces il elle on je j tu nous vous
   ils elles mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs pas ne n plus moins y se s c fait faire faut
   peut peux dois doit the of and to is what how`.split(/\s+/),
)

export async function chercher(question, { machineId = null, limite = 8 } = {}) {
  const parMots = chercherParMots(question, machineId, 30)
  const parSens = await chercherParSens(question, machineId, 30)

  const scores = new Map()
  for (const liste of [parMots, parSens]) {
    liste.forEach((id, rang) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + rang)))
  }
  const classes = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  return varier(classes, limite).map(decrirePassage).filter(Boolean)
}

// Les fiches (machines, interventions) sont nombreuses et se ressemblent : sans limite,
// elles prendraient toute la place et les documents (notices, procédures) n'arriveraient jamais.
// On leur laisse au plus 60 % des places, sauf s'il n'y a pas assez de documents.
function varier(ids, limite) {
  const maxFiches = Math.ceil(limite * 0.6)
  const sources = new Map(db().prepare(`SELECT id, source FROM passages WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'})`).all(...ids).map((p) => [p.id, p.source]))
  const retenus = []
  const misDeCote = []
  let fiches = 0
  for (const id of ids) {
    if (retenus.length >= limite) break
    const estFiche = sources.get(id) !== 'document'
    if (estFiche && fiches >= maxFiches) {
      misDeCote.push(id)
      continue
    }
    if (estFiche) fiches++
    retenus.push(id)
  }
  return [...retenus, ...misDeCote].slice(0, limite)
}

// ---------------------------------------------------------------- par mots-clés

export function motsCles(texte) {
  return String(texte)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((mot) => mot.length >= 2 && !MOTS_VIDES.has(mot))
    .slice(0, 12)
}

function chercherParMots(question, machineId, limite) {
  const mots = motsCles(question)
  if (!mots.length) return []
  const requete = mots.map((mot) => `"${mot.replaceAll('"', '')}"*`).join(' OR ')
  const lignes = db()
    .prepare(
      `SELECT p.id FROM passages_mots m JOIN passages p ON p.id = m.rowid
       WHERE passages_mots MATCH ? AND p.source <> 'piece' ${filtreMachine(machineId)}
       ORDER BY m.rank LIMIT ?`,
    )
    .all(requete, ...listeMachines(machineId), limite)
  return lignes.map((l) => l.id)
}

// Note : les passages « piece » viennent d'une ancienne version (pièces de rechange, fonction retirée) : on les ignore.
// machineId : une machine, ou une liste (toutes les machines d'une ligne ou d'un sous-ensemble).
const listeMachines = (machineId) => (Array.isArray(machineId) ? machineId : machineId ? [machineId] : []).map(Number).filter(Boolean)
function filtreMachine(machineId) {
  const ids = listeMachines(machineId)
  if (!ids.length) return ''
  return `AND p.machine_id IN (${ids.map(() => '?').join(', ')})`
}

// ---------------------------------------------------------------- par le sens

// Les vecteurs sont gardés en mémoire (une grande liste de nombres) et rechargés quand la base change.
let memoire = { cle: null, ids: null, matrice: null, dimensions: 0 }

function chargerVecteurs() {
  const { nombre, dernier } = db().prepare("SELECT count(*) AS nombre, max(id) AS dernier FROM passages WHERE vecteur IS NOT NULL AND source <> 'piece'").get()
  const cle = `${etatPartage().version}-${nombre}-${dernier}`
  if (memoire.cle === cle) return memoire

  const lignes = db().prepare("SELECT id, vecteur FROM passages WHERE vecteur IS NOT NULL AND source <> 'piece'").all()
  const dimensions = lignes.length ? lignes[0].vecteur.byteLength / 4 : 0
  const ids = new Int32Array(lignes.length)
  const matrice = new Float32Array(lignes.length * dimensions)
  lignes.forEach((ligne, i) => {
    ids[i] = ligne.id
    matrice.set(new Float32Array(ligne.vecteur.buffer, ligne.vecteur.byteOffset, dimensions), i * dimensions)
  })
  memoire = { cle, ids, matrice, dimensions }
  return memoire
}

async function chercherParSens(question, machineId, limite) {
  if (!iaInstallee()) return []
  const { ids, matrice, dimensions } = chargerVecteurs()
  if (!ids.length) return []

  let autorises = null
  if (listeMachines(machineId).length) {
    autorises = new Set(
      db()
        .prepare(`SELECT p.id FROM passages p WHERE 1 ${filtreMachine(machineId)}`)
        .all(...listeMachines(machineId))
        .map((l) => l.id),
    )
  }

  const [requete] = await vecteurs([question], { question: true })
  const resultats = []
  for (let i = 0; i < ids.length; i++) {
    if (autorises && !autorises.has(ids[i])) continue
    let produit = 0
    const debut = i * dimensions
    for (let d = 0; d < dimensions; d++) produit += requete[d] * matrice[debut + d]
    resultats.push([ids[i], produit])
  }
  return resultats
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .filter(([, score]) => score > 0.25)
    .map(([id]) => id)
}

// ---------------------------------------------------------------- présentation

// Ajoute au passage un titre lisible et un lien vers sa source.
export function decrirePassage(id) {
  const p = db().prepare('SELECT * FROM passages WHERE id = ?').get(id)
  if (!p) return null
  let titre = ''
  let lien = ''
  if (p.source === 'document') {
    const d = db().prepare('SELECT nom FROM documents WHERE id = ?').get(p.source_id)
    titre = (d?.nom || 'Document supprimé') + (p.page ? ` — page ${p.page}` : '')
    lien = `/api/documents/${p.source_id}/fichier${p.page ? `#page=${p.page}` : ''}`
  } else if (p.source === 'machine') {
    const m = db().prepare('SELECT repere, designation FROM machines WHERE id = ?').get(p.source_id)
    titre = `Fiche machine ${m?.repere || ''} — ${m?.designation || ''}`
    lien = `#/parc/${p.source_id}`
  } else if (p.source === 'intervention') {
    const i = db()
      .prepare('SELECT i.date, i.numero, m.repere FROM interventions i LEFT JOIN machines m ON m.id = i.machine_id WHERE i.id = ?')
      .get(p.source_id)
    titre = `Intervention ${i?.numero || ''} du ${dateFr(i?.date)}${i?.repere ? ' — ' + i.repere : ''}`
    lien = `#/interventions/${p.source_id}`
  }
  return { id: p.id, source: p.source, sourceId: p.source_id, page: p.page, titre, lien, texte: p.texte }
}

function dateFr(date) {
  if (!date) return '?'
  const [a, m, j] = date.split('-')
  return `${j}/${m}/${a}`
}
