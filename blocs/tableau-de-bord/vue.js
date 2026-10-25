// Tableau de bord : tuiles chiffrées, graphiques, remarques de l'IA.

import { h, vider, ic, dateFr, nombreFr, ilYa, essayer, fenetre, notifier, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { barres, anneau, barresHorizontales, COULEURS } from '/socle/graphiques.js'
import { texteIA } from '/socle/texte-ia.js'
import { etat } from '/socle/etat.js'
import { texteSeul } from '../interventions/vue.js'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
// Mêmes couleurs que le graphique par mois : correctif en violet, préventif en bleu.
const COULEURS_TYPES = { Correctif: COULEURS.violet, Préventif: COULEURS.bleu }
const AUTRES_COULEURS = [COULEURS.turquoise, COULEURS.orange, COULEURS.gris, COULEURS.rouge]

// Les lignes choisies en haut du tableau de bord, gardées sur ce poste (aucune : toutes).
const CLE_LIGNES = 'aitec-tableau-lignes'
function lireSelection() {
  try {
    return JSON.parse(localStorage.getItem(CLE_LIGNES) || '[]')
  } catch {
    return []
  }
}
function garderSelection(selection) {
  try {
    localStorage.setItem(CLE_LIGNES, JSON.stringify(selection))
  } catch {}
}

export default {
  chemin: 'tableau-de-bord',
  titre: 'Tableau de bord',
  icone: 'tableau',
  menu: true,
  aide: 'tableau-de-bord',

  async afficher(zone) {
    let selection = lireSelection()
    const dessiner = async () => {
      const d = await api(`/api/tableau-de-bord${selection.length ? `?lignes=${encodeURIComponent(selection.join(','))}` : ''}`)
      selection = d.perimetre.selection
      const choisir = (nouvelle) => {
        selection = nouvelle
        garderSelection(selection)
        dessiner()
      }
      afficherTableau(zone, d, selection, choisir)
      animer(zone)
    }
    await dessiner()
  },
}

function afficherTableau(zone, d, selection, choisir) {
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

    barrePerimetre(d.perimetre, selection, choisir),

    h(
      'div',
      { class: 'grille grille-3' },
      h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('graphique', 'Interventions par mois', '12 derniers mois'), graphiqueMois(d.parMois)),
      carteRemarques(d.remarques, selection),
      h('div', { class: 'carte' }, entete('cle', 'Types d’intervention', '12 mois'), graphiqueTypes(d.parType)),
      h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('alerte', 'Machines les plus en panne', 'correctif, 12 mois'), graphiquePannes(d.machinesEnPanne)),
      h('div', { class: 'carte pleine' }, entete('historique', 'Dernières interventions'), listeInterventions(d.dernieresInterventions)),
    ),
  )
}

// Les lignes (plus haut niveau de l'arborescence) à compter : aucune cochée = toutes. Avec plusieurs
// arborescences, chaque ligne de la deuxième se range sous son équivalent de la première (même désignation,
// ou même code une fois le préfixe ôté : « X_DISQUE » sous « DISQUE ») ; les autres suivent, seules.
function barrePerimetre(perimetre, selection, choisir) {
  if (!perimetre?.lignes?.length) return null
  const basculer = (id) => choisir(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id])
  const pastille = (l) => h('button', { class: `pastille-ligne${selection.includes(l.id) ? ' choisie' : ''}`, title: `${l.libelle} — ${nombreFr(l.machines)} machines${l.arbre ? ` (${l.arbre})` : ''}`, onclick: () => basculer(l.id) }, l.code || l.libelle)
  const arbres = [...new Set(perimetre.lignes.map((l) => l.arbre))]
  const piles = rangerParPaires(perimetre.lignes, arbres)
  return h('div', { class: 'perimetre-tableau' },
    h('div', { class: 'tete-perimetre' },
      h('button', { class: `pastille-ligne toutes${selection.length ? '' : ' choisie'}`, title: 'Toutes les lignes des arborescences choisies dans Administration', onclick: () => choisir([]) }, 'Toutes'),
      arbres.length > 1 ? h('div', { class: 'legende-arbres' }, arbres.map((a, i) => h('span', {}, h('i', { class: `rang-${i}` }), a || 'sans arborescence'))) : null,
      perimetre.machines !== null ? h('span', { class: 'discret compte-perimetre' }, `${nombreFr(perimetre.machines)} machines comptées`) : null),
    h('div', { class: 'piles-lignes' }, piles.map((pile) => h('div', { class: 'pile-ligne' }, pile.map((l, i) => (l ? h('div', { class: `etage rang-${arbres.indexOf(l.arbre)}` }, pastille(l)) : h('div', { class: 'etage vide' })))))))
}

