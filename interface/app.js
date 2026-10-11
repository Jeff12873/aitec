// L'interface d'IASSITEC : le menu, la barre du haut, et l'écran du bloc choisi.
//
// Chaque écran est un « bloc » (dossier blocs/<nom>/vue.js) qui exporte :
//   { chemin, titre, icone, menu, aide, afficher(zone, { id, query }) }
// Pour ajouter un écran : créer son bloc puis l'ajouter à la liste BLOCS (voir docs/AJOUTER-UN-BLOC.md).

import { h, vider, ic, fenetreOuverte, notifier, heureFr } from './socle/ui.js'
import { etat, suivreEtat, surChangement } from './socle/etat.js'
import { api } from './socle/api.js'
import tableauDeBord from '/blocs/tableau-de-bord/vue.js'
import assistant from '/blocs/assistant/vue.js'
import parc from '/blocs/parc/vue.js'
import interventions from '/blocs/interventions/vue.js'
import documents from '/blocs/documents/vue.js'
import importGmao from '/blocs/import-gmao/vue.js'
import administration from '/blocs/administration/vue.js'
import aide from '/blocs/aide/vue.js'
import recherche from '/blocs/recherche/vue.js'
import { afficherAccueil, ouvrirModeAdmin, quitterModeAdmin } from '/blocs/fichier/vue.js'

// L'ordre est celui du menu. Seuls l'assistant, le tableau de bord et l'administration y figurent (menu: true) ;
// les autres écrans s'ouvrent depuis les sources citées par l'IA ou depuis l'administration.
const BLOCS = [assistant, tableauDeBord, administration, parc, interventions, documents, importGmao, aide, recherche]

const racine = document.getElementById('appli')
let zone = null // l'endroit où s'affiche le bloc
let barre = null
let menu = null
let affiche = null // { bloc, id, cle }

// Le champ de recherche est créé une seule fois : redessiner la barre ne doit pas effacer ce qu'on tape.
const champRecherche = h('input', {
  type: 'search',
  placeholder: 'Rechercher dans toute la base…',
  onkeydown: (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) location.hash = `#/recherche?q=${encodeURIComponent(e.target.value.trim())}`
  },
})
let contenuBarre = ''

await suivreEtat()
surChangement(quandEtatChange)
window.addEventListener('hashchange', () => (zone ? afficherBloc() : dessiner()))
dessiner()

// ---------------------------------------------------------------- dessin général

function dessiner() {
  if (!etat.partage?.fichier) {
    zone = barre = menu = affiche = null
    // Avant l'ouverture d'un fichier, seule l'aide est accessible.
    if (location.hash.startsWith('#/aide')) {
      const page = h('main', { class: 'contenu', style: { margin: '0 auto' } })
      vider(racine, h('div', { class: 'contenu', style: { margin: '0 auto', paddingBottom: 0 } }, h('a', { class: 'bouton', href: '#/' }, ic('retour', 16), 'Retour à l’accueil')), page)
      aide.afficher(page, { id: location.hash.split('/')[2] || null })
    } else {
      afficherAccueil(racine)
    }
    return
  }
  menu = h('nav', { class: 'menu' })
  barre = h('header', { class: 'barre' })
  zone = h('main', { class: 'contenu' })
  vider(racine, h('div', { class: 'appli' }, menu, h('div', { class: 'zone-principale' }, barre, zone)))
  dessinerMenu()
  dessinerBarre({ forcer: true })
  afficherBloc()
}

function routeActuelle() {
  const [chemin = '', ...reste] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))
  const bloc = BLOCS.find((b) => b.chemin === chemin) || assistant
  return { bloc, id: reste.join('/') || null, query }
}

