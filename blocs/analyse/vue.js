// La fiche d'analyse d'une machine : chiffres sur 12 mois, interventions par mois, pannes connues,
// intervenants, dernières interventions, et le résumé de l'IA avec ses conseils (consignes derrière le rouage).

import { h, vider, ic, dateFr, nombreFr, ilYa, essayer, fenetre, notifier, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { barres, barresHorizontales, COULEURS } from '/socle/graphiques.js'
import { texteIA } from '/socle/texte-ia.js'
import { animer } from '../tableau-de-bord/vue.js'

const LOGO_MN1 = new URL('../../interface/mn1.webp', import.meta.url).href
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

export default {
  chemin: 'analyse',
  titre: 'Analyse d’une machine',
  icone: 'graphique',
  menu: false,
  aide: 'tableau-de-bord',

  async afficher(zone, { id }) {
    const d = await api(`/api/analyse/${id}`)
    const m = d.machine
    const c = d.chiffres
    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('button', { class: 'discret icone-seule', title: 'Retour', onclick: () => history.back() }, ic('retour')),
        h('div', { style: { flex: 1 } }, h('h1', {}, h('span', { class: 'mono' }, m.repere), m.designation ? ` — ${m.designation}` : ''), h('p', { class: 'sous-titre' }, ['Fiche d’analyse', m.marque, m.modele, m.etat].filter(Boolean).join(' · '))),
        h('div', { class: 'actions' },
          h('a', { class: 'bouton', href: `#/parc/${m.id}` }, ic('usine', 16), 'Fiche machine'),
          h('a', { class: 'bouton', href: `#/assistant?machine=${m.id}` }, ic('etincelle', 16), 'Demander à l’assistant'))),

      h('div', { class: 'grille grille-4', style: { marginBottom: '16px' } },
        tuile('alerte', 'violet', 'Pannes (12 mois)', c.pannes12Mois, h('span', { class: 'ecart' }, `${c.pannes3Mois} ces 3 mois`)),
        tuile('rafraichir', 'bleu', 'Préventifs (12 mois)', c.preventifs12Mois, null),
        tuile('horloge', '', 'Temps passé (12 mois)', c.heures12Mois, h('small', {}, 'heures')),
        tuile('historique', '', 'Dernière intervention', null, h('span', { class: 'texte-dernier' }, c.derniere ? `${dateFr(c.derniere)} · ${depuis(c.derniere)}` : '—'))),

      h('div', { class: 'grille grille-3' },
        carteResume(m.id, d.resume),
        h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('graphique', 'Interventions par mois', '12 derniers mois'), graphiqueMois(d.parMois)),
        h('div', { class: 'carte' }, entete('personne', 'Intervenants', '12 mois'), d.intervenants.length ? barresHorizontales(d.intervenants.map((i) => ({ etiquette: i.nom, valeur: i.nombre })), { couleur: COULEURS.bleu }) : h('div', { class: 'vide' }, 'Personne sur 12 mois.')),
        d.pannes.length || !d.repetees.length
          ? h('div', { class: 'carte pleine' }, entete('historique', 'Pannes connues', `${d.pannes.length} panne${d.pannes.length > 1 ? 's' : ''} qui reviennent`), listePannes(d.pannes))
          : h('div', { class: 'carte pleine' }, entete('historique', 'Pannes qui reviennent', 'regroupées depuis les rapports'), listeRepetees(d.repetees)),
        h('div', { class: 'carte pleine' }, entete('cle', 'Dernières interventions'), listeInterventions(d.dernieres)),
      ),
    )
    animer(zone)
  },
}

// « aujourd'hui », « hier », « il y a 27 jours » (les dates de la GMAO n'ont pas d'heure).
function depuis(date) {
  const jours = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(`${date}T00:00:00`)) / 86_400_000)
  return jours <= 0 ? 'aujourd’hui' : jours === 1 ? 'hier' : `il y a ${jours} jours`
}

