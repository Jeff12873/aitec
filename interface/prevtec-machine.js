// PREVTEC, étapes 3 et 4 : une machine (clic sur une machine du Pareto ou du nuage), réduite à une question : ses
// pannes qui reviennent sont-elles regardées par une visite ? Ses 5 premières pannes avec une pastille (rouge :
// aucune visite ; orange : une visite, et pourtant elle monte ; vert : regardée), ses visites du plan, puis « Je
// décide » : une fiche N1 ou un point N2 pour le rouge et l'orange. Le calcul est dans blocs/mn1/demonstrateur.js.

import { h, vider, ic, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { filEtapes, evolutionPanne } from './prevtec.js'
import { relireFiche } from './mn1-parc.js'

const ETATS = {
  aucune: ['rouge', 'Aucune visite', 'Aucune visite sur son équipement ni sur la machine'],
  revoir: ['orange', 'Visite à revoir', 'Une visite la regarde, et pourtant la panne monte : elle ne la voit pas venir'],
  regardee: ['vert', 'Regardée', 'Une visite la regarde, et la panne ne monte pas'],
}

export async function afficherMachine(zone, parcId, machineId) {
  vider(zone, filEtapes(3), h('p', { class: 'discret curseur' }, 'Lecture des pannes et des visites de la machine'))
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  const d = await api(base)
  const m = d.machine

  const pastille = (p) => {
    const [classe, texte, aide] = ETATS[p.etat]
    return h('span', { class: `etiquette ${classe}`, title: aide }, texte)
  }
  const cartePannes = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('alerte', 18), 'Ses pannes qui reviennent'), h('span', { class: 'discret' }, '12 mois, face aux 12 d’avant')),
    d.pannes.length ? h('div', { class: 'pannes-machine' }, d.pannes.map((p) => h('div', { class: `panne-machine ${ETATS[p.etat][0]}` },
      h('div', { class: 'tete-panne-machine' }, pastille(p), h('b', {}, p.symptome)),
      h('div', { class: 'detail-panne-machine' },
        h('span', {}, `${p.nombre} cas`), evolutionPanne(p),
        p.surQuoi && p.surQuoi !== m.repere ? h('span', { class: 'discret' }, `sur ${p.surQuoi}`) : null,
        p.visites.length ? h('span', { class: 'discret' }, `visite : ${p.visites.join(' ; ')}`) : null))))
      : h('p', { class: 'discret' }, 'Pas de panne qui revient sur cette machine ces 12 mois.'))

  const carteVisites = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('rafraichir', 18), 'Ses visites'), h('span', { class: 'discret' }, `${d.visites.length} visite${d.visites.length > 1 ? 's' : ''} du plan · 12 mois`)),
    d.visites.length ? h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {}, ['Code', 'Visite', 'Posée sur', 'Passages', 'Dernière'].map((x) => h('th', {}, x)))),
      h('tbody', {}, d.visites.map((v) => h('tr', {},
        h('td', {}, v.code ? h('span', { class: 'etiquette', title: `Niveau ${v.code.niveau} · ${v.code.type}` }, `${v.code.code} · N${v.code.niveau} · ${v.code.type}`) : h('span', { class: 'discret' }, '—')),
        h('td', {}, v.titre),
        h('td', { class: 'mono discret' }, v.surQuoi),
        h('td', { class: 'nombre' }, String(v.passages)),
        h('td', {}, dateFr(v.derniere)))))))
      : h('p', { class: 'discret' }, d.conventionReglee ? 'Aucune visite du plan (code reconnu) sur cette machine ces 12 mois.' : 'Aucune visite préventive sur cette machine ces 12 mois.'))

  // ---- je décide
  const ficheN1 = async (p) => {
    notifier('L’IA rédige une fiche pour cette panne…')
    const b = await essayer(() => api(`${base}/fiche`, { methode: 'POST', corps: { panne: p.cle } }))
    if (b && (await relireFiche(d.parc.id, b, `Fiche N1 — ${m.repere} : ${p.symptome}`, `Rédigée par l’IA pour cette panne (${p.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous. Ensuite, étape 5 « Niveau 1 » : la mettre en service (FI ou carte papier).`))) location.hash = `#/mn1/n1/${encodeURIComponent(d.parc.id)}`
  }
  const pointN2 = async (p) => {
    notifier('L’IA rédige un point de niveau 2…')
    const n = await essayer(() => api(`${base}/n2`, { methode: 'POST', corps: { panne: p.cle, visites: p.visites.join(' ; ') } }))
    if (!n) return
    const zoneTexte = h('textarea', { rows: 8 }, [`Machine : ${n.machine}`, `Organe : ${n.ou}`, `Contrôle : ${n.quoi}`, `Fréquence : ${n.frequence}`, `Métier : ${n.metier}`, `Panne visée : ${n.panne} — ${n.pourquoi}`].join('\n'))
    await fenetre({
      titre: `Point N2 — ${m.repere} : ${p.symptome}`,
      large: true,
      contenu: h('div', {}, h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Rédigé par l’IA : corrigez-le si besoin, puis reportez-le dans la GMAO (PREVTEC ne gère pas les gammes de niveau 2).'), zoneTexte),
      boutons: [{ texte: 'Fermer', classe: 'discret', valeur: null }, { texte: 'Copier', classe: 'principal', action: async () => { await navigator.clipboard.writeText(zoneTexte.value); notifier('Point N2 copié'); return true } }],
    })
  }
  const aDecider = d.pannes.filter((p) => p.etat !== 'regardee')
  const carteDecisions = h('div', { class: 'carte carte-decisions' },
    h('div', { class: 'carte-entete' }, h('h2', {}, h('span', { class: 'numero-etape' }, '4'), 'Je décide'), h('span', { class: 'discret' }, aDecider.length ? `${aDecider.length} panne${aDecider.length > 1 ? 's' : ''} à traiter` : '')),
    aDecider.length ? h('div', { class: 'decisions' }, aDecider.map((p) => h('div', { class: `decision ${ETATS[p.etat][0]}` },
      h('div', { class: 'tete-decision' }, pastille(p), h('b', {}, p.symptome), h('span', { class: 'discret' }, `${p.nombre} cas`)),
      h('p', {}, p.etat === 'aucune' ? 'Un geste simple de l’opérateur peut-il la voir venir ? Sinon, un contrôle du technicien.' : 'La visite actuelle ne la voit pas venir : revoir le point contrôlé, ou ajouter un geste de l’opérateur.'),
      h('div', { class: 'actions' },
        h('button', { class: 'petit', title: 'L’IA rédige une fiche de niveau 1 (contrôle simple de l’opérateur), que vous relisez', onclick: () => ficheN1(p) }, ic('etincelle', 13), 'Fiche N1'),
        h('button', { class: 'petit', title: 'L’IA rédige un point de niveau 2 (technicien), à reporter dans la GMAO', onclick: () => pointN2(p) }, ic('etincelle', 13), 'Point N2')))))
      : h('p', { class: 'discret' }, 'Rien à décider : chaque panne qui revient est regardée par une visite, et aucune ne monte.'),
    h('div', { class: 'suite-etape' },
      h('a', { class: 'bouton', href: `#/mn1/n1/${encodeURIComponent(d.parc.id)}` }, h('span', { class: 'numero-etape' }, '5'), 'Niveau 1 de la ligne ›')))

  vider(zone,
    filEtapes(3, d.parc, m),
    h('div', { class: 'entete-page' },
      h('a', { class: 'bouton discret icone-seule', title: `Retour à la ligne ${d.parc.nom}`, href: `#/mn1/parc/${encodeURIComponent(d.parc.id)}` }, ic('retour')),
      h('div', { style: { flex: 1 } }, h('h1', {}, h('span', { class: 'mono' }, m.repere), m.designation ? ` — ${m.designation}` : ''), h('p', { class: 'sous-titre' }, `${d.parc.nom} · ses pannes sont-elles regardées par une visite ?`)),
      h('div', { class: 'actions' }, h('a', { class: 'bouton', href: `#/analyse/${m.id}` }, ic('graphique', 16), 'Analyse complète'))),
    h('div', { class: 'demonstrateur' }, cartePannes, carteVisites, carteDecisions))
}
