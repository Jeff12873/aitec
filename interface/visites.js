// Les présentations guidées de PREVTEC et d'AITEC (moteur : /socle/visite.js de K.NOVA) : proposées au premier lancement,
// relancées par le bouton de la barre du haut. Elles naviguent à la place de l'utilisateur et ne modifient rien. La ligne
// et la machine montrées sont prises dans la base : la ligne au verdict le plus mauvais, sa machine la plus en panne.

import { api } from '/socle/api.js'

const $ = (s) => document.querySelector(s)
const ou = (...selecteurs) => () => selecteurs.map($).find(Boolean) || $('.contenu')
const aller = (adresse) => { location.hash = adresse }
// Le temps que l'écran précédent parte : son contenu ne doit pas être pris pour celui du suivant.
const allerPuis = async (adresse) => { aller(adresse); await new Promise((ok) => setTimeout(ok, 600)) }

let ligne = null
let machine = null

async function choisirExemple() {
  const v = await api('/api/mn1/vignettes').catch(() => null)
  const rang = (p) => ({ reevaluer: 0, surveiller: 1, bon: 2 }[p.plan?.verdict] ?? 3)
  ligne = [...(v?.parcs || [])].sort((a, b) => rang(a) - rang(b))[0]?.id || null
  if (!ligne) return
  const parc = encodeURIComponent(ligne)
  const eq = await api(`/api/mn1/parcs/${parc}/equilibre`).catch(() => null)
  const parMachine = new Map()
  for (const e of eq?.equipements || []) parMachine.set(e.machine.id, (parMachine.get(e.machine.id) || 0) + e.correctifs)
  // La machine la plus en panne qui a au moins une visite à montrer.
  for (const [id] of [...parMachine].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    const d = await api(`/api/mn1/parcs/${parc}/machines/${id}`).catch(() => null)
    if (d?.lignes?.length) { machine = id; return }
  }
}
const adresseLigne = () => `#/mn1/parc/${encodeURIComponent(ligne)}`

