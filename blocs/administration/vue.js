// Administration : documents donnés à l'IA, import GMAO, et réglages (poste, fichier, icône, mot de passe, mises à jour).

import { h, vider, ic, fenetre, formulaire, essayer, notifier, confirmer, dateHeureFr, tailleFr, nombreFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat, estAdmin, actualiserEtat } from '/socle/etat.js'
import { choisirFichier, ouvrirModeAdmin } from '/blocs/fichier/vue.js'
import documents from '/blocs/documents/vue.js'
import importGmao from '/blocs/import-gmao/vue.js'

// Les trois onglets de l'administration. Documents et Import GMAO réutilisent les écrans de leurs blocs.
const ONGLETS = [
  ['documents', 'Documents', 'document'],
  ['import', 'Import GMAO', 'tableur'],
  ['reglages', 'Réglages', 'reglages'],
]

export default {
  chemin: 'administration',
  titre: 'Administration',
  icone: 'reglages',
  menu: true,
  aide: 'administration',

  async afficher(zone, { id, query }) {
    const onglet = ONGLETS.some(([cle]) => cle === id) ? id : estAdmin() ? 'documents' : 'reglages'
    const contenu = h('div', { class: 'onglet-contenu' })
    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Administration'), h('p', { class: 'sous-titre' }, 'Ce que l’IA connaît (documents, exports GMAO) et les réglages'))),
      h('div', { class: 'segments', style: { marginBottom: '20px' } },
        ONGLETS.map(([cle, titre, icone]) => h('button', { class: cle === onglet ? 'choisi' : '', onclick: () => (location.hash = `#/administration/${cle}`) }, ic(icone, 16), titre)),
      ),
      contenu,
    )

    if (onglet === 'reglages') return afficherReglages(contenu)
    if (!estAdmin()) {
      vider(contenu, h('div', { class: 'carte' }, h('div', { class: 'actions' }, ic('cadenas'), h('span', { style: { flex: 1 } }, 'Ajouter des documents ou importer un export GMAO demande le mode administrateur.'), h('button', { class: 'principal', onclick: ouvrirModeAdmin }, 'Passer en mode administrateur'))))
      return
    }
    if (onglet === 'documents') return documents.afficher(contenu, { query })
    return importGmao.afficher(contenu, { query })
  },
}

async function afficherReglages(zone) {
  const infos = await api('/api/admin/infos')
  vider(
    zone,
    h(
      'div',
      { class: 'grille grille-2' },
      cartePoste(infos.installation),
      carteFichier(infos),
      estAdmin()
        ? [carteAtelier(), carteIcone(), carteMotDePasse(), carteIndex(infos)]
        : h('div', { class: 'carte pleine' }, h('div', { class: 'actions' }, ic('cadenas'), h('span', { style: { flex: 1 } }, 'Le nom de l’atelier, l’icône, le mot de passe et l’index de recherche se règlent en mode administrateur.'), h('button', { onclick: ouvrirModeAdmin }, 'Passer en mode administrateur'))),
      carteMiseAJour(infos),
    ),
  )
}

function carte(icone, titre, ...contenu) {
  return h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic(icone, 18), titre)), ...contenu)
}

function ligne(libelle, valeur) {
  return h('div', { style: { display: 'flex', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--bord)' } }, h('span', { class: 'discret', style: { minWidth: '150px' } }, libelle), h('span', { style: { wordBreak: 'break-all' } }, valeur || '—'))
}

// ---------------------------------------------------------------- ce poste

function cartePoste(config) {
  const nom = h('input', { value: etat.poste?.nomAgent || '' })
  const arret = h('input', { type: 'number', min: 1, max: 480, value: etat.poste?.arretIAMinutes || 20, style: { width: '110px' } })
  const enregistrer = () => essayer(() => api('/api/poste', { methode: 'POST', corps: { nomAgent: nom.value, arretIAMinutes: Number(arret.value) } }).then(actualiserEtat), 'Réglages du poste enregistrés')

  return carte(
    'puce',
    'Ce poste',
    config
      ? h('div', {}, ligne('Modèle d’IA', config.modele.nom), ligne('Calcul sur', config.appareilNom), ligne('Mémoire du poste', `${config.poste.ramGo} Go`), ligne('Préparé le', dateHeureFr(config.prepareLe)))
      : h('div', { class: 'bandeau' }, ic('alerte'), 'L’IA n’est pas installée sur ce poste : lancez « Preparer IASSITEC » (voir l’aide).'),
    h('div', { class: 'formulaire', style: { marginTop: '16px' } },
      h('label', { class: 'champ' }, h('span', {}, 'Votre nom'), nom, h('small', { class: 'aide' }, 'Proposé en mode administrateur')),
      h('label', { class: 'champ' }, h('span', {}, 'Mettre l’IA en veille après (minutes)'), arret, h('small', { class: 'aide' }, 'Libère la mémoire du poste')),
    ),
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { class: 'principal', onclick: enregistrer }, 'Enregistrer'),
      h('button', { onclick: () => essayer(() => api('/api/ia/arreter', { methode: 'POST' }), 'IA mise en veille') }, ic('marche', 16), 'Mettre l’IA en veille'),
      h('button', { class: 'discret', onclick: quitter }, ic('sortie', 16), 'Quitter IASSITEC'),
    ),
  )
}