function tuile(icone, couleur, libelle, valeur, detail) {
  return h('div', { class: 'tuile' },
    h('div', { class: 'libelle' }, h('span', { class: `pastille ${couleur}` }, ic(icone, 16)), libelle),
    h('div', { class: 'valeur' }, valeur === null ? '' : nombreFr(valeur), detail))
}

function entete(icone, titre, detail) {
  return h('div', { class: 'carte-entete' }, h('h2', {}, ic(icone, 18), titre), detail ? h('span', { class: 'discret' }, detail) : null)
}

function graphiqueMois(parMois) {
  const series = [
    { cle: 'correctif', nom: 'Correctif', couleur: COULEURS.violet },
    { cle: 'preventif', nom: 'Préventif', couleur: COULEURS.bleu },
    { cle: 'autre', nom: 'Autre', couleur: COULEURS.turquoise },
  ]
  return h('div', {},
    barres(parMois.map((x) => ({ etiquette: MOIS[Number(x.mois.slice(5)) - 1], valeurs: x })), series),
    h('div', { class: 'legende ligne', style: { marginTop: '8px' } }, series.map((s) => h('div', {}, h('span', { class: 'point', style: { color: s.couleur } }), s.nom))))
}

function listePannes(pannes) {
  if (!pannes.length) return h('div', { class: 'vide' }, 'Pas de panne connue : lancez l’analyse de sa ligne (écran « Pannes connues »).')
  return h('div', { class: 'pannes-analyse' }, pannes.slice(0, 8).map((p) => h('a', { class: 'panne-analyse', href: `#/pannes?id=${p.id}` },
    h('div', { class: 'tete-panne-analyse' }, h('b', {}, p.symptome), h('span', { class: 'cas-panne' }, `${p.nombre} cas`)),
    h('div', { class: 'frequence-panne' }, ic('horloge', 12), p.frequence),
    p.causes[0] ? h('div', { class: 'texte-2' }, `${p.causes[0].cause} → ${p.causes[0].remede}`) : null)))
}

// Sans pannes connues : les rapports semblables regroupés par AITEC, avec leur fréquence.
function listeRepetees(repetees) {
  return h('div', { class: 'pannes-analyse' },
    h('p', { class: 'discret', style: { margin: '0 0 4px', fontSize: '13px' } }, 'La ligne de cette machine n’a pas encore été analysée (écran « Pannes connues ») : voici les rapports semblables regroupés, sans les causes.'),
    repetees.slice(0, 8).map((p) => h('div', { class: 'panne-analyse' },
      h('div', { class: 'tete-panne-analyse' }, h('b', {}, p.symptome), h('span', { class: 'cas-panne' }, `${p.nombre} cas`)),
      h('div', { class: 'frequence-panne' }, ic('horloge', 12), p.frequence),
      p.actions[0] ? h('div', { class: 'texte-2' }, p.actions[0]) : null)))
}

// Les gestes de maintenance de niveau 1 : l'IA les écrit « [MN1 Production] … » ou « [MN1 Maintenance] … ».
// On les sort du texte pour les montrer à part, en encadrés, avec le logo MN1.
const LIGNE_MN1 = /^\s*(?:[-*•]|\d+\.)?\s*\**\[MN1\s+(Production|Maintenance)\]\**\s*:?\s*(.+)$/i
function texteAvecMN1(texte) {
  const gestes = []
  const reste = String(texte || '').split('\n').filter((ligne) => {
    const m = LIGNE_MN1.exec(ligne)
    if (m) gestes.push({ pour: m[1].toLowerCase() === 'production' ? 'Production' : 'Maintenance', texte: m[2].trim() })
    return !m
  })
  // Le titre « Maintenance de niveau 1 » de l'IA : les encadrés ont le leur.
  const corps = reste.join('\n').replace(/\n?\**\s*Maintenance de niveau 1\s*\**\s*:?\s*$/im, '').trim()
  const html = h('div', {})
  html.innerHTML = texteIA(corps)
  if (gestes.length) {
    html.append(h('div', { class: 'bloc-mn1' },
      h('div', { class: 'titre-mn1' }, h('img', { src: LOGO_MN1, alt: 'MN1' }), h('span', {}, 'Maintenance de niveau 1')),
      gestes.map((g) => {
        const t = h('span', {})
        t.innerHTML = texteIA(g.texte).replace(/^<p>|<\/p>$/g, '')
        return h('div', { class: `geste-mn1 ${g.pour === 'Production' ? 'production' : 'maintenance'}` },
          h('img', { src: LOGO_MN1, alt: '' }),
          h('div', {}, h('span', { class: 'pour-mn1' }, g.pour), t))
      })))
  }
  return html
}