export const visites = {
  'prevtec-lignes': {
    titre: '1. Les lignes',
    etapes: [
      { titre: 'Bienvenue dans PREVTEC', avant: async () => { aller('#/mn1'); await choisirExemple() }, texte: 'PREVTEC sert à réévaluer le plan de maintenance : le préventif regarde-t-il les bonnes pannes, et en bonne quantité ? Je vais parcourir un cas réel à votre place. Rien ne sera modifié.' },
      { attendre: '.fil-etapes', cible: '.fil-etapes', titre: 'Le fil du parcours', texte: 'Quatre étapes, toujours en haut : choisir la ligne, la regarder, ouvrir le Démonstrateur d’une machine, décider.' },
      { attendre: '.vignette-mn1', cible: '.vignette-mn1', titre: 'Une vignette par ligne', texte: 'Le verdict de son plan (dans le bon sens, à surveiller, à réévaluer), ses pannes et ses visites sur 12 mois terminés, et leur courbe. Les plans à réévaluer viennent d’abord.' },
    ],
  },
  'prevtec-ma-ligne': {
    titre: '2. Ma ligne',
    etapes: [
      { avant: () => aller(adresseLigne()), attendre: '.bandeau-verdict', cible: '.bandeau-verdict', titre: 'Le verdict, expliqué', texte: 'Pourquoi ce plan est à surveiller ou à réévaluer, en clair, sur les 12 derniers mois terminés face aux 12 d’avant.' },
      { cible: ou('.calendrier-compact'), titre: 'Les équipes', texte: 'La semaine en cours et les suivantes, chaque équipe avec sa couleur. Un clic ouvre l’année.' },
      { attendre: '.zone-hof-ligne', cible: ou('.hall-of-fame', '.zone-hof-ligne'), titre: 'Les contributeurs du mois', texte: 'Ceux qui remontent et exécutent le niveau 1 sur cette ligne, et un bouton pour aller à sa maintenance de niveau 1.' },
      { cible: ou('.tuiles-ligne'), titre: 'Les indicateurs', texte: 'Pannes, temps de dépannage, part du préventif, dépanneurs par panne, concentration. Le « ? » dit comment chacun est calculé.' },
      { attendre: '.tableau-cases-zone', cible: '.tableau-cases-zone', titre: 'Le tableau des ETH', texte: 'Les pannes en hauteur, les visites en largeur. Beaucoup de pannes et peu de visites : pas assez de préventif. Beaucoup des deux : le préventif regarde sans doute au mauvais endroit. La légende est dessous.' },
      { cible: ou('.par-ou-commencer'), titre: 'Par où commencer', texte: 'Les ETH les plus problématiques d’abord, en une phrase chacune.' },
      { avant: () => $('.par-ou-commencer .lien-synthese')?.click(), attendre: '.tete-equilibre .barre-retour', cible: '.tableau-cases-zone', titre: 'Le zoom sur une ETH', texte: 'Un clic sur un carré plonge dans ses machines, sur le même tableau. La flèche « Toutes les ETH » remonte d’un niveau.' },
    ],
  },
  'prevtec-demonstrateur': {
    titre: '3. Le Démonstrateur',
    etapes: [
      { avant: () => aller(`${adresseLigne()}?machine=${machine}`), attendre: '.matrice-demo', cible: ou('.resume-machine'), titre: 'Pourquoi regarder cette machine', texte: 'Son rang dans son ETH, le sens de ses pannes, où elles se concentrent, et ce que dit son préventif.' },
      { cible: '.demo-conteneur', titre: 'La matrice', texte: 'En colonnes les équipements, le plus en panne à gauche. En lignes les visites. À la croisée, l’endroit où chaque visite est posée.' },
      { cible: ou('th.col-t'), titre: 'La colonne t', texte: 'La part des passages sans rien trouver, lue dans les observations écrites : un t très haut désigne une visite trop vague ou trop fréquente.' },
      { cible: ou('.ligne-diagnostics'), titre: 'Le diagnostic', texte: 'Sous chaque équipement : pas de préventif, mauvais point contrôlé ou énoncé trop vague, préventif ok, ou sur maintenance. Le survol dit pourquoi.' },
      { cible: ou('.ligne-ajout', '.legende-demo'), titre: 'Préparer sans rien casser', texte: 'En mode administrateur, on glisse une visite sur un équipement (rond pointillé, provisoire) et on crée une visite : tout reste dans PREVTEC. Le clic droit valide dans la GMAO, après simulation.' },
      { cible: ou('.tete-n1', '.legende-demo'), titre: 'Le niveau 1, à part', texte: 'Les fiches des opérateurs sur cette machine, avec la charge de leur ETH. Une fiche active compte dans le diagnostic.' },
    ],
  },
  'prevtec-je-decide': {
    titre: '4. Je décide',
    etapes: [
      { avant: () => $('td.posee.col-clic')?.click(), attendre: '.detail-decider', cible: '.detail-decider > .carte:nth-child(1)', titre: 'La visite telle qu’elle est écrite', texte: 'Un clic sur un rond ouvre cette page, pour cette visite et cet équipement : le contenu de sa FI dans la GMAO et les observations des derniers passages.' },
      { cible: '.detail-decider > .carte:nth-child(2)', titre: 'Les préconisations', texte: 'Ce que l’IA en pense, en quelques lignes, à partir de la FI, des observations et des pannes.' },
      { cible: '.carte-decisions', titre: 'La décision', texte: 'Créer une fiche N1, revoir la FI, ou imprimer la fiche de visite avec l’historique des pannes.' },
    ],
  },
  'prevtec-niveau-1': {
    titre: '5. La maintenance de niveau 1',
    etapes: [
      { avant: () => aller('#/niveau1'), attendre: '.vignette-mn1', cible: '.vignette-mn1', titre: 'Une vignette par ligne', texte: 'La charge des opérateurs, la pertinence des fiches, la tendance des pannes et les alertes.' },
      { avant: () => aller(`#/niveau1/${encodeURIComponent(ligne)}`), attendre: '.barre-onglets-ligne', cible: '.barre-onglets-ligne', titre: 'Le niveau 1 d’une ligne', texte: 'Ses fiches, puis ses demandes, FI et rapports de niveau 1.' },
      { cible: ou('.encart-eth', '.parc-mn1'), titre: 'Un encart par ETH', texte: 'Chaque fiche avec son état : FI, sur papier, brouillon, à revoir. On les imprime d’ici.' },
      { avant: () => aller('#/mn1'), attendre: '.fil-etapes', cible: '[data-presentation]', titre: 'À vous', texte: 'Ce bouton relance la présentation quand vous voulez. Le point d’interrogation à côté ouvre l’aide de l’écran.' },
    ],
  },
  'aitec-depannage': {
    titre: '1. Le dépannage',
    etapes: [
      { titre: 'Bienvenue dans AITEC', avant: () => aller('#/assistant'), texte: 'AITEC aide à dépanner à partir de votre historique, de vos documents et du savoir de l’atelier. Je vous montre les écrans. Rien ne sera modifié.' },
      { attendre: '.qcm-depart', cible: '.tete-qcm', titre: 'Répondre d’un clic', texte: 'Le dépannage se fait en QCM : la machine, ce qui se passe, le domaine, la fréquence.' },
      { cible: ou('.choix-qcm-liste'), titre: 'Les choix', texte: 'L’assistant montre ensuite les dernières interventions et les savoirs de la machine, puis ses pistes. Chaque réponse cliquée fait avancer le dépannage, jusqu’à « C’est réparé ».' },
    ],
  },
  'aitec-savoir': {
    titre: '2. Ce que sait AITEC',
    etapes: [
      { avant: () => aller('#/pannes'), attendre: '.liste-pannes', cible: ou('.carte-analyse', '.liste-pannes'), titre: 'Les pannes connues', texte: 'Les pannes qui reviennent, tirées des rapports, avec leurs causes et leurs remèdes.' },
      { avant: () => allerPuis('#/interventions'), attendre: '.filtres', cible: '.filtres', titre: 'L’historique', texte: 'Toutes les interventions de la GMAO, à filtrer par machine, type ou mot.' },
      { avant: () => allerPuis('#/documents'), attendre: '.filtres', cible: '.filtres', titre: 'Les documents', texte: 'Notices, schémas et photos : l’assistant les lit et les cite en source.' },
      { avant: () => aller('#/assistant'), attendre: '.qcm-depart', cible: '[data-presentation]', titre: 'À vous', texte: 'Ce bouton relance la présentation quand vous voulez.' },
    ],
  },
}

export const presentations = {
  prevtec: ['prevtec-lignes', 'prevtec-ma-ligne', 'prevtec-demonstrateur', 'prevtec-je-decide', 'prevtec-niveau-1'],
  aitec: ['aitec-depannage', 'aitec-savoir'],
}
