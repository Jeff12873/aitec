// Ce que PREVTEC (la porte « plan de maintenance » d'AITEC) ajoute aux écrans de la maintenance de niveau 1 : le fil
// des étapes, toujours en haut (1 Mon parc › 2 Son Pareto › 3 Une machine › 4 Je décide › 5 Je fais), et le verdict
// du plan de chaque parc (calculé par blocs/mn1/parcs.js, bilanPlan). Sur /aitec/, rien ne change.

import { h, ic } from '/socle/ui.js'
import { appli } from '/socle/api.js'

export const estPrevtec = appli === 'prevtec'

// Une machine du Pareto ou du nuage : dans PREVTEC, son démonstrateur (étape 3) ; dans AITEC, son analyse.
export const lienMachine = (parcId, machineId) => (estPrevtec && parcId ? `#/mn1/machine/${encodeURIComponent(parcId)}/${machineId}` : `#/analyse/${machineId}`)

export const VERDICTS = {
  bon: { texte: 'dans le bon sens', classe: 'vert', icone: 'coche' },
  surveiller: { texte: 'à surveiller', classe: 'orange', icone: 'alerte' },
  reevaluer: { texte: 'à réévaluer', classe: 'rouge', icone: 'alerte' },
}

// etape : 1 à 5 ; parc : { id, nom } quand on est dans un parc ; machine : { id, repere } sur son démonstrateur.
// L'étape 3 s'ouvre d'un clic sur une machine du Pareto ; l'étape 4 est le bas de la page de la machine.
export function filEtapes(etape, parc = null, machine = null) {
  const ETAPES = [
    [1, 'Mon parc', '#/mn1', 'Choisir le parc : une vignette par parc, avec le verdict de son plan'],
    [2, parc ? `Son Pareto · ${parc.nom}` : 'Son Pareto', parc ? `#/mn1/parc/${encodeURIComponent(parc.id)}` : null, 'Le verdict du plan et les pannes qui reviennent, avec leur évolution'],
    [3, machine ? `Une machine · ${machine.repere}` : 'Une machine', machine ? lienMachine(parc.id, machine.id) : null, 'Clic sur une machine du Pareto : ses pannes face à tous ses préventifs'],
    [4, 'Je décide', machine ? 'decisions' : null, 'Les décisions proposées pour la machine : une fiche N1, un point N2, espacer une gamme'],
    [5, 'Je fais', etape === 2 ? 'fiches' : parc ? `#/mn1/parc/${encodeURIComponent(parc.id)}` : null, 'Les fiches de niveau 1 du parc : créer la FI, imprimer'],
  ]
  return h('nav', { class: 'fil-etapes', 'aria-label': 'Étapes du plan de maintenance' }, ETAPES.map(([n, texte, cible, aide], i) => {
    const classe = `etape-fil${n === etape ? ' en-cours' : ''}${n < etape ? ' faite' : ''}${cible ? '' : ' muette'}`
    const contenu = [h('b', {}, String(n)), h('span', {}, texte)]
    const descendre = { fiches: '.carte-fiches-parc', decisions: '.carte-decisions' }[cible]
    const lien = descendre
      ? h('button', { class: classe, title: aide, onclick: () => document.querySelector(descendre)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, contenu)
      : cible ? h('a', { class: classe, href: cible, title: aide }, contenu) : h('span', { class: classe, title: aide }, contenu)
    return [i ? h('span', { class: 'sep-fil', 'aria-hidden': 'true' }, '›') : null, lien]
  }))
}

// La pastille du verdict (vignette d'un parc).
export function pastilleVerdict(plan) {
  const v = VERDICTS[plan?.verdict]
  return v ? h('span', { class: `etiquette ${v.classe} verdict-plan`, title: plan.raisons.join('\n') }, ic(v.icone, 13), `Plan ${v.texte}`) : null
}

// Le bandeau du verdict, en haut de la page du parc : le verdict, ses raisons, et les chiffres sur deux ans.
export function bandeauVerdict(plan) {
  const v = VERDICTS[plan?.verdict]
  if (!v) return null
  const fleche = (r, p) => (!p ? '' : r > p ? ' ↑' : r < p ? ' ↓' : ' =')
  return h('div', { class: `bandeau-verdict ${v.classe}` },
    h('div', { class: 'tete-verdict' }, ic(v.icone, 20), h('b', {}, `Plan de maintenance ${v.texte}`)),
    h('ul', {}, plan.raisons.map((r) => h('li', {}, r))),
    h('div', { class: 'chiffres-verdict' },
      h('span', { title: 'Correctifs des 12 derniers mois, et des 12 mois d’avant' }, h('b', {}, `${plan.correctifs.recent}${fleche(plan.correctifs.recent, plan.correctifs.precedent)}`), ` pannes sur 12 mois (avant : ${plan.correctifs.precedent})`),
      h('span', { title: 'Interventions préventives des 12 derniers mois (niveau 1 et techniciens), et des 12 mois d’avant' }, h('b', {}, `${plan.preventifs.recent}${fleche(plan.preventifs.recent, plan.preventifs.precedent)}`), ` préventifs sur 12 mois (avant : ${plan.preventifs.precedent})`)))
}

// L'évolution d'une panne du Pareto, en flèche : ses cas des 12 derniers mois face aux 12 d'avant.
export function evolutionPanne(p) {
  const E = { monte: ['↑', 'rouge', 'monte'], nouvelle: ['✦', 'rouge', 'nouvelle'], baisse: ['↓', 'vert', 'baisse'], stable: ['=', '', 'stable'] }
  const [signe, classe, texte] = E[p.evolution] || E.stable
  return h('span', { class: `evolution-panne ${classe}`, title: `${p.nombre} cas ces 12 mois, ${p.precedent} les 12 mois d’avant` }, `${signe} ${texte}`, p.evolution === 'nouvelle' ? null : h('small', {}, ` (${p.precedent})`))
}
