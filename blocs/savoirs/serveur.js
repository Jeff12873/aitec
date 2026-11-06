// Le savoir-faire ajouté depuis l'assistant : une expérience écrite, ou la correction d'une réponse de l'IA,
// avec les machines concernées et la personne (de la GMAO) qui le dit.
//
// N'importe quel agent peut en ajouter, même en consultation : l'IA s'en sert dès la question suivante (choix du
// site : pas de validation). L'administrateur peut en supprimer. Les documents déposés depuis l'assistant passent
// par le bloc « documents » (en-tête X-Contribution).

import { db, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { reglagesPoste } from 'ktec/installation.js'
import { ajouterPassages, supprimerPassages } from '../recherche/passages.js'

const TEXTE_MAX = 8000

// Les personnes connues de la GMAO : les intervenants de l'historique. Une intervention à plusieurs en cite
// plusieurs à la suite (« NOM, PRÉNOM, NOM, PRÉNOM ») : on les reprend deux par deux ; les comptes de service
// (« COMPTE FONCTION … ») ne sont pas des personnes.
export function personnesGmao() {
  const personnes = new Set()
  for (const { nom } of db().prepare("SELECT DISTINCT intervenant AS nom FROM interventions WHERE trim(intervenant) <> ''").all()) {
    const morceaux = nom.split(',').map((x) => x.trim()).filter(Boolean)
    for (let i = 0; i < morceaux.length; i++) {
      if (/^compte\b/i.test(morceaux[i])) continue
      if (i + 1 < morceaux.length && !/^compte\b/i.test(morceaux[i + 1])) personnes.add(`${morceaux[i]}, ${morceaux[++i]}`)
      else personnes.add(morceaux[i])
    }
  }
  return [...personnes].sort((a, b) => a.localeCompare(b, 'fr'))
}

const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '')

function lireSavoir(id) {
  const s = db().prepare('SELECT * FROM savoirs WHERE id = ?').get(id)
  if (!s) return null
  const ids = JSON.parse(s.machines || '[]')
  const machines = ids.length ? db().prepare(`SELECT id, repere, designation FROM machines WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []
  return { ...s, machines }
}

// Le texte que la recherche retrouve : qui, quand, sur quoi, puis l'expérience elle-même.
function texteDuSavoir(s) {
  const reperes = s.machines.map((m) => m.repere).join(', ')
  return [
    `Retour d'expérience de ${s.auteur} (${dateFr(s.cree_le)})${reperes ? ` — machines : ${reperes}` : ''}`,
    s.situation ? `Situation : ${s.situation}` : '',
    s.genre === 'correction' && s.question ? `Question posée à l'assistant : ${s.question}` : '',
    s.texte,
  ].filter(Boolean).join('\n')
}

// Un jeu de passages par machine (une recherche limitée à l'une d'elles doit le trouver), ou un seul sans machine.
function indexer(s) {
  supprimerPassages('savoir', s.id)
  const texte = texteDuSavoir(s)
  for (const machineId of s.machines.length ? s.machines.map((m) => m.id) : [null]) ajouterPassages('savoir', s.id, machineId, [{ page: null, texte }])
}

export function titreSavoir(id) {
  const s = lireSavoir(id)
  if (!s) return 'Retour d’expérience supprimé'
  const reperes = s.machines.map((m) => m.repere).join(', ')
  return `Retour d’expérience — ${s.auteur}, le ${dateFr(s.cree_le)}${reperes ? ` — ${reperes}` : ''}`
}

export function routes(r) {
  r.get('/api/savoirs/personnes', () => personnesGmao())

  r.get('/api/savoirs', () => db().prepare('SELECT id FROM savoirs ORDER BY id DESC LIMIT 300').all().map((x) => lireSavoir(x.id)))

  r.get('/api/savoirs/:id', (ctx) => {
    const s = lireSavoir(Number(ctx.params.id))
    if (!s) throw new ErreurHttp(404, 'Retour d’expérience introuvable')
    return s
  })

  // { genre, situation, texte, auteur, machines: [id], question?, reponse? }
  r.post('/api/savoirs', async (ctx) => {
    exigerEcriture({ pourTous: true }) // tout agent peut transmettre son savoir, même en consultation
    const corps = await ctx.json()
    const texte = String(corps.texte || '').trim().slice(0, TEXTE_MAX)
    const auteur = String(corps.auteur || '').trim().slice(0, 120)
    if (!texte) throw new ErreurHttp(400, 'Écrivez ce qu’il faut savoir.')
    if (!auteur) throw new ErreurHttp(400, 'Dites qui le dit.')
    const personnes = personnesGmao()
    if (personnes.length && !personnes.includes(auteur)) throw new ErreurHttp(400, `« ${auteur} » n’est pas une personne connue de la GMAO : choisissez-la dans la liste.`)
    const ids = (Array.isArray(corps.machines) ? corps.machines : []).map(Number).filter(Boolean)
    const connues = ids.length ? db().prepare(`SELECT id FROM machines WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((m) => m.id) : []
    const { lastInsertRowid } = db()
      .prepare('INSERT INTO savoirs (genre, situation, texte, auteur, machines, question, reponse, cree_le, poste) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(corps.genre === 'correction' ? 'correction' : 'experience', String(corps.situation || '').trim().slice(0, 500), texte, auteur, JSON.stringify(connues),
        String(corps.question || '').slice(0, 1000), String(corps.reponse || '').slice(0, 2000), new Date().toISOString(), reglagesPoste().nomAgent || '')
    const savoir = lireSavoir(Number(lastInsertRowid))
    indexer(savoir)
    noterModification()
    return savoir
  })

  r.delete('/api/savoirs/:id', (ctx) => {
    ctx.exigerAdmin()
    const id = Number(ctx.params.id)
    supprimerPassages('savoir', id)
    db().prepare('DELETE FROM savoirs WHERE id = ?').run(id)
    noterModification()
  })
}