async function quitter() {
  if (!(await confirmer('Fermer IASSITEC sur ce poste ? Relancez-le ensuite avec son raccourci.'))) return
  await api('/api/quitter', { methode: 'POST' })
  document.body.innerHTML = '<div class="accueil"><div class="accueil-titre"><h1>IASSITEC est fermé</h1><p class="sous-titre">Vous pouvez fermer cet onglet.</p></div></div>'
}

// ---------------------------------------------------------------- fichier

function carteFichier(infos) {
  const s = infos.statistiques
  return carte(
    'nuage',
    'Fichier de l’atelier',
    ligne('Fichier', infos.fichier),
    ligne('Taille', infos.tailleFichier ? tailleFr(infos.tailleFichier) : ''),
    s ? ligne('Contenu', `${nombreFr(s.passages)} passages, ${tailleFr(s.octetsDocuments)} de documents`) : null,
    h('h3', { style: { margin: '16px 0 8px' } }, 'Sauvegardes automatiques'),
    infos.sauvegardes.length
      ? h('div', { class: 'texte-2', style: { fontSize: '14px' } }, infos.sauvegardes.map((s) => h('div', {}, `${dateHeureFr(new Date(s.date).toISOString())} — ${tailleFr(s.taille)}`)))
      : h('p', { class: 'discret' }, 'Aucune pour l’instant : une sauvegarde est faite à chaque passage en mode administrateur (une par heure au plus, les 5 dernières sont gardées).'),
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '6px' } }, 'Elles sont dans le dossier « IASSITEC-sauvegardes », à côté du fichier. Pour revenir à une sauvegarde : voir l’aide « Sauvegardes ».'),
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { onclick: choisirFichier }, ic('dossier', 16), 'Ouvrir un autre fichier'),
      h('a', { class: 'bouton', href: '#/aide/sauvegardes' }, 'Aide'),
    ),
  )
}

// ---------------------------------------------------------------- réglages communs (mode administrateur)

function carteAtelier() {
  const nom = h('input', { value: etat.atelier || '' })
  return carte(
    'usine',
    'Nom de l’atelier',
    h('p', { class: 'texte-2' }, 'Affiché en haut du menu et donné à l’IA.'),
    h('div', { class: 'actions' }, nom, h('button', { class: 'principal', onclick: () => essayer(() => api('/api/admin/atelier', { methode: 'POST', corps: { nom: nom.value } }).then(actualiserEtat), 'Nom enregistré') }, 'Enregistrer')),
  )
}

function carteIcone() {
  const apercu = h('img', { src: `/api/icone?v=${Date.now()}`, alt: '', style: { width: '84px', height: '84px', borderRadius: '18px', objectFit: 'contain', background: 'var(--carte-2)' } })
  const choix = h('input', {
    type: 'file',
    accept: 'image/png,image/svg+xml,image/jpeg,image/webp',
    style: { display: 'none' },
    onchange: async (e) => {
      const fichier = e.target.files[0]
      if (!fichier) return
      if (await essayer(() => api('/api/admin/icone', { methode: 'POST', fichier }), 'Icône enregistrée pour tous les postes')) {
        await actualiserEtat()
        location.reload()
      }
    },
  })
  return carte(
    'image',
    'Icône du logiciel',
    h('div', { class: 'actions', style: { alignItems: 'center', gap: '18px' } },
      apercu,
      h('div', { style: { flex: 1 } },
        h('p', { class: 'texte-2' }, 'Votre icône, la même sur tous les postes : menu, onglet du navigateur et raccourcis. Format conseillé : PNG carré de 512 × 512 pixels (les raccourcis n’acceptent que le PNG).'),
        h('div', { class: 'actions' },
          h('button', { class: 'principal', onclick: () => choix.click() }, ic('envoyer', 16), 'Importer une icône'),
          etat.iconePersonnalisee ? h('button', { class: 'discret', onclick: () => essayer(() => api('/api/admin/icone', { methode: 'DELETE' })).then(() => location.reload()) }, 'Remettre l’icône d’origine') : null,
        ),
      ),
      choix,
    ),
  )
}

