// Tableau de bord : tuiles chiffrées, graphiques, remarques de l'IA.

import { h, vider, ic, dateFr, nombreFr, ilYa, essayer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { barres, anneau, barresHorizontales, COULEURS } from '/socle/graphiques.js'
import { texteIA } from '/socle/texte-ia.js'
import { etat } from '/socle/etat.js'
import { texteSeul } from '../interventions/vue.js'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
// Mêmes couleurs que le graphique par mois : correctif en violet, préventif en bleu.
const COULEURS_TYPES = { Correctif: COULEURS.violet, Préventif: COULEURS.bleu }
const AUTRES_COULEURS = [COULEURS.turquoise, COULEURS.orange, COULEURS.gris, COULEURS.rouge]

export default {
  chemin: 'tableau-de-bord',
  titre: 'Tableau de bord',
  icone: 'tableau',
  menu: true,
  aide: 'tableau-de-bord',

  async afficher(zone) {
    const d = await api('/api/tableau-de-bord')
    const t = d.tuiles
    const ecart = t.interventions30j - t.interventions30jAvant

    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, d.atelier || 'Tableau de bord'), h('p', { class: 'sous-titre' }, 'Vue d’ensemble du parc et de la maintenance'))),

      t.machines === 0 ? bandeauDemarrage() : null,

      h(
        'div',
        { class: 'grille grille-3', style: { marginBottom: '16px' } },
        tuile('usine', '', 'Machines', nombreFr(t.machines), t.machinesHorsService ? h('span', { class: 'ecart' }, `${t.machinesHorsService} hors service`) : null, null),
        tuile('cle', 'violet', 'Interventions (30 j)', nombreFr(t.interventions30j), ecart ? h('span', { class: `ecart ${ecart > 0 ? 'hausse' : 'baisse'}`, title: 'Par rapport aux 30 jours précédents' }, `${ecart > 0 ? '+' : ''}${ecart}`) : null, null),
        tuile('document', 'bleu', 'Documents', nombreFr(t.documents), t.documents ? h('small', {}, `${nombreFr(t.documentsLus)} lus par l’IA`) : null, '#/administration/documents'),
      ),

      h(
        'div',
        { class: 'grille grille-3' },
        h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('graphique', 'Interventions par mois', '12 derniers mois'), graphiqueMois(d.parMois)),
        carteRemarques(d.remarques),
        h('div', { class: 'carte' }, entete('cle', 'Types d’intervention', '12 mois'), graphiqueTypes(d.parType)),
        h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('alerte', 'Machines les plus en panne', 'correctif, 12 mois'), graphiquePannes(d.machinesEnPanne)),
        h('div', { class: 'carte pleine' }, entete('historique', 'Dernières interventions'), listeInterventions(d.dernieresInterventions)),
      ),
    )
  },
}

function tuile(icone, couleur, libelle, valeur, detail, lien) {
  return h(
    lien ? 'a' : 'div',
    { class: 'tuile', href: lien, style: { color: 'inherit', textDecoration: 'none' } },
    h('div', { class: 'libelle' }, h('span', { class: `pastille ${couleur}` }, ic(icone, 16)), libelle),
    h('div', { class: 'valeur' }, valeur, detail),
  )
}

function entete(icone, titre, detail) {
  return h('div', { class: 'carte-entete' }, h('h2', {}, ic(icone, 18), titre), detail ? h('span', { class: 'discret' }, detail) : null)
}

function bandeauDemarrage() {
  return h(
    'div',
    { class: 'bandeau info' },
    ic('etincelle'),
    h('div', {}, h('strong', {}, 'La base est vide. '), 'Dans Administration, importez les exports de votre GMAO (machines, historique des interventions) et déposez les notices des machines. ', h('a', { href: '#/aide/premiers-pas' }, 'Voir les premiers pas')),
  )
}

