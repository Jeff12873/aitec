// Ce que PREVTEC (la porte « plan de maintenance » d'AITEC) ajoute aux écrans : le fil des étapes, toujours en haut
// et centré (1 Mes lignes › 2 Ma ligne › 3 Une machine › 4 Je décide › 5 Niveau 1), le verdict du plan de chaque
// ligne et ses indicateurs (calculés par blocs/mn1/visites.js, bilanLigne). Sur /aitec/, rien ne change.
// Le niveau 1 n'arrive qu'à l'étape 5, après la décision : avant, on n'en parle pas (sauf le Hall of fame).

import { h, ic, nombreFr } from '/socle/ui.js'
import { appli } from '/socle/api.js'

export const estPrevtec = appli === 'prevtec'

// Une machine du Pareto ou du nuage : dans PREVTEC, son démonstrateur (étape 3) ; dans AITEC, son analyse.
export const lienMachine = (parcId, machineId) => (estPrevtec && parcId ? `#/mn1/machine/${encodeURIComponent(parcId)}/${machineId}` : `#/analyse/${machineId}`)

export const VERDICTS = {
  bon: { texte: 'dans le bon sens', classe: 'vert', icone: 'coche' },
  surveiller: { texte: 'à surveiller', classe: 'orange', icone: 'alerte' },
  reevaluer: { texte: 'à réévaluer', classe: 'rouge', icone: 'alerte' },
}

