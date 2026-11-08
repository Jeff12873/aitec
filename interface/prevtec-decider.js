// PREVTEC, étape 4 : « Je décide », pour une case du Démonstrateur (une visite face à un équipement). D'abord la visite
// telle qu'elle est écrite dans la GMAO, puis les préconisations de l'IA, puis la décision : la retirer ou l'espacer,
// une fiche N1, la FI revue (à reporter dans la GMAO) ou la fiche de visite à imprimer. Calcul : decisionCroisee
// (blocs/mn1/demonstrateur.js), retraits et registre : appliquerDecision et blocs/mn1/decisions.js.

import { h, vider, ic, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { filEtapes, barreRetour } from './prevtec.js'
import { relireFiche } from './mn1-parc.js'
import { LOGO_MN1 } from './fiches-mn1.js'
import { ouvrirFicheVisite } from './fiche-visite.js'
import { choixFormat, lignesDe, pointsEnHtml } from './texte-fiche.js'
import { CITATIONS, citation, heuresFr } from './prevtec-gains.js'
import { modeAdmin } from '/socle/etat.js'

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
    // Prévenir si cette fiche ferait dépasser le maximum de l'ETH (on peut quand même la créer).
    const POIDS = { Hebdomadaire: 1, Mensuelle: 12 / 52, Trimestrielle: 4 / 52, Semestrielle: 2 / 52, Annuelle: 1 / 52 }
    const depasse = b && d.charge && d.charge.charge + (POIDS[b.frequence] || 0) > d.charge.max
    if (depasse) notifier(`Attention : cette fiche ferait dépasser la charge de ${d.charge.eth}.`, 'erreur')
    if (b && (await relireFiche(d.parc.id, b, `Fiche N1 — ${c.repere} : ${c.panne.symptome}`, `${depasse ? `Attention : ${d.charge.eth} est à ${d.charge.charge} fiche par semaine pour un maximum de ${d.charge.max}, cette fiche le ferait dépasser. ` : ''}Rédigée par l’IA pour cette panne (${c.panne.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous.`))) {
      vider(zoneSuite, h('a', { class: 'bouton principal', href: `#/niveau1/${encodeURIComponent(d.parc.id)}` }, h('img', { class: 'logo-bouton-n1', src: LOGO_MN1, alt: '' }), 'Voir cette fiche dans Maintenance de niveau 1'))
    }
  }
  const modifierFi = async () => {
    notifier('L’IA revoit la FI…')
    const r = await essayer(() => api(`${base}/decider/fi`, { methode: 'POST', corps: croisee }))
    if (!r) return
    const texte = h('textarea', { rows: 14 }, r.proposee)
    const mise = choixFormat(texte)
    // La mise en forme part dans le presse-papiers en HTML, avec le texte brut pour les champs qui ne l'acceptent pas.
    const copier = async () => {
      if (mise.format() === 'html' && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pointsEnHtml(lignesDe(texte.value))], { type: 'text/html' }), 'text/plain': new Blob([texte.value], { type: 'text/plain' }) })])
      else await navigator.clipboard.writeText(texte.value)
      notifier('FI copiée')
      return true
    }
    await fenetre({
      titre: `Modifier la FI${v.fi ? ` ${v.fi}` : ''}`,
      large: true,
      contenu: h('div', {},
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Proposé par l’IA : corrigez-le si besoin, puis reportez-le dans la GMAO. PREVTEC n’écrit pas encore dans la FI.'),
        h('div', { class: 'grille grille-2', style: { gap: '12px' } },
          h('div', {}, h('b', {}, 'FI actuelle'), h('div', { class: 'fi-actuelle' }, r.actuelle || 'Contenu de la FI non lu dans les rapports.')),
          h('div', {}, h('div', { class: 'tete-format' }, h('b', {}, 'Proposition'), mise.boutons), texte, mise.apercu))),
      boutons: [{ texte: 'Fermer', classe: 'discret', valeur: null }, { texte: 'Copier', classe: 'principal', action: copier }],
    })
  }

  const zonePreco = h('div', {}, h('p', { class: 'discret curseur' }, d.iaInstallee ? 'L’IA lit la visite et les pannes' : ''))
  const admin = modeAdmin()
  const reco = d.recommandation
  const retour = `#/mn1/parc/${encodeURIComponent(parcId)}?machine=${machineId}`
  const lienCase = (s) => `#/mn1/decider/${encodeURIComponent(parcId)}/${machineId}/${s.equipement}?pose=${s.pose}&titre=${encodeURIComponent(s.titre)}`
  const bouton = (cle, texte, icone, action, aide) => h('button', { class: reco?.action === cle ? 'principal' : '', 'data-decision': cle, title: aide, onclick: action }, ic(icone, 14), texte)
  const apresGain = (message) => { notifier(message); location.hash = d.suivant ? lienCase(d.suivant) : retour }
  // Simulé d'abord : la fenêtre montre ce qui serait écrit, le gain, et n'écrit qu'à la validation.
  const appliquer = async (action, titreFenetre, libelle, enPlus = {}) => {
    const corps = { ...croisee, action, ...enPlus }
    const r = await essayer(() => api(`${base}/decider/appliquer`, { methode: 'POST', corps }))
    if (!r) return null
    if (!r.modifiees) { notifier(`La simulation ne modifierait rien pour ${r.numero} : vérifiez le SQL du site.`, 'erreur'); return null }
    const ok = await fenetre({
      titre: `${titreFenetre} : FI ${r.numero}`,
      contenu: h('div', {},
        h('p', { style: { marginTop: 0 } }, h('b', {}, v.titre)),
        r.heures ? h('p', { class: 'gain-fenetre' }, `${heuresFr(r.heures)} par an rendues à l’équipe`) : null,
        h('p', { class: 'texte-2' }, `Simulation : ${r.modifiees} ligne${r.modifiees > 1 ? 's' : ''} modifiée${r.modifiees > 1 ? 's' : ''} dans la GMAO. L’historique reste.`),
        action === 'supprimer' ? citation(CITATIONS.supprimer) : null),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: libelle, classe: 'principal', action: async () => { await api(`${base}/decider/appliquer`, { methode: 'POST', corps: { ...corps, valider: true } }); return true } }],
    })
    return ok ? r : null
  }
  const supprimer = async () => {
    const r = await appliquer('supprimer', 'Retirer du plan', 'Désactiver dans la GMAO')
    if (r) apresGain(`Une visite de moins${r.heures ? ` : ${heuresFr(r.heures)} par an rendues` : ''}`)
  }
  const espacer = async () => {
    const choix = h('select', {}, d.frequences.map((x) => h('option', { value: x }, x)))
    const frequence = await fenetre({
      titre: 'Espacer cette visite',
      contenu: h('div', {}, h('p', { style: { marginTop: 0 } }, `${v.passages} passage${v.passages > 1 ? 's' : ''} sur 12 mois. Nouvelle fréquence :`), choix),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Simuler', classe: 'principal', action: () => choix.value }],
    })
    if (!frequence) return
    const r = await appliquer('espacer', 'Espacer', 'Écrire dans la GMAO', { frequence })
    if (r) apresGain(`Visite espacée${r.heures ? ` : ${heuresFr(r.heures)} par an rendues` : ''}`)
  }
  const blocProtection = h('label', { class: 'protection-decider' },
    admin ? h('input', { type: 'checkbox', checked: d.protection.protegee, onchange: async (e) => {
      await essayer(() => api(`${base}/decider/proteger`, { methode: 'POST', corps: { pose, titre, protegee: e.target.checked } }))
      afficherDecider(zone, parcId, machineId, croisee)
    } }) : null,
    d.protection.protegee ? `Protégée : sécurité ou réglementaire${d.protection.raison ? ` (${d.protection.raison})` : ''}` : admin ? 'Protéger cette visite (sécurité, réglementaire)' : '')
  const montrerPreco = (lignes) => vider(zonePreco, lignes.length ? h('ul', { class: 'conseils-decider' }, lignes.map((x) => h('li', {}, x))) : h('p', { class: 'discret' }, 'Rien de particulier à préconiser.'))
  if (d.iaInstallee) api(`${base}/decider/preconisations`, { methode: 'POST', corps: croisee }).then((r) => montrerPreco(r.lignes)).catch(() => montrerPreco(d.conseils))
  else montrerPreco(d.conseils)

  vider(zone, barreRetour(`Démonstrateur · ${d.machine.repere}`, `#/mn1/parc/${encodeURIComponent(parcId)}?machine=${machineId}`), filEtapes(4, d.parc, d.machine),
    h('div', { class: 'tete-machine' }, h('h1', {}, h('span', { class: 'mono' }, c.repere), h('span', { class: 'nom-machine' }, [c.designation, d.machine.repere, d.parc.nom].filter(Boolean).join(' · ')))),
    h('div', { class: 'detail-decider' },
      h('div', { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, v.code ? h('span', { class: 'etiquette code-visite' }, v.code.code) : null, v.titre), h('span', { class: 'discret' }, `${v.passages} passage${v.passages > 1 ? 's' : ''} sur 12 mois · dernier le ${dateFr(v.derniere)}`)),
        v.deplacee ? h('p', { class: 'discret petit-texte' }, 'Déplacée sur cet équipement dans la GMAO ; les rapports déjà faits restent sur la machine entière.') : null,
        blocProtection,
        v.placee ? h('p', { class: 'discret petit-texte' }, 'Déplacée ici dans PREVTEC seulement : à valider dans le Démonstrateur.') : null,
        d.posee ? (v.dapresTitre ? h('p', { class: 'discret petit-texte' }, 'Posée sur la machine entière dans la GMAO ; rattachée à cet équipement d’après son titre.') : null) : h('p', { class: 'etiquette orange' }, 'Cette visite n’est pas posée sur cet équipement.'),
        h('h3', { class: 'titre-decider' }, v.fi ? `Contenu de la FI ${v.fi}` : 'Contenu de la FI'),
        v.contenu ? h('p', { class: 'fi-actuelle' }, v.contenu) : h('p', { class: 'discret' }, v.fi ? 'Cette FI n’a pas de texte dans les rapports de la GMAO.' : 'Pas de FI dans les rapports de la GMAO.'),
        h('h3', { class: 'titre-decider' }, 'Observations des derniers passages'),
        v.observations.length ? h('ul', { class: 'observations-decider' }, v.observations.map((o) => h('li', {}, h('span', { class: 'discret' }, `${dateFr(o.date)} : `), o.texte))) : h('p', { class: 'discret' }, 'Aucune observation écrite sur ces passages.')),
      h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic('etincelle', 18), 'Préconisations')), zonePreco),
      h('div', { class: 'carte carte-decisions' }, h('div', { class: 'carte-entete' }, h('h2', {}, 'Je décide')),
        c.diagnostic === 'sur' ? citation(CITATIONS.surMaintenance) : null,
        reco ? h('p', { class: 'reco-decider' }, h('b', {}, 'Recommandé : '), reco.raison) : d.protection.protegee ? null : h('p', { class: 'discret' }, v.espacee ? `Visite déjà espacée le ${dateFr(v.espacee)}.` : 'Rien à changer d’après les chiffres : c’est une bonne nouvelle.'),
        h('div', { class: 'actions' },
          [
            admin && !d.protection.protegee && !v.espacee ? bouton('supprimer', 'Supprimer cette visite', 'x', supprimer, 'Retire la visite du plan : sa FI est désactivée dans la GMAO, l’historique reste') : null,
            admin && !d.protection.protegee && d.frequences.length ? bouton('espacer', 'Espacer', 'horloge', espacer, 'Choisir une fréquence plus longue, écrite dans la GMAO') : null,
            d.iaInstallee ? bouton('modifier', 'Modifier la FI actuelle', 'etincelle', modifierFi, 'L’IA revoit le contenu de cette FI, à côté de la version actuelle') : null,
            c.panne ? bouton('n1', 'Créer une fiche N1', 'etincelle', ficheN1, `L’IA rédige une fiche de niveau 1 pour : ${c.panne.symptome}`) : null,
          ].filter(Boolean).sort((a, b) => (b.dataset.decision === reco?.action) - (a.dataset.decision === reco?.action)),
          h('button', { title: 'L’historique des pannes de ce qu’elle couvre, à imprimer pour le mainteneur', onclick: () => ouvrirFicheVisite(base, { ...v, equipement: c.id, dapresTitre: c.id !== v.pose }) }, ic('document', 14), 'Fiche de visite à imprimer')),
        d.suivant ? h('a', { class: 'bouton cas-suivant', href: lienCase(d.suivant) }, 'Cas suivant →') : null,
        zoneSuite)))
}
