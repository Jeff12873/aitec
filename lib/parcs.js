// Les parcs machines : des groupes de racines de l'arborescence de la GMAO, réglés à la main dans Administration
// (ex. le parc « USINAGE » = la racine de production, celle de maintenance et une autre). Dans chaque parc, l'admin
// dit quelles racines sont la production (les fiches et les FI de niveau 1) et la maintenance (les pannes), et
// relie chaque machine de production à sa machine de maintenance.
// Une racine masquée disparaît de partout : ses machines ne comptent plus nulle part dans AITEC. Une racine ni
// rangée ni masquée va dans « Non classé », signalé à l'admin.
//
// Réglage « parcs » (fichier de connaissances) :
//   { groupes: [{ id, nom, production: [noeud], maintenance: [noeud], autres: [noeud] }],
//     masques: [noeud], liens: { idMachineProduction: idMachineMaintenance } }
// (noeud : l'identifiant d'une racine dans l'arborescence ; machines : les identifiants d'AITEC)

import { reglageJson, modifierReglage, noterModification } from './base.js'
import { lireArbres } from './arborescence.js'

export const NON_CLASSE = 'non-classe'
const ROLES = ['production', 'maintenance', 'autres']

export function reglagesParcs() {
  const r = reglageJson('parcs', null) || {}
  return {
    groupes: (Array.isArray(r.groupes) ? r.groupes : []).map((g) => ({ id: String(g.id), nom: String(g.nom || ''), ...Object.fromEntries(ROLES.map((role) => [role, (g[role] || []).map(String)])) })),
    masques: (r.masques || []).map(String),
    liens: Object.fromEntries(Object.entries(r.liens || {}).map(([p, m]) => [String(p), Number(m)]).filter(([, m]) => Number.isInteger(m))),
  }
}

// Enregistre les parcs (Administration) : une racine n'est rangée qu'une fois, et jamais masquée en même temps.
export function enregistrerParcs({ groupes = [], masques = [], liens = {} }) {
  const vues = new Set()
  const unique = (liste) => [...new Set((liste || []).map(String))].filter((n) => !vues.has(n) && vues.add(n))
  const propres = groupes
    .map((g, i) => ({ id: String(g.id || `parc-${Date.now()}-${i}`).replace(/[^\w-]/g, ''), nom: String(g.nom || '').trim().slice(0, 40), ...Object.fromEntries(ROLES.map((role) => [role, unique(g[role])])) }))
    .filter((g) => g.nom && g.id !== NON_CLASSE)
  const masquesPropres = unique(masques)
  const liensPropres = Object.fromEntries(Object.entries(liens || {}).map(([p, m]) => [String(Number(p)), Number(m)]).filter(([p, m]) => Number.isInteger(Number(p)) && Number.isInteger(m)))
  modifierReglage('parcs', JSON.stringify({ groupes: propres, masques: masquesPropres, liens: liensPropres }))
  noterModification()
  return reglagesParcs()
}

// Les machines masquées, connues depuis la dernière lecture (pour les requêtes qui ne peuvent pas attendre la base).
let masqueesConnues = new Set()
export const machinesMasquees = () => masqueesConnues

// Tout ce qu'il faut pour filtrer et afficher : { parcs, racines, masques, machinesMasquees } ou null (pas
// d'arborescence lisible). parcs : [{ id, nom, production, maintenance, autres (racines), machines (Set),
// machinesProduction, machinesMaintenance (Set) }], « Non classé » à la fin s'il reste des racines.
export async function lireParcs() {
  const a = await lireArbres().catch(() => null)
  if (!a) return null
  const r = reglagesParcs()
  const racines = a.racines.map((n) => ({ id: n.id, code: n.code, designation: n.desi, libelle: a.libelle(n), machines: a.sous(n), noeud: n }))
  const parId = new Map(racines.map((x) => [x.id, x]))
  const rangees = new Set([...r.masques, ...r.groupes.flatMap((g) => ROLES.flatMap((role) => g[role]))])
  const machinesDe = (liste) => new Set(liste.flatMap((id) => [...(parId.get(id)?.machines || [])]))
  const parcs = r.groupes.map((g) => {
    const roles = Object.fromEntries(ROLES.map((role) => [role, g[role].filter((id) => parId.has(id))]))
    return { id: g.id, nom: g.nom, ...roles, machines: machinesDe(ROLES.flatMap((role) => roles[role])), machinesProduction: machinesDe(roles.production), machinesMaintenance: machinesDe(roles.maintenance) }
  })
  const libres = racines.filter((x) => !rangees.has(x.id) && x.machines.size).map((x) => x.id)
  if (libres.length) parcs.push({ id: NON_CLASSE, nom: 'Non classé', production: [], maintenance: [], autres: libres, machines: machinesDe(libres), machinesProduction: new Set(), machinesMaintenance: new Set(), nonClasse: true })
  // Masquée : sous une racine masquée et sous aucune autre.
  const visibles = machinesDe(racines.filter((x) => !r.masques.includes(x.id)).map((x) => x.id))
  const masquees = new Set([...machinesDe(r.masques)].filter((id) => !visibles.has(id)))
  masqueesConnues = masquees
  return { parcs, racines, masques: r.masques.filter((id) => parId.has(id)), machinesMasquees: masquees, liens: r.liens, detail: (id) => (parId.get(id) ? a.detail(parId.get(id).noeud) : []) }
}

// Le périmètre d'un parc pour les requêtes : { ids } (les machines du parc) ou { exclus } (« Tous » : tout sauf
// les machines masquées). Sans arborescence : tout.
export async function perimetreParc(parc = '') {
  const p = await lireParcs()
  if (!p) return { ids: null, exclus: [] }
  const choisi = parc && p.parcs.find((x) => x.id === parc)
  if (choisi) return { ids: [...choisi.machines].filter((id) => !p.machinesMasquees.has(id)), exclus: [], parc: choisi.nom }
  return { ids: null, exclus: [...p.machinesMasquees] }
}

// « colonne IN (…) » ou « colonne NOT IN (…) » : les ids sont des entiers lus dans la base, écrits tels quels.
export function filtreMachines(p, colonne) {
  if (p?.ids) return `${colonne} IN (${p.ids.map(Number).filter(Number.isInteger).join(',') || 'NULL'})`
  if (p?.exclus?.length) return `(${colonne} IS NULL OR ${colonne} NOT IN (${p.exclus.map(Number).filter(Number.isInteger).join(',')}))`
  return '1'
}

// La liste pour le sélecteur : [{ id, nom, machines }] (sans les parcs vides).
export async function listeParcs() {
  const p = await lireParcs()
  if (!p) return []
  return p.parcs.map((x) => ({ id: x.id, nom: x.nom, machines: [...x.machines].filter((id) => !p.machinesMasquees.has(id)).length, nonClasse: Boolean(x.nonClasse) })).filter((x) => x.machines)
}

// Au démarrage : les machines masquées sont connues sans attendre qu'un écran demande les parcs.
setTimeout(() => lireParcs().catch(() => {}), 15_000).unref()