// [[ligne de l'arbre 1, ligne de l'arbre 2, …], …] : une pile par ligne de la première arborescence.
function rangerParPaires(lignes, arbres) {
  const cle = (texte) => String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const designation = (l) => cle(/\((.*)\)$/.exec(l.libelle)?.[1] || '')
  const sansPrefixe = (code) => cle(String(code).replace(/^[^_]{1,3}_/, ''))
  const parArbre = arbres.map((a) => lignes.filter((l) => l.arbre === a))
  const piles = parArbre[0].map((l) => [l])
  for (let rang = 1; rang < parArbre.length; rang++) {
    for (const l of parArbre[rang]) {
      const pile = piles.find((p) => !p[rang] && p[0] && (sansPrefixe(l.code) === cle(p[0].code) || (designation(l) && designation(l) === designation(p[0]))))
      if (pile) pile[rang] = l
      else { const seule = Array(rang).fill(null); seule[rang] = l; piles.push(seule) }
    }
  }
  return piles.map((p) => Array.from({ length: arbres.length }, (_, i) => p[i] || null))
}

// Les chiffres défilent jusqu'à leur valeur, les barres montent, l'anneau se dessine.
function animer(zone) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  zone.classList.remove('tableau-anime')
  void zone.offsetWidth // relance les animations CSS
  zone.classList.add('tableau-anime')
  zone.querySelectorAll('svg.graphique path').forEach((p, i) => (p.style.animationDelay = `${(i % 12) * 35 + Math.floor(i / 12) * 60}ms`))
  zone.querySelectorAll('.barres-horizontales .piste > span').forEach((b, i) => (b.style.animationDelay = `${i * 70}ms`))
  zone.querySelectorAll('.tuile .valeur').forEach((v) => {
    const texte = v.firstChild
    if (texte?.nodeType !== Node.TEXT_NODE) return
    const fin = Number(texte.textContent.replace(/\D/g, ''))
    if (!fin) return
    const debut = performance.now()
    const pas = (instant) => {
      const t = Math.min(1, (instant - debut) / 900)
      texte.textContent = nombreFr(Math.round(fin * (1 - (1 - t) ** 3)))
      if (t < 1 && texte.isConnected) requestAnimationFrame(pas)
    }
    requestAnimationFrame(pas)
  })
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
  return tableau({
    lignes: liste,
    vide: 'Aucune intervention.',
    surClic: (i) => (location.hash = `#/interventions/${i.id}`),
    colonnes: [
      { titre: 'Date', classe: 'col-date', valeur: (i) => h('span', { class: 'discret' }, dateFr(i.date)) },
      { titre: 'Type', valeur: (i) => h('span', { class: `etiquette ${i.type === 'Correctif' ? 'violet' : ''}` }, i.type) },
      { titre: 'Machine', valeur: (i) => h('b', { class: 'mono' }, i.repere || '') },
      { titre: 'Description', classe: 'col-description', valeur: (i) => h('span', { class: 'texte-2', title: texteSeul(i.description) }, texteSeul(i.description)) },
      { titre: 'Intervenant(s)', classe: 'col-intervenants', valeur: (i) => h('span', { title: i.intervenant || '' }, i.intervenant || '—') },
    ],
  })
}

// « Ce que l'IA remarque »
function carteRemarques(remarques, selection) {
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
    const r = await essayer(() => api('/api/tableau-de-bord/remarques', { methode: 'POST', corps: { lignes: selection } }))
    bouton.disabled = false
    if (r) montrer(r)
    else corps.textContent = ''
  }

  if (remarques) montrer(remarques)
  else corps.append(h('p', { class: 'texte-2' }, 'L’IA peut relever les points qui demandent votre attention : pannes en hausse, pannes récurrentes, machines sans documentation…'))

  const rouage = peutModifier() ? h('button', { class: 'discret icone-seule petit', title: 'Les consignes données à l’IA pour ces remarques', onclick: () => modifierConsignes(analyser) }, ic('reglages', 16)) : null
  return h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, h('span', { class: 'pastille', style: { color: 'var(--accent)' } }, ic('etincelle', 18)), 'Ce que l’IA remarque'), h('div', { class: 'actions' }, date, rouage)), corps, h('div', { class: 'actions', style: { marginTop: '12px' } }, bouton, h('a', { class: 'bouton petit', href: '#/assistant' }, ic('etincelle', 14), 'Poser une question')))
}

// Le rouage : les consignes que suit l'IA pour écrire ses remarques (administrateur).
async function modifierConsignes(analyser) {
  const c = await essayer(() => api('/api/tableau-de-bord/consignes'))
  if (!c) return
  const texte = h('textarea', { rows: 10 }, c.texte)
  const enregistrees = await fenetre({
    titre: 'Consignes de « Ce que l’IA remarque »',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Ce que l’IA doit relever en lisant les chiffres du tableau de bord : sujets à mettre en avant, forme, longueur. Elle reçoit les chiffres du périmètre affiché.'),
      texte),
    boutons: [
      { texte: 'Revenir à l’original', classe: 'discret', action: () => { texte.value = c.origine; return false } },
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api('/api/tableau-de-bord/consignes', { methode: 'POST', corps: { texte: texte.value } }); return true } },
    ],
  })
  if (enregistrees) {
    notifier('Consignes enregistrées')
    analyser()
  }
}