// etape : 1 à 5 ; parc : { id, nom } quand on est dans une ligne ; machine : { id, repere } sur son démonstrateur.
// L'étape 3 s'ouvre d'un clic sur une machine du Pareto ; l'étape 4 est le bas de la page de la machine.
export function filEtapes(etape, parc = null, machine = null) {
  const ETAPES = [
    [1, 'Mes lignes', '#/mn1', 'Choisir la ligne : une vignette par ligne, avec le verdict de son plan'],
    [2, parc ? `Ma ligne · ${parc.nom}` : 'Ma ligne', parc ? `#/mn1/parc/${encodeURIComponent(parc.id)}` : null, 'Le verdict du plan, les indicateurs et les pannes qui reviennent'],
    [3, machine ? `Une machine · ${machine.repere}` : 'Une machine', machine ? lienMachine(parc.id, machine.id) : null, 'Clic sur une machine du Pareto : ses pannes sont-elles regardées par une visite ?'],
    [4, 'Je décide', machine ? 'decisions' : null, 'Pour une panne sans visite, ou à revoir : une fiche N1 ou un point N2'],
    [5, 'Niveau 1', parc ? `#/mn1/n1/${encodeURIComponent(parc.id)}` : null, 'Les fiches de niveau 1 de la ligne : FI, cartes papier, charge des opérateurs, impression'],
  ]
  return h('nav', { class: 'fil-etapes', 'aria-label': 'Étapes du plan de maintenance' }, ETAPES.map(([n, texte, cible, aide], i) => {
    const classe = `etape-fil${n === etape ? ' en-cours' : ''}${n < etape ? ' faite' : ''}${cible ? '' : ' muette'}`
    const contenu = [h('b', {}, String(n)), h('span', {}, texte)]
    const descendre = { decisions: '.carte-decisions' }[cible]
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
      h('span', { title: 'Correctifs des 12 derniers mois terminés, et des 12 mois d’avant' }, h('b', {}, `${plan.correctifs.recent}${fleche(plan.correctifs.recent, plan.correctifs.precedent)}`), ` pannes sur 12 mois terminés (avant : ${plan.correctifs.precedent})`),
      h('span', { title: 'Visites du plan des 12 derniers mois terminés, et des 12 mois d’avant' }, h('b', {}, `${plan.preventifs.recent}${fleche(plan.preventifs.recent, plan.preventifs.precedent)}`), ` visites sur 12 mois terminés (avant : ${plan.preventifs.precedent})`)))
}

// L'évolution d'une panne du Pareto, en flèche : ses cas des 12 derniers mois face aux 12 d'avant.
export function evolutionPanne(p) {
  const E = { monte: ['↑', 'rouge', 'monte'], nouvelle: ['✦', 'rouge', 'nouvelle'], baisse: ['↓', 'vert', 'baisse'], stable: ['=', '', 'stable'] }
  const [signe, classe, texte] = E[p.evolution] || E.stable
  return h('span', { class: `evolution-panne ${classe}`, title: `${p.nombre} cas ces 12 mois, ${p.precedent} les 12 mois d’avant` }, `${signe} ${texte}`, p.evolution === 'nouvelle' ? null : h('small', {}, ` (${p.precedent})`))
}

// Les indicateurs de « Ma ligne » : pannes et heures de dépannage, part du préventif, concentration des pannes,
// sur les 12 derniers mois terminés face aux 12 d'avant. Chaque tuile se lit en phrase, sans question à se poser.
export function tuilesLigne(i, parc) {
  if (!i) return null
  const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`)
  const ecart = (r, p) => (p ? ` (${r >= p ? '+' : '−'}${Math.abs(Math.round(((r - p) / p) * 100))} %)` : '')
  const sens = (r, p, bon = 'baisse') => {
    if (r === null || p === null || r === undefined || p === undefined || r === p) return h('span', { class: 'sens-tuile' }, '=')
    const monte = r > p
    return h('span', { class: `sens-tuile ${(monte ? 'hausse' : 'baisse') === bon ? 'vert' : 'rouge'}`, title: (monte ? 'hausse' : 'baisse') === bon ? 'dans le bon sens' : 'dans le mauvais sens' }, monte ? '↑' : '↓')
  }
  const tuile = (titre, valeur, fleche, ...lignes) => h('div', { class: 'tuile-ligne' }, h('span', { class: 'titre-tuile' }, titre), h('div', { class: 'valeur-tuile' }, h('b', {}, valeur), fleche), lignes.filter(Boolean).map((l) => h('small', {}, l)))
  // La période, dite une fois : les 12 derniers mois terminés.
  const mois = (decalage) => new Date(new Date().getFullYear(), new Date().getMonth() - decalage, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
  const virgule = (x) => (Math.round(x * 10) / 10).toLocaleString('fr-FR')
  const hr = i.heures.recent
  const hp = i.heures.precedent
  const c = i.concentration
  return h('div', { class: 'bloc-tuiles-ligne' },
    h('p', { class: 'periode-tuiles discret' }, `Sur les 12 derniers mois terminés (${mois(12)} → ${mois(1)}), comparés aux 12 mois d’avant. Flèche verte : dans le bon sens.`),
    h('div', { class: 'tuiles-ligne' },
      tuile('Pannes · sur 12 mois', nombreFr(i.pannes.recent), sens(i.pannes.recent, i.pannes.precedent), `pannes, contre ${nombreFr(i.pannes.precedent)} sur les 12 mois d’avant${ecart(i.pannes.recent, i.pannes.precedent)}`),
      tuile('Temps passé à dépanner · sur 12 mois', `${nombreFr(hr.total)} h`, sens(hr.total, hp.total), `d’intervention, contre ${nombreFr(hp.total)} h sur les 12 mois d’avant${ecart(hr.total, hp.total)}`, hr.connues !== null && hr.connues < 0.95 ? `durée notée sur ${pct(hr.connues)} des pannes seulement` : null),
      tuile('Part du préventif · sur 12 mois', pct(i.preventif.recent), sens(i.preventif.recent, i.preventif.precedent, 'hausse'), `des interventions sont des visites, contre ${pct(i.preventif.precedent)} sur les 12 mois d’avant`, i.preventif.observation !== null ? `dont ${pct(i.preventif.observation)} de contrôles, le reste en remplacements à date fixe` : null),
      i.tmcd?.recent !== null && i.tmcd?.recent !== undefined ? tuile('Dépanneurs par panne · sur 12 mois', virgule(i.tmcd.recent), sens(Math.round(i.tmcd.recent * 10), i.tmcd.precedent === null ? null : Math.round(i.tmcd.precedent * 10)),
        `en moyenne sur une panne (TMCD), contre ${i.tmcd.precedent === null ? '—' : virgule(i.tmcd.precedent)} sur les 12 mois d’avant`,
        i.tmcd.nouveaux ? `${i.tmcd.nouveaux} dépanneur${i.tmcd.nouveaux > 1 ? 's' : ''} sur ${i.tmcd.depanneurs} n’avai${i.tmcd.nouveaux > 1 ? 'ent' : 't'} pas dépanné ici l’année d’avant` : null) : null,
      c.machines.length ? h('div', { class: 'tuile-ligne concentration' },
        h('span', { class: 'titre-tuile' }, 'Où sont les pannes · sur 12 mois'),
        h('div', { class: 'valeur-tuile' }, h('b', {}, pct(c.part))),
        h('small', {}, `des pannes viennent de ${c.machines.length} machines :`),
        h('div', { class: 'machines-tuile' }, c.machines.map((m) => h('a', { href: lienMachine(parc.id, m.id), title: `${m.designation || ''} : ouvrir l’étape 3` }, h('span', { class: 'mono' }, m.repere || '?'), h('small', {}, ` ${m.n} pannes`))))) : null),
    i.conventionReglee && i.horsConvention ? h('p', { class: 'hors-convention discret' }, ic('alerte', 13), `${nombreFr(i.horsConvention)} interventions préventives n’ont pas de code reconnu en tête du titre : elles ne comptent pas dans le plan.`) : null,
    !i.conventionReglee ? h('p', { class: 'hors-convention discret' }, ic('reglages', 13), 'Les préventifs ne sont pas encore reconnus par leur code (Administration › Lignes) : en attendant, tout le préventif compte.') : null)
}
