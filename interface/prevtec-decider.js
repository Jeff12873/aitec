// PREVTEC, étape 4 : « Je décide », pour un équipement d'une machine. Ce qui le regarde aujourd'hui (les visites, leur
// FI, leurs dernières observations), ses pannes et des conseils ; puis une fiche N1, un point N2 (la FI actuelle et la
// proposition, à reporter dans la GMAO) ou la fiche de visite. Calcul : decisionEquipement (blocs/mn1/demonstrateur.js).

import { h, vider, ic, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { filEtapes, barreRetour, evolutionPanne } from './prevtec.js'
import { relireFiche } from './mn1-parc.js'
import { LOGO_MN1 } from './fiches-mn1.js'
import { ouvrirFicheVisite } from './fiche-visite.js'
import { COULEURS_DIAGNOSTIC as COULEURS } from './prevtec-machine.js'

export async function afficherDecider(zone, parcId, machineId, equipement) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture de l’équipement'))
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  const d = await api(`${base}/decider${equipement ? `?equipement=${equipement}` : ''}`)
  const page = (colonne) => `#/mn1/decider/${encodeURIComponent(parcId)}/${machineId}/${colonne}`
  const retour = barreRetour(`Démonstrateur · ${d.machine.repere}`, `#/mn1/parc/${encodeURIComponent(parcId)}?machine=${machineId}`)
  if (!d.equipement) return vider(zone, retour, filEtapes(4, d.parc, d.machine), h('div', { class: 'carte vide' }, h('p', {}, 'Ni panne ni visite sur cette machine ces 12 mois : rien à décider.')))
  const c = d.equipement
  const zoneSuite = h('div', { class: 'suite-decision' })

  const ficheN1 = async () => {
    notifier('L’IA rédige une fiche pour cette panne…')
    const b = await essayer(() => api(`${base}/fiche`, { methode: 'POST', corps: { panne: c.panne.cle } }))
    if (b && (await relireFiche(d.parc.id, b, `Fiche N1 — ${c.repere} : ${c.panne.symptome}`, `Rédigée par l’IA pour cette panne (${c.panne.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous.`))) {
      vider(zoneSuite, h('a', { class: 'bouton principal', href: `#/niveau1/${encodeURIComponent(d.parc.id)}` }, h('img', { class: 'logo-bouton-n1', src: LOGO_MN1, alt: '' }), 'Voir cette fiche dans Maintenance de niveau 1'))
    }
  }
  const pointN2 = async () => {
    notifier('L’IA rédige un point de niveau 2…')
    const actuelle = d.visites.map((g) => g.contenu).filter(Boolean).join('\n')
    const n = await essayer(() => api(`${base}/n2`, { methode: 'POST', corps: { panne: c.panne.cle, visites: d.visites.map((g) => g.titre).join(' ; '), fi: actuelle } }))
    if (!n) return
    const texte = h('textarea', { rows: 12 }, [`Machine : ${n.machine}`, `Organe : ${n.ou}`, `Contrôle : ${n.quoi}`, `Fréquence : ${n.frequence}`, `Métier : ${n.metier}`, `Panne visée : ${n.panne} — ${n.pourquoi}`].join('\n'))
    await fenetre({
      titre: `Point N2 — ${c.repere} : ${c.panne.symptome}`,
      large: true,
      contenu: h('div', {},
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Rédigé par l’IA : corrigez-le si besoin, puis reportez-le dans la GMAO. PREVTEC n’écrit pas dans la FI.'),
        h('div', { class: 'grille grille-2', style: { gap: '12px' } },
          h('div', {}, h('b', {}, 'FI actuelle'), h('div', { class: 'fi-actuelle' }, actuelle || 'Aucune FI lue pour les visites qui regardent cet équipement.')),
          h('div', {}, h('b', {}, 'Proposition'), texte))),
      boutons: [{ texte: 'Fermer', classe: 'discret', valeur: null }, { texte: 'Copier', classe: 'principal', action: async () => { await navigator.clipboard.writeText(texte.value); notifier('Point N2 copié'); return true } }],
    })
  }

  const liste = h('nav', { class: 'liste-decider', 'aria-label': 'Équipements de la machine' }, d.colonnes.map((x) => h('a', { class: `equipement-decider ${COULEURS[x.diagnostic]}${x.id === c.id ? ' choisi' : ''}`, href: page(x.id), title: x.designation || x.repere }, h('b', { class: 'mono' }, x.repere), h('small', {}, `${x.pannes} panne${x.pannes > 1 ? 's' : ''}${x.libelle ? ` · ${x.libelle}` : ''}`))))

  const carteVisite = (g) => h('div', { class: 'visite-decider' },
    h('div', { class: 'tete-visite-decider' },
      g.code ? h('span', { class: 'etiquette code-visite' }, g.code.code) : null,
      h('b', {}, g.titre),
      h('span', { class: 'discret petit-texte' }, `${g.passages} passage${g.passages > 1 ? 's' : ''} · dernier le ${dateFr(g.derniere)}${g.t === null ? '' : ` · ${Math.round(g.t * 100)} % sans rien trouver`}`),
      g.machineEntiere ? h('span', { class: 'etiquette' }, 'machine entière') : g.dapresTitre ? h('span', { class: 'etiquette', title: 'Posée sur la machine entière dans la GMAO' }, 'd’après le titre') : null,
      h('button', { class: 'petit', title: 'L’historique des pannes de ce qu’elle couvre, à imprimer pour le mainteneur', onclick: () => ouvrirFicheVisite(base, g) }, ic('document', 13), 'Fiche de visite')),
    g.contenu ? h('details', {}, h('summary', {}, g.fi ? `Contenu de la FI ${g.fi}` : 'Contenu de la FI'), h('p', { class: 'fi-actuelle' }, g.contenu)) : h('p', { class: 'discret petit-texte' }, 'Contenu de la FI non lu dans les rapports.'),
    g.observations.length ? h('ul', { class: 'observations-decider' }, g.observations.map((o) => h('li', {}, h('span', { class: 'discret' }, `${dateFr(o.date)} : `), o.texte))) : h('p', { class: 'discret petit-texte' }, 'Aucune observation écrite sur ces passages.'))

  const detail = h('div', { class: 'detail-decider' },
    h('div', { class: `carte tete-decider ${COULEURS[c.diagnostic]}` },
      h('div', {}, h('h2', {}, h('span', { class: 'mono' }, c.repere), ' ', h('small', { class: 'discret' }, c.designation || '')),
        c.libelle ? h('span', { class: `etiquette ${COULEURS[c.diagnostic]}` }, c.libelle) : null, h('p', { class: 'texte-2' }, c.raison || 'Rien à signaler sur cet équipement.')),
      h('div', { class: 'chiffre-decider' }, h('b', {}, String(c.pannes)), h('small', {}, 'pannes sur 12 mois'), c.pannes ? evolutionPanne({ nombre: c.pannes, precedent: c.precedent, evolution: c.evolution }) : null)),
    d.conseils.length ? h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic('coche', 18), 'Conseils')), h('ul', { class: 'conseils-decider' }, d.conseils.map((x) => h('li', {}, x)))) : null,
    h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic('historique', 18), 'État actuel des visites')),
      d.visites.length ? d.visites.map(carteVisite) : h('p', { class: 'discret' }, 'Aucune visite ne regarde cet équipement.')),
    h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic('alerte', 18), 'Ses pannes qui reviennent')),
      d.pannes.length ? h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau' }, h('thead', {}, h('tr', {}, ['Panne', 'Cas (12 mois)', 'Évolution', 'Dernière réparation'].map((x) => h('th', {}, x)))),
        h('tbody', {}, d.pannes.map((p) => h('tr', {}, h('td', {}, p.symptome), h('td', { class: 'nombre' }, String(p.nombre)), h('td', {}, evolutionPanne(p)), h('td', { class: 'texte-2' }, `${dateFr(p.derniere)} : ${p.reparation}`))))))
        : h('p', { class: 'discret' }, 'Pas de panne qui revient (3 rapports semblables au moins).'),
      d.remarques.length ? h('details', {}, h('summary', {}, 'Déjà remarqué sur place'), h('ul', { class: 'observations-decider' }, d.remarques.map((r) => h('li', {}, h('span', { class: 'discret' }, `${dateFr(r.date)} : `), r.texte)))) : null),
    h('div', { class: 'carte carte-decisions' }, h('div', { class: 'carte-entete' }, h('h2', {}, 'Je décide')),
      c.panne ? h('div', { class: 'actions' },
        h('button', { title: 'L’IA rédige une fiche de niveau 1 (contrôle simple de l’opérateur), que vous relisez', onclick: ficheN1 }, ic('etincelle', 14), 'Ajouter une fiche N1'),
        h('button', { title: 'L’IA rédige un point de niveau 2, à côté de la FI actuelle', onclick: pointN2 }, ic('etincelle', 14), 'Proposer un point N2')) : h('p', { class: 'discret' }, 'Pas de panne à viser sur cet équipement.'),
      zoneSuite))
  vider(zone, retour, filEtapes(4, d.parc, d.machine),
    h('div', { class: 'tete-machine' }, h('h1', {}, d.machine.repere), h('p', { class: 'sous-titre' }, `${d.machine.designation || ''} · ${d.parc.nom}`)),
    h('div', { class: 'page-decider' }, liste, detail))
}
