// Les deux premiers niveaux de l'arborescence des machines (ligne › sous-ensemble), avec les machines d'AITEC
// rangées dessous. L'arbre vient de la requête réglée dans PDRTec (même fichier de connaissances) ; sans elle,
// ou sans connexion à la base : null (on garde la simple liste des machines).
// La GMAO peut tenir plusieurs arborescences (maintenance, bâtiments…) : si la requête donne une colonne
// « arbre » (le nom de l'arborescence), on n'en garde qu'une, choisie dans Administration ; par défaut celle
// qui range le plus de machines d'AITEC.
// Sert à l'assistant (machine concernée), à l'analyse des pannes connues et au tableau de bord.

import { db, reglage, reglageJson } from './base.js'
import { lireInfo } from 'ktec/ktec.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { etatPartage } from 'ktec/partage.js'

// L'arborescence lue dans la base est gardée 10 minutes (et jusqu'au prochain changement du fichier de
// connaissances : les machines ont pu être synchronisées) : tous les écrans filtrent par parc.
let cache = { cle: null, date: 0, promesse: null }
const DUREE_CACHE = 10 * 60_000

// Lit toute l'arborescence : les arborescences présentes (si la requête donne la colonne « arbre »),
// leurs racines, et de quoi en faire des lignes { id, libelle, machines, enfants }.
export function lireArbres() {
  const sql = lireInfo('pdrtec.arborescence', null)?.arbre
  if (!sql || !etatConnexion().ouverte) return Promise.resolve(null)
  const cle = `${sql}|${etatPartage().version}`
  if (cache.cle !== cle || Date.now() - cache.date > DUREE_CACHE) {
    cache = { cle, date: Date.now(), promesse: lireArbresDansLaBase(sql) }
    cache.promesse.catch(() => (cache = { cle: null, date: 0, promesse: null }))
  }
  return cache.promesse
}

async function lireArbresDansLaBase(sql) {
  const r2 = await executerRequete(sql.replace(/--[^\n]*/g, ''), 1_000_000)
  const i = (nom) => r2.colonnes.findIndex((c) => c.nom.toLowerCase() === nom)
  const [iN, iP, iC, iD, iO, iA] = ['noeud', 'parent', 'code', 'designation', 'ordre', 'arbre'].map(i)
  if (iN < 0 || iP < 0 || iC < 0) return null
  const noeuds = new Map(r2.lignes.map((l) => [String(l[iN]), { id: String(l[iN]), parent: String(l[iP] ?? ''), code: String(l[iC] ?? '').trim(), desi: String(l[iD] ?? '').trim(), ordre: Number(l[iO]) || 0, arbre: iA < 0 ? '' : String(l[iA] ?? '').trim(), enfants: [] }]))
  for (const n of noeuds.values()) noeuds.get(n.parent)?.enfants.push(n)
  const parRepere = new Map(db().prepare('SELECT id, repere FROM machines').all().map((m) => [String(m.repere).trim(), m.id]))
  // Toutes les machines d'AITEC sous un nœud (lui compris).
  const sous = (n, acc = new Set()) => { const id = parRepere.get(n.code); if (id) acc.add(id); n.enfants.forEach((e) => sous(e, acc)); return acc }
  const libelle = (n) => (n.desi && n.desi !== n.code ? `${n.code} (${n.desi})` : n.code)
  const tri = (a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code, 'fr', { numeric: true })
  // Les lignes : les vraies racines (sans parent) ; une machine dont le parent n'est plus actif n'en est pas une.
  const racines = [...noeuds.values()].filter((n) => !n.parent || n.parent === '0' || n.parent === 'null')
  // Les nœuds sous une racine, à plat : { noeud, code, designation, niveau, eth, machine } (machine : l'id AITEC).
  const detail = (racine) => {
    const liste = []
    const parcourir = (n, niveau, eth) => {
      liste.push({ noeud: n.id, code: n.code, designation: n.desi, niveau, eth, machine: parRepere.get(n.code) ?? null })
      n.enfants.sort(tri).forEach((e) => parcourir(e, niveau + 1, niveau === 1 ? e.code : eth))
    }
    parcourir(racine, 1, '')
    return liste
  }
  const lignesDe = (liste) => [...liste].sort(tri)
    .map((n) => ({ id: n.id, code: n.code, libelle: libelle(n), arbre: n.arbre, machines: [...sous(n)], enfants: n.enfants.sort(tri).map((e) => ({ id: e.id, libelle: libelle(e), machines: [...sous(e)] })).filter((e) => e.machines.length) }))
    .filter((n) => n.machines.length)
  if (iA < 0) return { avecArbres: false, arbres: [], racines, lignesDe, detail, sous, libelle, parArbre: new Map() }
  // Un nœud sans arborescence (racine orpheline) n'est proposé dans aucune.
  const parArbre = new Map()
  for (const n of racines) parArbre.set(n.arbre, [...(parArbre.get(n.arbre) || []), n])
  const arbres = [...parArbre].map(([nom, liste]) => ({ nom, machines: new Set(liste.flatMap((n) => [...sous(n)])).size })).filter((a) => a.nom && a.machines).sort((a, b) => b.machines - a.machines)
  return { avecArbres: true, arbres, racines, lignesDe, detail, sous, libelle, parArbre }
}