function listeInterventions(liste) {
  return tableau({
    lignes: liste,
    vide: 'Aucune intervention.',
    surClic: (i) => (location.hash = `#/interventions/${i.id}`),
    colonnes: [
      { titre: 'Date', classe: 'col-date', valeur: (i) => h('span', { class: 'discret' }, dateFr(i.date)) },
      { titre: 'Type', valeur: (i) => h('span', { class: `etiquette ${i.type === 'Correctif' ? 'violet' : ''}` }, i.type) },
      { titre: 'Description', classe: 'col-description', valeur: (i) => h('span', { class: 'texte-2', title: i.description }, i.description) },
      { titre: 'Intervenant(s)', classe: 'col-intervenants', valeur: (i) => h('span', { title: i.intervenant || '' }, i.intervenant || '—') },
    ],
  })
}

// Le résumé de l'IA, avec le rouage de ses consignes (administrateur).
function carteResume(id, resume) {
  const corps = h('div', { class: 'texte-ia' })
  const date = h('span', { class: 'discret' })
  const bouton = h('button', { class: 'petit', onclick: analyser }, ic('rafraichir', 15), resume ? 'Actualiser' : 'Analyser')
  function montrer(r) {
    vider(corps, texteAvecMN1(r.texte))
    date.textContent = ilYa(r.date)
  }
  async function analyser() {
    bouton.disabled = true
    corps.innerHTML = '<p class="discret curseur">L’IA lit l’historique de la machine</p>'
    const r = await essayer(() => api(`/api/analyse/${id}/resume`, { methode: 'POST' }))
    bouton.disabled = false
    if (r) montrer(r)
    else corps.textContent = ''
  }
  if (resume) montrer(resume)
  else corps.append(h('p', { class: 'texte-2' }, 'L’IA résume l’état de la machine, les pannes qui reviennent, et propose quelques conseils (préventif, pièces, améliorations).'))
  const rouage = peutModifier() ? h('button', { class: 'discret icone-seule petit', title: 'Les consignes données à l’IA pour ce résumé', onclick: () => modifierConsignes(analyser) }, ic('reglages', 16)) : null
  return h('div', { class: 'carte pleine carte-resume' },
    h('div', { class: 'carte-entete' }, h('h2', {}, h('span', { class: 'pastille', style: { color: 'var(--accent)' } }, ic('etincelle', 18)), 'Résumé et conseils'), h('div', { class: 'actions' }, date, rouage)),
    corps,
    h('div', { class: 'actions', style: { marginTop: '12px' } }, bouton))
}

async function modifierConsignes(analyser) {
  const c = await essayer(() => api('/api/analyse/consignes'))
  if (!c) return
  const texte = h('textarea', { rows: 12 }, c.texte)
  const enregistrees = await fenetre({
    titre: 'Consignes du résumé d’une machine',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Ce que l’IA doit écrire en lisant les données d’une machine (chiffres, pannes connues, dernières interventions) : parties, longueur, type de conseils. Les mêmes consignes servent pour toutes les machines.'),
      texte),
    boutons: [
      { texte: 'Revenir à l’original', classe: 'discret', action: () => { texte.value = c.origine; return false } },
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api('/api/analyse/consignes', { methode: 'POST', corps: { texte: texte.value } }); return true } },
    ],
  })
  if (enregistrees) {
    notifier('Consignes enregistrées')
    analyser()
  }
}