async function afficherBloc() {
  const { bloc, id, query } = routeActuelle()
  affiche = { bloc, id, cle: location.hash }
  dessinerMenu()
  vider(zone)
  try {
    await bloc.afficher(zone, { id, query })
  } catch (erreur) {
    vider(zone, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
  }
}

function dessinerMenu() {
  if (!menu) return
  const actuel = routeActuelle().bloc
  vider(
    menu,
    h(
      'div',
      { class: 'menu-titre' },
      h('img', { src: `/api/icone?v=${etat.iconePersonnalisee ? etat.partage.version : 0}`, alt: '' }),
      h('div', {}, h('strong', {}, 'IASSITEC'), h('span', { title: etat.atelier }, etat.atelier || '')),
    ),
    BLOCS.filter((b) => b.menu === true || (b.menu === 'admin' && etat.admin)).map((b) => [
      b.separateurAvant ? h('div', { class: 'separateur' }) : null,
      h('a', { href: `#/${b.chemin}`, class: b === actuel ? 'actif' : '' }, ic(b.icone, 19), h('span', {}, b.titre)),
    ]),
    h('div', { class: 'pied' }, `Version ${etat.version}`),
  )
}

// ---------------------------------------------------------------- barre du haut


function dessinerBarre({ forcer = false } = {}) {
  if (!barre) return
  const p = etat.partage
  // On ne redessine que si quelque chose d'affiché a changé.
  const cle = JSON.stringify([etat.ia, etat.admin, p.nomFichier, p.avertissement, p.aPublier, p.publication, p.autreAdmin, p.admin])
  if (cle === contenuBarre && !forcer && barre.childElementCount) return
  contenuBarre = cle

  vider(
    barre,
    h('div', { class: 'recherche' }, ic('loupe', 17), champRecherche),
    h('div', { class: 'espace' }),
    etiquetteIA(),
    etiquetteFichier(p),
    etat.admin
      ? h('button', { class: 'petit', title: 'Revenir en consultation', onclick: quitterModeAdmin }, ic('cadenasOuvert', 16), `Administrateur : ${p.admin?.nom || ''}`)
      : h('button', { class: 'petit', onclick: ouvrirModeAdmin }, ic('cadenas', 16), 'Consultation'),
    h('button', { class: 'discret icone-seule', title: 'Aide sur cet écran', onclick: () => (location.hash = `#/aide/${routeActuelle().bloc.aide || 'premiers-pas'}`) }, ic('aide', 19)),
  )
}

function etiquetteIA() {
  const ia = etat.ia || {}
  if (!ia.installee) return h('span', { class: 'etiquette rouge', title: "Lancez la préparation d'IASSITEC sur ce poste" }, h('span', { class: 'point' }), 'IA non installée')
  const occupee = ia.chat === 'démarrage' || ia.recherche === 'démarrage'
  const prete = ia.chat === 'prêt'
  const titre = `${ia.modele} sur ${ia.appareil}. L'IA démarre à la première question et s'arrête après un moment sans utilisation.`
  if (occupee) return h('span', { class: 'etiquette orange', title: titre }, h('span', { class: 'point anime' }), "Chargement de l'IA…")
  if (prete) return h('span', { class: 'etiquette accent', title: titre }, h('span', { class: 'point' }), 'IA prête')
  return h('span', { class: 'etiquette', title: titre }, h('span', { class: 'point' }), 'IA en veille')
}

function etiquetteFichier(p) {
  let detail = ''
  let classe = ''
  if (p.avertissement) {
    detail = ' — ' + p.avertissement
    classe = 'orange'
  } else if (etat.admin && p.publication?.erreur) {
    detail = ' — partage inaccessible, nouvel essai bientôt'
    classe = 'rouge'
  } else if (etat.admin && p.aPublier) {
    detail = ' — enregistrement…'
  } else if (etat.admin && p.publication?.derniere) {
    detail = ` — enregistré à ${heureFr(p.publication.derniere)}`
  } else if (p.autreAdmin) {
    detail = ` — ${p.autreAdmin.nom} modifie en ce moment`
    classe = 'violet'
  }
  return h('span', { class: `etiquette ${classe}`, title: (p.fichier || '') + detail }, ic('nuage', 15), p.nomFichier + detail)
}

// ---------------------------------------------------------------- suivi de l'état

function quandEtatChange(nouveau, ancien) {
  if (nouveau.injoignable) {
    notifier("IASSITEC ne répond plus : relancez-le avec son raccourci.", 'erreur')
    return
  }
  // Fichier ouvert ou fermé : on redessine tout.
  if (Boolean(nouveau.partage?.fichier) !== Boolean(zone) || nouveau.partage?.fichier !== ancien.partage?.fichier) return dessiner()

  dessinerBarre()
  if (nouveau.admin !== ancien.admin || nouveau.atelier !== ancien.atelier || nouveau.iconePersonnalisee !== ancien.iconePersonnalisee) {
    dessinerMenu()
    if (!fenetreOuverte()) afficherBloc()
    return
  }
  if (nouveau.partage.avertissement && nouveau.partage.avertissement !== ancien.partage?.avertissement) notifier(nouveau.partage.avertissement)

  // Le contenu du fichier a changé (modification d'un autre poste) : on recharge l'écran,
  // sauf si l'agent est en train d'écrire ou si l'écran ne le souhaite pas (assistant).
  if (nouveau.partage.version !== ancien.partage?.version && affiche?.bloc.rafraichir !== false && !fenetreOuverte() && !saisieEnCours()) {
    afficherBloc()
  }
}

function saisieEnCours() {
  const actif = document.activeElement
  return actif && ['INPUT', 'TEXTAREA', 'SELECT'].includes(actif.tagName) && actif.value
}

// Pour les blocs : recharger l'écran courant après une modification.
window.iassitec = { recharger: () => afficherBloc(), api }