function graphiqueMois(parMois) {
  const series = [
    { cle: 'correctif', nom: 'Correctif', couleur: COULEURS.violet },
    { cle: 'preventif', nom: 'Préventif', couleur: COULEURS.bleu },
    { cle: 'autre', nom: 'Autre', couleur: COULEURS.turquoise },
  ]
  const donnees = parMois.map((m) => ({ etiquette: MOIS[Number(m.mois.slice(5)) - 1], valeurs: m }))
  return h(
    'div',
    {},
    barres(donnees, series),
    h('div', { class: 'legende ligne', style: { marginTop: '8px' } }, series.map((s) => h('div', {}, h('span', { class: 'point', style: { color: s.couleur } }), s.nom))),
  )
}

function graphiqueTypes(parType) {
  if (!parType.length) return h('div', { class: 'vide' }, 'Aucune intervention sur 12 mois.')
  const total = parType.reduce((s, t) => s + t.nombre, 0)
  let autre = 0
  const segments = parType.slice(0, 6).map((t) => ({ nom: t.type, valeur: t.nombre, couleur: COULEURS_TYPES[t.type] || AUTRES_COULEURS[autre++ % AUTRES_COULEURS.length] }))
  return h(
    'div',
    { class: 'anneau-et-legende' },
    anneau(segments),
    h('div', { class: 'legende' }, segments.map((s) => h('div', {}, h('span', { class: 'point', style: { color: s.couleur } }), h('b', {}, `${Math.round((s.valeur / total) * 100)} %`), s.nom))),
  )
}

function graphiquePannes(machines) {
  if (!machines.length) return h('div', { class: 'vide' }, 'Aucune panne enregistrée sur 12 mois.')
  return barresHorizontales(machines.map((m) => ({ etiquette: `${m.repere} · ${m.designation}`, valeur: m.pannes })))
}

function listeInterventions(liste) {
  if (!liste.length) return h('div', { class: 'vide' }, 'Aucune intervention.')
  return h(
    'div',
    { class: 'legende' },
    liste.map((i) =>
      h('a', { href: `#/interventions/${i.id}`, style: { display: 'flex', gap: '12px', color: 'inherit', alignItems: 'center' } },
        h('span', { class: 'discret', style: { minWidth: '84px' } }, dateFr(i.date)),
        h('span', { class: `etiquette ${i.type === 'Correctif' ? 'violet' : ''}` }, i.type),
        h('b', { class: 'mono' }, i.repere || ''),
        h('span', { class: 'texte-2', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, texteSeul(i.description)),
      ),
    ),
  )
}

// « Ce que l'IA remarque »
function carteRemarques(remarques) {
  const corps = h('div', { class: 'texte-ia' })
  const date = h('span', { class: 'discret' })
  const bouton = h('button', { class: 'petit', onclick: analyser }, ic('rafraichir', 15), remarques ? 'Actualiser' : 'Analyser')

  function montrer(r) {
    corps.innerHTML = texteIA(r.texte)
    date.textContent = ilYa(r.date)
  }
  async function analyser() {
    bouton.disabled = true
    corps.innerHTML = '<p class="discret curseur">L’IA lit les chiffres de la base</p>'
    const r = await essayer(() => api('/api/tableau-de-bord/remarques', { methode: 'POST' }))
    bouton.disabled = false
    if (r) montrer(r)
    else corps.textContent = ''
  }

  if (remarques) montrer(remarques)
  else corps.append(h('p', { class: 'texte-2' }, 'L’IA peut relever les points qui demandent votre attention : pannes en hausse, pannes récurrentes, machines sans documentation…'))

  return h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, h('span', { class: 'pastille', style: { color: 'var(--accent)' } }, ic('etincelle', 18)), 'Ce que l’IA remarque'), date), corps, h('div', { class: 'actions', style: { marginTop: '12px' } }, bouton, h('a', { class: 'bouton petit', href: '#/assistant' }, ic('etincelle', 14), 'Poser une question')))
}