function carteMotDePasse() {
  return carte(
    'cadenas',
    'Mot de passe administrateur',
    h('p', { class: 'texte-2' }, 'Le même pour tous les postes : il est enregistré (chiffré) dans le fichier de l’atelier.'),
    h('button', {
      onclick: () => {
        const form = formulaire([
          { nom: 'actuel', libelle: 'Mot de passe actuel', type: 'mot-de-passe', obligatoire: true, large: true },
          { nom: 'nouveau', libelle: 'Nouveau mot de passe', type: 'mot-de-passe', obligatoire: true },
          { nom: 'confirmation', libelle: 'Nouveau (encore)', type: 'mot-de-passe', obligatoire: true },
        ])
        fenetre({
          titre: 'Changer le mot de passe',
          contenu: form.element,
          boutons: [
            { texte: 'Annuler', classe: 'discret' },
            {
              texte: 'Changer',
              classe: 'principal',
              action: async () => {
                const v = form.lire()
                if (v.nouveau !== v.confirmation) throw new Error('Les deux nouveaux mots de passe sont différents.')
                await api('/api/admin/mot-de-passe', { methode: 'POST', corps: v })
                notifier('Mot de passe changé')
              },
            },
          ],
        })
      },
    }, 'Changer le mot de passe'),
  )
}

function carteIndex(infos) {
  const restants = etat.indexation?.restants || 0
  return carte(
    'loupe',
    'Recherche par le sens',
    h('p', { class: 'texte-2' }, restants ? `${nombreFr(restants)} passages en attente : l’IA les prépare en arrière-plan tant que vous restez en mode administrateur.` : 'Tous les passages sont prêts pour la recherche par le sens.'),
    h('p', { class: 'discret', style: { fontSize: '13px' } }, `${nombreFr(infos.statistiques?.passages || 0)} passages au total.`),
    h('button', {
      onclick: async () => {
        if (await confirmer('Tout recalculer ? Utile seulement après un changement du modèle de recherche. Cela peut prendre du temps.')) {
          await essayer(() => api('/api/admin/reindexer', { methode: 'POST' }), 'Recalcul lancé')
        }
      },
    }, ic('rafraichir', 16), 'Tout recalculer'),
  )
}

// ---------------------------------------------------------------- mises à jour

function carteMiseAJour(infos) {
  const resultat = h('div', { class: 'texte-2', style: { marginTop: '10px' } })
  async function verifier() {
    resultat.textContent = 'Vérification…'
    const r = await essayer(() => api('/api/mise-a-jour'))
    if (!r) return (resultat.textContent = '')
    if (!r.disponible) return (resultat.textContent = r.message)
    if (!r.nouvelle) return (resultat.textContent = `IASSITEC est à jour (version ${r.actuelle}).`)
    vider(resultat, h('p', {}, `Nouvelle version disponible : ${r.disponible}.`), h('button', { class: 'principal', onclick: installer }, ic('telecharger', 16), 'Installer et redémarrer'))
  }
  async function installer() {
    vider(resultat, h('p', { class: 'curseur' }, 'Téléchargement et installation'))
    if (await essayer(() => api('/api/mise-a-jour', { methode: 'POST' }))) {
      resultat.textContent = 'Mise à jour installée : IASSITEC redémarre…'
      setTimeout(() => location.reload(), 6000)
    }
  }
  return carte(
    'telecharger',
    'Mises à jour',
    ligne('Version installée', infos.version),
    ligne('Installé dans', infos.dossierInstallation),
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '10px' } }, 'La mise à jour ne change que le programme : le modèle d’IA, le fichier de l’atelier et vos réglages sont gardés.'),
    h('div', { class: 'actions' }, h('button', { onclick: verifier }, ic('rafraichir', 16), 'Vérifier les mises à jour')),
    resultat,
  )
}
