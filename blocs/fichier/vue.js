// Accueil (premier lancement), choix du fichier .datassitec et mode administrateur.

import { h, vider, ic, fenetre, formulaire, notifier, essayer, confirmer, heureFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat, actualiserEtat } from '/socle/etat.js'

// ---------------------------------------------------------------- accueil

export function afficherAccueil(racine) {
  vider(
    racine,
    h(
      'div',
      { class: 'accueil' },
      h(
        'div',
        { class: 'accueil-boite' },
        h(
          'div',
          { class: 'accueil-titre' },
          h('img', { src: '/api/icone', alt: '' }),
          h('h1', {}, 'Bienvenue dans IASSITEC'),
          h('p', { class: 'sous-titre' }, "L'assistant de dépannage qui connaît votre parc, son historique et vos documents."),
        ),
        h(
          'div',
          { class: 'choix' },
          h(
            'div',
            { class: 'carte', onclick: () => choisirFichier() },
            ic('dossier', 30),
            h('h2', {}, "Ouvrir le fichier de l'atelier"),
            h('p', { class: 'texte-2' }, 'Le fichier .datassitec existe déjà (sur le lecteur réseau, en général) : choisissez-le pour retrouver toute la base.'),
          ),
          h(
            'div',
            { class: 'carte', onclick: () => creerFichier() },
            ic('plus', 30),
            h('h2', {}, 'Créer un nouveau fichier'),
            h('p', { class: 'texte-2' }, "Première utilisation dans l'atelier : créez le fichier qui contiendra la base, et choisissez le mot de passe administrateur."),
          ),
        ),
        h('p', { class: 'discret', style: { textAlign: 'center', marginTop: '24px' } }, 'Besoin d’aide ? ', h('a', { href: '#/aide/premiers-pas' }, 'Premiers pas')),
      ),
    ),
  )
}

// ---------------------------------------------------------------- explorateur de dossiers

// Le navigateur ne donne pas le chemin complet d'un fichier : on parcourt les dossiers via le serveur.
// mode 'fichier' : on choisit un .datassitec ; mode 'dossier' : on choisit un dossier.
function explorateur(mode, surChoix) {
  const liste = h('div', { class: 'explorateur' })
  const racines = h('div', { class: 'racines' })
  const champ = h('input', { placeholder: mode === 'fichier' ? 'Chemin du dossier, ex. Z:\\Maintenance ou \\\\serveur\\partage' : 'Chemin du dossier' })
  let dossierActuel = null

  async function aller(dossier) {
    try {
      const resultat = await api(`/api/explorer${dossier ? '?dossier=' + encodeURIComponent(dossier) : ''}`)
      dossierActuel = resultat.dossier
      champ.value = resultat.dossier || ''
      vider(racines, resultat.racines.map((r) => h('button', { class: 'petit', onclick: () => aller(r.chemin) }, r.nom)))
      vider(
        liste,
        resultat.parent ? h('div', { onclick: () => aller(resultat.parent) }, ic('monter', 16), 'Dossier parent') : null,
        resultat.dossiers.map((nom) => h('div', { onclick: () => aller(joindre(resultat.dossier, nom)) }, ic('dossier', 16), nom)),
        mode === 'fichier' ? resultat.fichiers.map((nom) => h('div', { class: 'fichier', onclick: () => surChoix(joindre(resultat.dossier, nom)) }, ic('document', 16), nom)) : null,
        resultat.dossier && !resultat.dossiers.length && !(mode === 'fichier' && resultat.fichiers.length) ? h('div', { class: 'discret' }, 'Dossier vide') : null,
      )
      surChoix.dossier?.(dossierActuel)
    } catch (erreur) {
      notifier(erreur.message, 'erreur')
    }
  }

  champ.addEventListener('keydown', (e) => e.key === 'Enter' && aller(champ.value.trim()))
  aller(null).then(() => {
    const premier = racines.querySelector('button')
    if (premier) premier.click()
  })
  return {
    element: h('div', {}, racines, h('div', { class: 'actions', style: { marginBottom: '10px' } }, champ, h('button', { onclick: () => aller(champ.value.trim()) }, 'Aller')), liste),
    dossier: () => dossierActuel,
  }
}

function joindre(dossier, nom) {
  const separateur = dossier.includes('\\') ? '\\' : '/'
  return dossier.endsWith(separateur) ? dossier + nom : dossier + separateur + nom
}

