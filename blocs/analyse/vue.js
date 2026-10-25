// La fiche d'analyse d'une machine : chiffres sur 12 mois, interventions par mois, pannes connues,
// intervenants, dernières interventions, et le résumé de l'IA avec ses conseils (consignes derrière le rouage).

import { h, vider, ic, dateFr, nombreFr, ilYa, essayer, fenetre, notifier, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { barres, barresHorizontales, COULEURS } from '/socle/graphiques.js'
import { texteIA } from '/socle/texte-ia.js'
import { animer } from '../tableau-de-bord/vue.js'
import { LOGO_MN1, carteFiche, frequenceCalendaire, definirParametres } from '../../interface/fiches-mn1.js'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

export default {
  chemin: 'analyse',
  titre: 'Analyse d’une machine',
  icone: 'graphique',
  menu: false,
  aide: 'tableau-de-bord',

  async afficher(zone, { id }) {
    const [d, parametres] = await Promise.all([api(`/api/analyse/${id}`), api('/api/mn1/parametres').catch(() => null)])
    definirParametres(parametres)
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
        h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('graphique', 'Interventions par mois', '12 derniers mois'), graphiqueMois(d.parMois)),
        carteResume(d),
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

// Le résumé de l'IA mis en forme : « En bref » en bandeau, « Pannes qui reviennent » et « Conseils » côte à
// côte, puis les gestes de maintenance de niveau 1 en encadrés (avec l'ETH et la machine). L'IA écrit chaque
// geste « [MN1 Production] … » ou « [MN1 Maintenance] … » : on les sort du texte pour les montrer à part.
const LIGNE_MN1 = /^\s*(?:[-*•]|\d+\.)?\s*\**\[MN1\s+(Production|Maintenance|Formation)\]\**\s*:?\s*(.+)$/i
const GESTES_MAX = 3
const TITRES = [['bref', /^en bref/i], ['pannes', /^pannes qui reviennent/i], ['conseils', /^conseils/i], ['mn1', /^maintenance de niveau 1/i]]

function decouperResume(texte) {
  const parties = { avant: [], bref: [], pannes: [], conseils: [], mn1: [] }
  const gestes = []
  const formations = []
  let partie = 'avant'
  for (const ligne of String(texte || '').split('\n')) {
    const geste = LIGNE_MN1.exec(ligne)
    if (geste) {
      const quoi = geste[1].toLowerCase()
      // « geste | fréquence | panne évitée » (l'IA peut aussi tout écrire d'un bloc).
      const [action, frequence = '', evite = ''] = geste[2].split('|').map((x) => x.replace(/\*\*/g, '').trim())
      if (quoi === 'formation') formations.push(geste[2].replace(/\*\*/g, '').trim())
      // Le niveau 1 est fait par la production ; un geste de technicien repart dans les conseils.
      else if (quoi === 'production') gestes.push({ pour: 'Production', action, frequence, evite })
      else parties.conseils.push(`- **Maintenance** : ${action}${frequence ? ` (${frequence})` : ''}${evite ? ` — évite : ${evite}` : ''}`)
      continue
    }
    // Un titre « **En bref** : … » (ou « ### Conseils ») ouvre une partie ; ce qui suit sur la ligne lui appartient.
    const nu = ligne.replace(/^[#\s]*\**\s*/, '')
    const titre = TITRES.find(([, motif]) => motif.test(nu))
    if (titre) {
      partie = titre[0]
      const reste = nu.replace(titre[1], '').replace(/^\s*\**\s*:?\s*\**\s*/, '')
      if (reste) parties[partie].push(reste)
      continue
    }
    parties[partie].push(ligne)
  }
  // La formation des opérateurs va dans l'en-tête de la maintenance de niveau 1, même si l'IA l'a mise
  // dans les conseils.
  parties.conseils = parties.conseils.filter((ligne) => {
    if (!(/(?<!\p{L})(formation|former|sensibiliser)/iu.test(ligne) && /op[ée]rateur|conducteur/i.test(ligne))) return true
    formations.push(ligne.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').replace(/^\**\s*[^:*]{0,40}?\**\s*:\s*/, '').replace(/\*\*/g, '').trim())
    return false
  })
  return { parties, gestes, formations }
}

function rendreResume(texte, d) {
  const { parties, gestes, formations } = decouperResume(texte)
  const html = (lignes) => { const e = h('div', { class: 'texte-ia' }); e.innerHTML = texteIA(lignes.join('\n').trim()); return e }
  const vide = (lignes) => !lignes.join('').trim()
  const section = (titre, icone, lignes) => (vide(lignes) ? null : h('section', { class: 'section-analyse' }, h('h3', {}, ic(icone, 16), titre), html(lignes)))
  // Rien de reconnu (consignes changées) : le texte tel quel.
  if (vide(parties.bref) && vide(parties.pannes) && vide(parties.conseils)) return h('div', {}, html([...parties.avant, ...parties.mn1]), blocMN1(gestes, formations, d))
  return h('div', { class: 'analyse-deployee' },
    vide(parties.avant) ? null : html(parties.avant),
    vide(parties.bref) ? null : h('div', { class: 'bref-analyse' }, h('div', { class: 'titre-bref' }, ic('etincelle', 15), 'En bref'), html(parties.bref)),
    h('div', { class: 'colonnes-analyse' },
      section('Pannes qui reviennent', 'alerte', parties.pannes),
      section('Conseils', 'coche', parties.conseils)),
    vide(parties.mn1) ? null : html(parties.mn1),
    blocMN1(gestes, formations, d))
}

// L'encadré MN1 : en tête, la formation des opérateurs s'il y en a ; puis 3 fiches au plus, côte à côte.
// Un clic sur une fiche ouvre sa version à imprimer (A5 paysage) ; « Garder » la range dans le menu
// « Maintenance de niveau 1 ».
function blocMN1(gestes, formations, d) {
  if (!gestes.length && !formations.length) return null
  const gardees = new Set((d.fichesMN1 || []).map((f) => f.action.toLowerCase()))
  return h('div', { class: 'bloc-mn1' },
    h('div', { class: 'tete-mn1' },
      h('div', { class: 'titre-mn1' }, h('img', { src: LOGO_MN1, alt: 'MN1' }), h('span', {}, 'Maintenance de niveau 1'), h('a', { class: 'lien-mn1', href: '#/mn1' }, 'Toutes les fiches ›')),
      formations.map((f) => h('div', { class: 'formation-mn1' }, ic('personne', 15), h('b', {}, 'Formation des opérateurs'), h('span', {}, f)))),
    gestes.length ? h('div', { class: 'fiches-mn1' }, gestes.slice(0, GESTES_MAX).map((g) => {
      const fiche = { ...g, frequence: frequenceCalendaire(g.frequence), repere: d.machine.repere, designation: d.machine.designation, eth: d.place?.eth || '', ligne: d.place?.ligne || '' }
      const etat = h('div', { class: 'garder-mn1' })
      const dessinerEtat = () => vider(etat, gardees.has(g.action.toLowerCase())
        ? h('span', { class: 'gardee-mn1' }, ic('coche', 13), 'Dans les fiches MN1')
        : peutModifier() ? h('button', { class: 'petit', onclick: async () => {
          if (await essayer(() => api('/api/mn1/fiches', { methode: 'POST', corps: { machine_id: d.machine.id, pour: fiche.pour, action: fiche.action, frequence: fiche.frequence, evite: fiche.evite, eth: fiche.eth, ligne: fiche.ligne } }), 'Fiche gardée dans « Maintenance de niveau 1 »')) { gardees.add(g.action.toLowerCase()); dessinerEtat() }
        } }, ic('plus', 13), 'Garder dans les fiches MN1') : null)
      dessinerEtat()
      return carteFiche(fiche, { enPlus: etat })
    })) : null)
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

// Le résumé de l'IA, avec le rouage de ses consignes (administrateur). Compact tant qu'il n'est pas écrit ;
// une fois chargé, il s'agrandit sur toute la largeur et passe en tête.
function carteResume(d) {
  const corps = h('div', {})
  const date = h('span', { class: 'discret' })
  const bouton = h('button', { class: 'petit', onclick: analyser }, ic('rafraichir', 15), d.resume ? 'Actualiser' : 'Analyser')
  const carte = h('div', { class: 'carte carte-resume' })
  function montrer(r, avecEffet) {
    vider(corps, rendreResume(r.texte, d))
    date.textContent = ilYa(r.date)
    bouton.textContent = 'Actualiser'
    // L'encart s'agrandit sur toute la largeur ; l'animation n'est jouée qu'à l'arrivée d'un nouveau résumé.
    carte.classList.toggle('vient-de-deployer', avecEffet)
    carte.classList.add('deployee')
  }
  async function analyser() {
    bouton.disabled = true
    vider(corps, h('p', { class: 'discret curseur' }, 'L’IA lit l’historique de la machine'))
    const r = await essayer(() => api(`/api/analyse/${d.machine.id}/resume`, { methode: 'POST' }))
    bouton.disabled = false
    if (r) {
      montrer(r, true)
      if (carte.classList.contains('deployee')) setTimeout(() => carte.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
    } else vider(corps)
  }
  if (d.resume) montrer(d.resume, false)
  else corps.append(h('p', { class: 'texte-2' }, 'L’IA résume l’état de la machine, les pannes qui reviennent avec leur fréquence, et propose des conseils, dont les gestes de maintenance de niveau 1.'))
  const rouage = peutModifier() ? h('button', { class: 'discret icone-seule petit', title: 'Les consignes données à l’IA pour ce résumé', onclick: () => modifierConsignes(analyser) }, ic('reglages', 16)) : null
  return vider(carte,
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
