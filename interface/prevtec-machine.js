// PREVTEC, étape 3 : le Démonstrateur d'une machine, 3e niveau de zoom de la carte de la ligne (ETH › machines ›
// Démonstrateur), fidèle au classeur de son auteur. En colonnes les équipements de la machine, le plus en panne à
// gauche, noms en biais et cases carrées ; en lignes les visites du plan ; à la croisée, l'endroit où chaque visite
// est posée ; sous chaque colonne, l'un des 4 diagnostics (pas de préventif, mauvais point contrôlé ou énoncé trop
// vague, préventif ok, sur maintenance). Un clic sur une colonne ouvre « Je décide ». Calcul : blocs/mn1/demonstrateur.js.

import { h, ic, dateFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { ouvrirFicheVisite } from './fiche-visite.js'

export const COULEURS_DIAGNOSTIC = { pas: 'rouge', mauvais: 'violet', ok: 'vert', sur: 'orange', rien: '' }
const SIGNES = { pas: '!', mauvais: '?', ok: '✓', sur: '+', rien: '' }
const LIBELLES = { pas: 'pas de préventif', mauvais: 'mauvais point contrôlé ou énoncé trop vague', ok: 'préventif ok', sur: 'sur maintenance' }
const FLECHES = { monte: '↑', baisse: '↓', stable: '=', nouvelle: '✦' }
const sensDe = (c) => ({
  monte: `↑ en hausse : ${c.precedent} les 12 mois d’avant`,
  baisse: `↓ en baisse : ${c.precedent} les 12 mois d’avant`,
  stable: `= stable : ${c.precedent} les 12 mois d’avant`,
  nouvelle: '✦ nouvelle : aucune panne les 12 mois d’avant',
}[c.evolution] || '')

// Rend { element, machine } : la matrice.
export async function demonstrateurMachine(parcId, machineId) {
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  const d = await api(base)
  const m = d.machine
  const col = d.colonnes
  const decider = (c) => (location.hash = `#/mn1/decider/${encodeURIComponent(d.parc.id)}/${m.id}/${c.id}`)
  const cliquable = (c, enPlus = '') => ({ title: [c.designation || c.repere, enPlus, `${c.pannes} pannes sur 12 mois · ${c.diagnostic === 'rien' ? 'rien à signaler' : `${SIGNES[c.diagnostic]} ${c.libelle}`}`, c.pannes ? sensDe(c) : '', c.raison, 'Cliquer : je décide'].filter(Boolean).join('\n'), onclick: () => decider(c) })

  const tete = h('tr', {}, h('th', { class: 'coin-demo' }, 'Visites ↓ · équipements →'),
    h('th', { class: 'col-t', title: 'Taux t : la part des passages sans rien trouver (RAS, OK, conforme…), parmi ceux où le mainteneur a écrit une observation.' }, 't'),
    h('th', { class: 'col-passages', title: 'Passages sur 12 mois' }, 'pass.'),
    col.map((c) => h('th', { class: `biais col-clic ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, ...cliquable(c) }, h('div', {}, h('span', { class: 'mono' }, c.repere)))),
    h('th', { class: 'biais', title: 'Les visites posées sur la machine entière, pas sur un organe' }, h('div', {}, h('span', { class: 'mono discret' }, 'machine entière'))))
  const lignePannes = h('tr', { class: 'ligne-pannes-demo' }, h('th', {}, 'pannes (12 mois)'), h('td'), h('td'),
    col.map((c) => h('td', { class: `carre nb-pannes col-clic ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, ...cliquable(c) }, h('b', {}, String(c.pannes)), c.pannes ? h('small', { class: { monte: 'rouge', nouvelle: 'rouge', baisse: 'vert' }[c.evolution] || '' }, FLECHES[c.evolution] || '') : null)), h('td', { class: 'carre' }))
  const posee = (g, c) => g.equipement === c.id && !g.machineEntiere
  const corps = d.lignes.map((g) => h('tr', {},
    h('th', { class: 'titre-visite', title: `${g.titre}${g.dapresTitre ? '\nPosée sur la machine entière : rattachée à cet organe d’après son titre' : ''}` },
      h('button', { class: 'discret icone-seule petit bouton-fiche-visite', title: 'Fiche de visite : l’historique des pannes de ce qu’elle couvre, à imprimer pour le mainteneur', onclick: () => ouvrirFicheVisite(base, g) }, ic('document', 13)),
      g.code ? h('span', { class: 'etiquette code-visite', title: `${g.code.niveau ? `Niveau ${g.code.niveau} · ` : ''}${g.code.type}` }, g.code.code) : null, g.titre),
    h('td', { class: 'col-t discret', title: g.t === null ? 'Aucune observation écrite sur ces passages' : `${g.rien} sans rien trouver sur ${g.ecrits} passage${g.ecrits > 1 ? 's' : ''} avec une observation (${g.passages} en tout)` }, g.t === null ? '—' : `${Math.round(g.t * 100)} %`),
    h('td', { class: 'col-passages nombre', title: `Dernier passage le ${dateFr(g.derniere)}` }, String(g.passages)),
    col.map((c) => h('td', { class: `carre croisee col-clic ${posee(g, c) ? `posee${g.dapresTitre ? ' titre' : ''}` : ''}`, ...cliquable(c, posee(g, c) ? (g.dapresTitre ? `○ « ${g.titre} » : posée sur la machine entière, rattachée ici d’après son titre` : `● « ${g.titre} » : visite posée sur cet équipement`) : '') }, posee(g, c) ? '●' : '')),
    h('td', { class: `carre croisee ${g.machineEntiere ? 'posee vague' : ''}` }, g.machineEntiere ? '●' : '')))
  const ligneDiag = h('tr', { class: 'ligne-diagnostics' }, h('th', {}, 'diagnostic'), h('td'), h('td'),
    col.map((c) => h('td', { class: `carre diag-demo col-clic ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, ...cliquable(c) }, SIGNES[c.diagnostic])), h('td', { class: 'carre' }))
  const element = h('div', { class: 'demonstrateur' },
    h('p', { class: 'discret petit-texte', style: { margin: '6px 0' } }, `${col.length} équipement${col.length > 1 ? 's' : ''} · ${d.lignes.length} visite${d.lignes.length > 1 ? 's' : ''} · 12 mois. Cliquez une colonne pour décider.`),
    col.length || d.lignes.length ? h('div', { class: 'tableau-conteneur demo-conteneur' }, h('table', { class: 'matrice-demo' }, h('thead', {}, tete, lignePannes), h('tbody', {}, corps), h('tfoot', {}, ligneDiag)))
      : h('p', { class: 'discret' }, 'Ni panne ni visite sur cette machine ces 12 mois.'),
    h('div', { class: 'legende-demo' },
      ['pas', 'mauvais', 'ok', 'sur'].map((k) => h('span', { class: 'cle-demo' }, h('span', { class: `carre-legende diag-demo ${COULEURS_DIAGNOSTIC[k]}` }, SIGNES[k]), LIBELLES[k])),
      h('span', { class: 'discret' }, '● visite posée sur l’équipement · ○ d’après son titre · t : part des passages sans rien trouver, parmi ceux avec une observation écrite')))
  element.querySelectorAll('td.posee.titre').forEach((td) => (td.textContent = '○'))
  return { element, machine: m }
}