export function choisirFichier() {
  let fermer
  const choix = explorateur('fichier', async (chemin) => {
    const ok = await essayer(() => api('/api/fichier/ouvrir', { methode: 'POST', corps: { chemin } }))
    if (ok) {
      fermer()
      await actualiserEtat()
      location.hash = '#/tableau-de-bord'
      location.reload()
    }
  })
  const promesse = fenetre({
    titre: 'Ouvrir le fichier de l’atelier',
    large: true,
    contenu: h('div', {}, h('p', { class: 'texte-2' }, 'Parcourez les dossiers jusqu’au fichier .datassitec, puis cliquez dessus.'), choix.element),
  })
  fermer = () => document.querySelector('.voile')?.remove()
  return promesse
}

export function creerFichier() {
  const choix = explorateur('dossier', () => {})
  const form = formulaire([
    { nom: 'nomFichier', libelle: 'Nom du fichier', obligatoire: true, defaut: 'atelier', aide: '.datassitec sera ajouté' },
    { nom: 'nomAtelier', libelle: "Nom de l'atelier ou du site", obligatoire: true, defaut: 'Atelier' },
    { nom: 'nomAgent', libelle: 'Votre nom', obligatoire: true, defaut: etat.poste?.nomAgent || '' },
    { nom: 'motDePasse', libelle: 'Mot de passe administrateur', type: 'mot-de-passe', obligatoire: true, aide: '4 caractères au moins. Il sera demandé pour toute modification.' },
    { nom: 'confirmation', libelle: 'Mot de passe (encore)', type: 'mot-de-passe', obligatoire: true },
  ])
  return fenetre({
    titre: 'Créer le fichier de l’atelier',
    large: true,
    contenu: h(
      'div',
      {},
      h('p', { class: 'texte-2' }, '1. Choisissez le dossier où ranger le fichier : de préférence sur le lecteur réseau partagé, pour que tous les postes y aient accès.'),
      choix.element,
      h('p', { class: 'texte-2', style: { marginTop: '18px' } }, '2. Donnez-lui un nom et choisissez le mot de passe administrateur.'),
      form.element,
    ),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      {
        texte: 'Créer le fichier',
        classe: 'principal',
        action: async () => {
          const valeurs = form.lire()
          if (!choix.dossier()) throw new Error('Choisissez d’abord un dossier.')
          if (valeurs.motDePasse !== valeurs.confirmation) throw new Error('Les deux mots de passe sont différents.')
          await api('/api/fichier/creer', { methode: 'POST', corps: { ...valeurs, dossier: choix.dossier() } })
          location.hash = '#/aide/premiers-pas'
          location.reload()
        },
      },
    ],
  })
}

// ---------------------------------------------------------------- mode administrateur

export async function ouvrirModeAdmin() {
  const form = formulaire([
    { nom: 'nom', libelle: 'Votre nom', obligatoire: true, defaut: etat.poste?.nomAgent || '', aide: 'Affiché aux autres postes pendant que vous modifiez.' },
    { nom: 'motDePasse', libelle: 'Mot de passe administrateur', type: 'mot-de-passe', obligatoire: true },
  ])
  const autre = etat.partage?.autreAdmin
  await fenetre({
    titre: 'Passer en mode administrateur',
    contenu: h(
      'div',
      {},
      h('p', { class: 'texte-2' }, 'Le mode administrateur permet de modifier la base : documents, imports, réglages. Un seul administrateur à la fois.'),
      autre ? h('div', { class: 'bandeau' }, ic('alerte'), `${autre.nom} (${autre.poste}) modifie la base depuis ${heureFr(new Date(autre.depuis).toISOString())}.`) : null,
      form.element,
    ),
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      {
        texte: 'Entrer',
        classe: 'principal',
        action: async () => {
          const valeurs = form.lire()
          let resultat = await api('/api/session', { methode: 'POST', corps: valeurs })
          if (resultat.occupe) {
            const depuis = heureFr(new Date(resultat.occupe.depuis).toISOString())
            const forcer = await confirmer(
              `${resultat.occupe.nom} (poste ${resultat.occupe.poste}) modifie déjà la base depuis ${depuis}. Si cette personne a terminé ou si son poste est éteint, vous pouvez reprendre la main : ses dernières secondes de modifications non enregistrées seraient perdues.`,
              { texte: 'Reprendre la main', danger: true },
            )
            if (!forcer) return false
            resultat = await api('/api/session', { methode: 'POST', corps: { ...valeurs, forcer: true } })
          }
          await actualiserEtat()
          notifier('Mode administrateur : vos modifications sont enregistrées sur le partage automatiquement.')
        },
      },
    ],
  })
}

export async function quitterModeAdmin() {
  await essayer(() => api('/api/session', { methode: 'DELETE' }), 'Retour en consultation. Vos modifications sont enregistrées.')
  await actualiserEtat()
}
