// PREVTEC, étape 4 : « Je décide », pour une case du Démonstrateur (une visite face à un équipement). D'abord la visite
// telle qu'elle est écrite dans la GMAO, puis les préconisations de l'IA, puis la décision : une fiche N1, la FI revue
// (à reporter dans la GMAO) ou la fiche de visite à imprimer. Calcul : decisionCroisee (blocs/mn1/demonstrateur.js).

import { h, vider, ic, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { filEtapes, barreRetour } from './prevtec.js'
import { relireFiche } from './mn1-parc.js'
import { LOGO_MN1 } from './fiches-mn1.js'
import { ouvrirFicheVisite } from './fiche-visite.js'

export async function afficherDecider(zone, parcId, machineId, { equipement, pose, titre }) {
  if (!equipement || !pose || !titre) return location.replace(`#/mn1/parc/${encodeURIComponent(parcId)}?machine=${machineId}`)
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture de la visite'))
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  const croisee = { equipement, pose, titre }
  const d = await api(`${base}/decider?equipement=${equipement}&pose=${pose}&titre=${encodeURIComponent(titre)}`)
  const c = d.equipement
  const v = d.visite
  const zoneSuite = h('div', { class: 'suite-decision' })

  const ficheN1 = async () => {
    notifier('L’IA rédige une fiche pour cette panne…')
    const b = await essayer(() => api(`${base}/fiche`, { methode: 'POST', corps: { panne: c.panne.cle } }))
    if (b && (await relireFiche(d.parc.id, b, `Fiche N1 — ${c.repere} : ${c.panne.symptome}`, `Rédigée par l’IA pour cette panne (${c.panne.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous.`))) {
      vider(zoneSuite, h('a', { class: 'bouton principal', href: `#/niveau1/${encodeURIComponent(d.parc.id)}` }, h('img', { class: 'logo-bouton-n1', src: LOGO_MN1, alt: '' }), 'Voir cette fiche dans Maintenance de niveau 1'))
    }
  }
  const modifierFi = async () => {
    notifier('L’IA revoit la FI…')
    const r = await essayer(() => api(`${base}/decider/fi`, { methode: 'POST', corps: croisee }))
    if (!r) return
    const texte = h('textarea', { rows: 14 }, r.proposee)
    await fenetre({
      titre: `Modifier la FI${v.fi ? ` ${v.fi}` : ''}`,
      large: true,
      contenu: h('div', {},
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Proposé par l’IA : corrigez-le si besoin, puis reportez-le dans la GMAO. PREVTEC n’écrit pas encore dans la FI.'),
        h('div', { class: 'grille grille-2', style: { gap: '12px' } },
          h('div', {}, h('b', {}, 'FI actuelle'), h('div', { class: 'fi-actuelle' }, r.actuelle || 'Contenu de la FI non lu dans les rapports.')),
          h('div', {}, h('b', {}, 'Proposition'), texte))),
      boutons: [{ texte: 'Fermer', classe: 'discret', valeur: null }, { texte: 'Copier', classe: 'principal', action: async () => { await navigator.clipboard.writeText(texte.value); notifier('FI copiée'); return true } }],
    })
  }

  const zonePreco = h('div', {}, h('p', { class: 'discret curseur' }, d.iaInstallee ? 'L’IA lit la visite et les pannes' : ''))
  const montrerPreco = (lignes) => vider(zonePreco, lignes.length ? h('ul', { class: 'conseils-decider' }, lignes.map((x) => h('li', {}, x))) : h('p', { class: 'discret' }, 'Rien de particulier à préconiser.'))
  if (d.iaInstallee) api(`${base}/decider/preconisations`, { methode: 'POST', corps: croisee }).then((r) => montrerPreco(r.lignes)).catch(() => montrerPreco(d.conseils))
  else montrerPreco(d.conseils)

  vider(zone, barreRetour(`Démonstrateur · ${d.machine.repere}`, `#/mn1/parc/${encodeURIComponent(parcId)}?machine=${machineId}`), filEtapes(4, d.parc, d.machine),
    h('div', { class: 'tete-machine' }, h('h1', {}, h('span', { class: 'mono' }, c.repere), h('span', { class: 'nom-machine' }, [c.designation, d.machine.repere, d.parc.nom].filter(Boolean).join(' · ')))),
    h('div', { class: 'detail-decider' },
      h('div', { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, v.code ? h('span', { class: 'etiquette code-visite' }, v.code.code) : null, v.titre), h('span', { class: 'discret' }, `${v.passages} passage${v.passages > 1 ? 's' : ''} sur 12 mois · dernier le ${dateFr(v.derniere)}`)),
        v.deplacee ? h('p', { class: 'discret petit-texte' }, 'Déplacée sur cet équipement dans la GMAO ; les rapports déjà faits restent sur la machine entière.') : null,
        d.posee ? (v.dapresTitre ? h('p', { class: 'discret petit-texte' }, 'Posée sur la machine entière dans la GMAO ; rattachée à cet équipement d’après son titre.') : null) : h('p', { class: 'etiquette orange' }, 'Cette visite n’est pas posée sur cet équipement.'),
        h('h3', { class: 'titre-decider' }, v.fi ? `Contenu de la FI ${v.fi}` : 'Contenu de la FI'),
        v.contenu ? h('p', { class: 'fi-actuelle' }, v.contenu) : h('p', { class: 'discret' }, v.fi ? 'Cette FI n’a pas de texte dans les rapports de la GMAO.' : 'Pas de FI dans les rapports de la GMAO.'),
        h('h3', { class: 'titre-decider' }, 'Observations des derniers passages'),
        v.observations.length ? h('ul', { class: 'observations-decider' }, v.observations.map((o) => h('li', {}, h('span', { class: 'discret' }, `${dateFr(o.date)} : `), o.texte))) : h('p', { class: 'discret' }, 'Aucune observation écrite sur ces passages.')),
      h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic('etincelle', 18), 'Préconisations')), zonePreco),
      h('div', { class: 'carte carte-decisions' }, h('div', { class: 'carte-entete' }, h('h2', {}, 'Je décide')),
        h('div', { class: 'actions' },
          c.panne ? h('button', { title: `L’IA rédige une fiche de niveau 1 pour : ${c.panne.symptome}`, onclick: ficheN1 }, ic('etincelle', 14), 'Créer une fiche N1') : null,
          d.iaInstallee ? h('button', { title: 'L’IA revoit le contenu de cette FI, à côté de la version actuelle', onclick: modifierFi }, ic('etincelle', 14), 'Modifier la FI actuelle') : null,
          h('button', { title: 'L’historique des pannes de ce qu’elle couvre, à imprimer pour le mainteneur', onclick: () => ouvrirFicheVisite(base, { ...v, equipement: c.id, dapresTitre: c.id !== v.pose }) }, ic('document', 14), 'Fiche de visite à imprimer')),
        zoneSuite)))
}
