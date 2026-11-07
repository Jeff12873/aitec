// PREVTEC, étapes 3 et 4 : le Démonstrateur d'une machine (clic sur une machine du Pareto ou du tableau), fidèle au
// classeur de son auteur. En colonnes les équipements de la machine, le plus en panne à gauche ; en lignes les
// visites du plan ; à la croisée, l'endroit où chaque visite est posée ; sous chaque colonne, l'un des 4 diagnostics
// (pas de préventif, mauvais point contrôlé ou énoncé trop vague, préventif ok, sur maintenance). Puis « Je décide » :
// une fiche N1 ou un point N2 pour les équipements sans préventif ou mal regardés. Calcul : blocs/mn1/demonstrateur.js.

import { h, vider, ic, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { filEtapes, evolutionPanne } from './prevtec.js'
import { relireFiche } from './mn1-parc.js'
import { LOGO_MN1 } from './fiches-mn1.js'

const COULEURS = { pas: 'rouge', mauvais: 'violet', ok: 'vert', sur: 'orange', rien: '' }

export async function afficherMachine(zone, parcId, machineId) {
  vider(zone, filEtapes(3), h('p', { class: 'discret curseur' }, 'Lecture des pannes et des visites de la machine'))
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  const d = await api(base)
  const m = d.machine
  const col = d.colonnes

  // ---- la matrice : visites × équipements
  const tete = h('tr', {}, h('th', { class: 'coin-demo' }, 'Visites ↓ · équipements →'), h('th', { class: 'col-t', title: 'Taux t = A / (A + B + C) : la part des passages sans rien trouver. Il faut le résultat des inspections, que la GMAO n’a pas encore.' }, 't'), h('th', { class: 'col-passages' }, 'passages'),
    col.map((c) => h('th', { class: `col-equipement ${COULEURS[c.diagnostic]}`, title: `${c.designation || c.repere}\n${c.pannesListe.map((p) => `${p.nombre} × ${p.symptome}`).join('\n')}` }, h('span', { class: 'mono' }, c.repere), h('small', {}, c.designation || ''))),
    h('th', { class: 'col-equipement machine-entiere', title: 'Les visites posées sur la machine entière, pas sur un organe' }, h('span', { class: 'mono' }, m.repere), h('small', {}, 'machine entière')))
  const lignePannes = h('tr', { class: 'ligne-pannes-demo' }, h('th', {}, 'pannes (12 mois)'), h('td'), h('td'),
    col.map((c) => h('td', { class: `nb-pannes ${COULEURS[c.diagnostic]}` }, h('b', {}, String(c.pannes)), c.pannes ? evolutionPanne({ nombre: c.pannes, precedent: c.precedent, evolution: c.evolution }) : null)), h('td'))
  const corps = d.lignes.map((g) => h('tr', {},
    h('th', { class: 'titre-visite', title: g.titre }, g.code ? h('span', { class: 'etiquette code-visite', title: `Niveau ${g.code.niveau} · ${g.code.type}` }, g.code.code) : null, g.titre),
    h('td', { class: 'col-t discret' }, g.t === null ? '—' : `${Math.round(g.t * 100)} %`),
    h('td', { class: 'col-passages nombre', title: `Dernier passage le ${dateFr(g.derniere)}` }, String(g.passages)),
    col.map((c) => h('td', { class: `croisee ${g.equipement === c.id && !g.machineEntiere ? 'posee' : ''}` }, g.equipement === c.id && !g.machineEntiere ? '●' : '')),
    h('td', { class: `croisee ${g.machineEntiere ? 'posee vague' : ''}` }, g.machineEntiere ? '●' : '')))
  const ligneDiag = h('tr', { class: 'ligne-diagnostics' }, h('th', {}, 'diagnostic'), h('td'), h('td'),
    col.map((c) => h('td', { class: `diag-demo ${COULEURS[c.diagnostic]}`, title: c.raison }, c.libelle)), h('td'))
  const matrice = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('graphique', 18), 'Démonstrateur'), h('span', { class: 'discret' }, `${col.length} équipement${col.length > 1 ? 's' : ''} · ${d.lignes.length} visite${d.lignes.length > 1 ? 's' : ''} du plan · 12 mois`)),
    col.length || d.lignes.length ? h('div', { class: 'tableau-conteneur demo-conteneur' }, h('table', { class: 'matrice-demo' }, h('thead', {}, tete, lignePannes), h('tbody', {}, corps), h('tfoot', {}, ligneDiag)))
      : h('p', { class: 'discret' }, 'Ni panne ni visite sur cette machine ces 12 mois.'),
    h('div', { class: 'legende-demo' },
      ['pas', 'mauvais', 'ok', 'sur'].map((k) => h('span', { class: `diag-demo ${COULEURS[k]}` }, { pas: 'pas de préventif', mauvais: 'mauvais point contrôlé ou énoncé trop vague', ok: 'préventif ok', sur: 'sur maintenance' }[k])),
      h('span', { class: 'discret' }, '● visite posée sur l’équipement · t : part des passages sans rien trouver (résultats d’inspection à venir)')))

  // ---- je décide
  const ficheN1 = async (c) => {
    notifier('L’IA rédige une fiche pour cette panne…')
    const b = await essayer(() => api(`${base}/fiche`, { methode: 'POST', corps: { panne: c.panne.cle } }))
    if (b && (await relireFiche(d.parc.id, b, `Fiche N1 — ${c.repere} : ${c.panne.symptome}`, `Rédigée par l’IA pour cette panne (${c.panne.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous. Ensuite, étape 5 « Niveau 1 » : la mettre en service (FI ou carte papier).`))) location.hash = `#/mn1/n1/${encodeURIComponent(d.parc.id)}`
  }
  const pointN2 = async (c) => {
    notifier('L’IA rédige un point de niveau 2…')
    const visites = d.lignes.filter((g) => g.equipement === c.id || g.machineEntiere).map((g) => g.titre).join(' ; ')
    const n = await essayer(() => api(`${base}/n2`, { methode: 'POST', corps: { panne: c.panne.cle, visites } }))
    if (!n) return
    const zoneTexte = h('textarea', { rows: 8 }, [`Machine : ${n.machine}`, `Organe : ${n.ou}`, `Contrôle : ${n.quoi}`, `Fréquence : ${n.frequence}`, `Métier : ${n.metier}`, `Panne visée : ${n.panne} — ${n.pourquoi}`].join('\n'))
    await fenetre({
      titre: `Point N2 — ${c.repere} : ${c.panne.symptome}`,
      large: true,
      contenu: h('div', {}, h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Rédigé par l’IA : corrigez-le si besoin, puis reportez-le dans la GMAO (PREVTEC ne gère pas les gammes de niveau 2).'), zoneTexte),
      boutons: [{ texte: 'Fermer', classe: 'discret', valeur: null }, { texte: 'Copier', classe: 'principal', action: async () => { await navigator.clipboard.writeText(zoneTexte.value); notifier('Point N2 copié'); return true } }],
    })
  }
  const aDecider = col.filter((c) => (c.diagnostic === 'pas' || c.diagnostic === 'mauvais') && c.panne)
  const surMaintenance = col.filter((c) => c.diagnostic === 'sur')
  const carteDecisions = h('div', { class: 'carte carte-decisions' },
    h('div', { class: 'carte-entete' }, h('h2', {}, h('span', { class: 'numero-etape' }, '4'), 'Je décide'), h('span', { class: 'discret' }, aDecider.length ? `${aDecider.length} équipement${aDecider.length > 1 ? 's' : ''} à traiter` : '')),
    aDecider.length || surMaintenance.length ? h('div', { class: 'decisions' },
      aDecider.map((c) => h('div', { class: `decision ${COULEURS[c.diagnostic]}` },
        h('div', { class: 'tete-decision' }, h('span', { class: `etiquette ${COULEURS[c.diagnostic]}` }, c.libelle), h('b', { class: 'mono' }, c.repere), h('span', { class: 'discret' }, `${c.pannes} pannes`)),
        h('p', {}, `${c.raison} Panne principale : ${c.panne.symptome} (${c.panne.nombre} cas).`),
        h('div', { class: 'actions' },
          h('button', { class: 'petit', title: 'L’IA rédige une fiche de niveau 1 (contrôle simple de l’opérateur), que vous relisez', onclick: () => ficheN1(c) }, h('img', { class: 'logo-bouton-n1', src: LOGO_MN1, alt: '' }), 'Fiche N1'),
          h('button', { class: 'petit', title: 'L’IA rédige un point de niveau 2 (technicien), à reporter dans la GMAO', onclick: () => pointN2(c) }, ic('etincelle', 13), 'Point N2')))),
      surMaintenance.map((c) => h('div', { class: 'decision orange' },
        h('div', { class: 'tete-decision' }, h('span', { class: 'etiquette orange' }, c.libelle), h('b', { class: 'mono' }, c.repere)),
        h('p', {}, `${c.raison} Les visites posées sur lui peuvent-elles être espacées ?`)))) : h('p', { class: 'discret' }, 'Rien à décider : chaque équipement en panne est regardé par une visite posée sur lui, et ses pannes ne montent pas.'),
    h('div', { class: 'suite-etape' },
      h('a', { class: 'bouton', href: `#/mn1/n1/${encodeURIComponent(d.parc.id)}` }, h('span', { class: 'numero-etape' }, '5'), 'Niveau 1 de la ligne ›')))

  vider(zone,
    filEtapes(3, d.parc, m),
    h('div', { class: 'entete-page' },
      h('a', { class: 'bouton discret icone-seule', title: `Retour à la ligne ${d.parc.nom}`, href: `#/mn1/parc/${encodeURIComponent(d.parc.id)}` }, ic('retour')),
      h('div', { style: { flex: 1 } }, h('h1', {}, h('span', { class: 'mono' }, m.repere), m.designation ? ` — ${m.designation}` : ''), h('p', { class: 'sous-titre' }, `${d.parc.nom} · le préventif est-il bien ciblé, en bonne quantité ?`)),
      h('div', { class: 'actions' }, h('a', { class: 'bouton', href: `#/analyse/${m.id}` }, ic('graphique', 16), 'Analyse complète'))),
    h('div', { class: 'demonstrateur' }, matrice, carteDecisions))
}