// Pour l'assistant : une seule arborescence, choisie dans Administration (par défaut la plus fournie).
export async function lireArborescence() {
  const a = await lireArbres()
  if (!a) return null
  if (!a.avecArbres) return { arbres: [], arbre: '', lignes: a.lignesDe(a.racines) }
  const voulu = reglage('arborescence_machines', '')
  const arbre = voulu && a.arbres.some((x) => x.nom === voulu) ? voulu : a.arbres[0]?.nom || ''
  return { arbres: a.arbres, arbre, lignes: a.lignesDe(a.parArbre.get(arbre) || []) }
}

// Pour le tableau de bord : plusieurs arborescences à la fois (production et maintenance, par exemple),
// choisies dans Administration ; par défaut celle de l'assistant.
export async function lireArborescencesTableau() {
  const a = await lireArbres()
  if (!a) return null
  if (!a.avecArbres) return { arbres: [], choisies: [], lignes: a.lignesDe(a.racines) }
  let choisies = (reglageJson('arborescences_tableau', []) || []).filter((nom) => a.arbres.some((x) => x.nom === nom))
  if (!choisies.length) {
    const voulu = reglage('arborescence_machines', '')
    choisies = [voulu && a.arbres.some((x) => x.nom === voulu) ? voulu : a.arbres[0]?.nom].filter(Boolean)
  }
  return { arbres: a.arbres, choisies, lignes: choisies.flatMap((nom) => a.lignesDe(a.parArbre.get(nom) || [])) }
}

// Les nœuds sous une ligne (trouvée par son code ou son libellé, dans toutes les arborescences) : pour choisir
// l'équipement d'une fiche à créer dans la GMAO. [{ id (le nœud, ID de l'arborescence), code, designation, niveau }]
export async function equipementsDeLaLigne(ligne) {
  const a = await lireArbres()
  if (!a) return []
  const voulu = String(ligne || '').trim().toLowerCase()
  const libelle = (n) => (n.desi && n.desi !== n.code ? `${n.code} (${n.desi})` : n.code)
  const racines = a.racines.filter((n) => n.code.toLowerCase() === voulu || libelle(n).toLowerCase() === voulu)
  const liste = []
  const parcourir = (n, niveau) => {
    liste.push({ id: n.id, code: n.code, designation: n.desi, niveau, arbre: n.arbre })
    n.enfants.forEach((e) => parcourir(e, niveau + 1))
  }
  racines.forEach((r) => parcourir(r, 1))
  return liste
}
