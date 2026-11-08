// Ce que l'administrateur règle pour tout le site, gardé dans le fichier de connaissances : l'affichage de « Ma ligne »
// (réglage « prev_affichage ») et les étiquettes du préventif (réglage « prev_etiquettes »).
//
// Une étiquette dit à quoi sert une intervention, et dans quels écrans elle compte. Les étiquettes de base s'attribuent
// seules (visites.js) ; celles que l'on crée s'attribuent à la main, dans la liste « Préventif & entretiens ». Une
// étiquette de rôle « panne » compte toujours comme panne, partout.

import { reglageJson, modifierReglage, noterModification } from '../../lib/base.js'

export const ECRANS = ['verdict', 'indicateurs', 'tableau', 'demonstrateur']
const SEUL = (...e) => Object.fromEntries(ECRANS.map((x) => [x, e.includes(x)]))

const DE_BASE = [
  { id: 'observation', nom: 'Observation', role: 'visite', interet: 'On regarde l’état pour voir venir la panne.', ecrans: SEUL('verdict', 'indicateurs', 'tableau', 'demonstrateur') },
  { id: 'systematique', nom: 'Systématique', role: 'visite', interet: 'On renouvelle à date fixe, sans regarder l’état.', ecrans: SEUL('indicateurs') },
  { id: 'remontee', nom: 'Correctif issu de Niveau 1', role: 'visite', interet: 'Ce qu’un conducteur a remarqué, traité à la suite d’une demande de niveau 1.', ecrans: SEUL() },
  { id: 'ponctuel', nom: 'Entretien ponctuel', role: 'visite', interet: 'Fait une fois, sans fréquence.', ecrans: SEUL() },
  { id: 'correctif', nom: 'Correctif', role: 'panne', interet: 'Une panne réparée.', ecrans: SEUL(...ECRANS) },
]

const propre = (e) => ({ nom: String(e.nom || '').trim().slice(0, 40), interet: String(e.interet || '').trim().slice(0, 160), ecrans: Object.fromEntries(ECRANS.map((x) => [x, Boolean(e.ecrans?.[x])])) })

// Les étiquettes de base (avec leurs corrections), puis celles du site.
export function etiquettes() {
  const r = reglageJson('prev_etiquettes', null) || {}
  const base = DE_BASE.map((e) => {
    const c = r.base?.[e.id]
    return { ...e, base: true, nom: c?.nom || e.nom, interet: c?.interet ?? e.interet, ecrans: e.role === 'panne' ? e.ecrans : c?.ecrans || e.ecrans }
  })
  return [...base, ...(r.autres || []).map((e) => ({ ...e, role: 'visite', base: false }))]
}

// liste : [{ id, nom, interet, ecrans }] ; sans id, ou avec un id inconnu, une nouvelle étiquette ; une étiquette du
// site absente de la liste disparaît (ses interventions reviennent à leur première idée).
export function enregistrerEtiquettes(liste = []) {
  const ids = new Set(DE_BASE.map((e) => e.id))
  const base = {}
  const autres = []
  let n = Date.now()
  for (const e of liste) {
    const p = propre(e)
    if (!p.nom) continue
    if (ids.has(e.id)) base[e.id] = p
    else autres.push({ id: /^e\d+$/.test(e.id || '') ? e.id : `e${n++}`, ...p })
  }
  modifierReglage('prev_etiquettes', { base, autres })
  noterModification()
  return etiquettes()
}

// ---------------------------------------------------------------- l'affichage de « Ma ligne »

export const INDICATEURS = ['pannes', 'heures', 'preventif', 'tmcd', 'concentration']
export const VARIABLES_CARRE = ['pannes', 'visites', 'aRegarder', 'evolution', 'heures', 'ratio']
const PAR_DEFAUT = { indicateurs: INDICATEURS, panneau: 'demonstrateur', carres: ['pannes', 'visites', 'aRegarder'], nomCarres: 'repere', nomsEth: {} }

export function affichage() {
  const r = reglageJson('prev_affichage', null) || {}
  const dans = (liste, connus, defaut) => (Array.isArray(liste) ? liste.filter((x) => connus.includes(x)) : defaut)
  return {
    indicateurs: dans(r.indicateurs, INDICATEURS, PAR_DEFAUT.indicateurs),
    panneau: r.panneau === 'pareto' ? 'pareto' : PAR_DEFAUT.panneau,
    carres: dans(r.carres, VARIABLES_CARRE, PAR_DEFAUT.carres),
    nomCarres: r.nomCarres === 'designation' ? 'designation' : PAR_DEFAUT.nomCarres,
    nomsEth: r.nomsEth && typeof r.nomsEth === 'object' ? r.nomsEth : {},
  }
}

export function enregistrerAffichage(x = {}) {
  const nomsEth = Object.fromEntries(Object.entries(x.nomsEth || {}).map(([k, v]) => [k, String(v || '').trim().slice(0, 30)]).filter(([, v]) => v))
  modifierReglage('prev_affichage', { indicateurs: x.indicateurs, panneau: x.panneau, carres: x.carres, nomCarres: x.nomCarres, nomsEth })
  noterModification()
  return affichage()
}
