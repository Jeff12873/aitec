// Les présentations guidées de PREVTEC et d'AITEC (moteur : /socle/visite.js de K.NOVA) : proposées au premier lancement,
// relancées par le bouton de la barre du haut. Elles naviguent à la place de l'utilisateur et ne modifient rien. La ligne
// et la machine montrées sont prises dans la base : la ligne au verdict le plus mauvais, sa machine la plus en panne.


const $ = (s) => document.querySelector(s)
const ou = (...selecteurs) => () => selecteurs.map($).find(Boolean) || $('.contenu')
const aller = (adresse) => { location.hash = adresse }
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms))
// Le temps que l'écran précédent parte : son contenu ne doit pas être pris pour celui du suivant.
const allerPuis = async (adresse) => { aller(adresse); await pause(600) }
const LOGO_N1 = new URL('mn1.webp', import.meta.url).href

// La ligne montrée : la première vignette triée par tendance ; tout le reste de la présentation reste sur elle.
let ligne = null
const parc = () => encodeURIComponent(ligne)
let nomLigne = ''
const adresseLigne = () => `#/mn1/parc/${parc()}`

// Le carré qui a le plus de pannes, et à égalité le plus de visites.
function lePlusCharge(selecteur) {
  const chiffres = (e) => /(\d+) pannes, (\d+) visites/.exec(e.getAttribute('title') || e.dataset.bulle || '')?.slice(1).map(Number) || [0, 0]
  return [...document.querySelectorAll(selecteur)].map((e) => [e, chiffres(e)]).filter(([, [, v]]) => v > 0).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1])[0]?.[0] || $(selecteur)
}

// Une icône du Démonstrateur : une vraie case si la machine en a une, sinon une case d'exemple, le temps de la visite.
function icone(selecteur, classes, contenu) {
  return () => {
    const vraie = $(selecteur)
    if (vraie) return vraie
    let ligneExemple = $('.ligne-exemple')
    if (!ligneExemple) {
      ligneExemple = document.createElement('tr')
      ligneExemple.className = 'ligne-exemple'
      ligneExemple.innerHTML = `<th class="titre-visite discret">Exemple</th>${'<td></td>'.repeat(document.querySelectorAll('.matrice-demo th.col-t, .matrice-demo th.col-passages').length)}`
      $('.matrice-demo tbody')?.append(ligneExemple)
    }
    let c = ligneExemple.querySelector(`[data-exemple="${classes}"]`)
    if (!c) {
      c = document.createElement('td')
      c.className = `carre croisee ${classes}`
      c.dataset.exemple = classes
      c.innerHTML = contenu()
      ligneExemple.append(c)
    }
    return c
  }
}
const logo = () => `<img src="${LOGO_N1}" alt="">`
const onglet = (o) => `.barre-onglets-ligne a.choisi[href$="/${o}"]`

export const visites = {
  'prevtec-lignes': {
    titre: '1. Les lignes',
    etapes: [
      { titre: 'Bienvenue dans PREVTEC', avant: () => aller('#/mn1'), texte: 'PREVTEC sert à réévaluer le plan de maintenance : le préventif regarde-t-il les bonnes pannes, et en bonne quantité ? Je vais parcourir un cas réel à votre place. Rien ne sera modifié.' },
      { attendre: '.fil-etapes', cible: '.fil-etapes', titre: 'Le fil du parcours', texte: 'Quatre étapes, toujours en haut : choisir la ligne, la regarder, ouvrir le Démonstrateur d’une machine, décider.' },
      { attendre: '.barre-vignettes', cible: '.barre-vignettes', titre: 'Trier les lignes', avant: async () => { await pause(300); [...document.querySelectorAll('.barre-vignettes button')].find((b) => b.textContent === 'Tendance')?.click(); await pause(700) }, texte: 'Je les trie par tendance : les lignes dont les pannes montent le plus viennent d’abord.' },
      { attendre: '.vignette-mn1', cible: '.vignette-mn1', titre: 'La première vignette', texte: 'Le verdict de son plan, ses pannes et ses visites sur 12 mois terminés, et leur courbe. C’est la ligne que nous allons suivre jusqu’au bout.' },
    ],
  },
  'prevtec-ma-ligne': {
    titre: '2. Ma ligne',
    etapes: [
      { avant: async () => { nomLigne = $('.vignette-mn1 h2')?.textContent || ''; $('.vignette-mn1')?.click(); await pause(400); ligne = decodeURIComponent(/parc\/([^?]+)/.exec(location.hash)?.[1] || '') }, attendre: '.bandeau-verdict', cible: '.bandeau-verdict', titre: 'Le verdict, expliqué', texte: 'Pourquoi ce plan est à surveiller ou à réévaluer, en clair, sur les 12 derniers mois terminés face aux 12 d’avant.' },
      { cible: ou('.bandeau-gains', '.bandeau-verdict'), titre: 'Les bonnes nouvelles d’abord', texte: 'Les pannes qui baissent, les visites retirées, les heures rendues à l’équipe, et le gain encore possible. Uniquement de vrais chiffres. Les décisions et leur bilan s’ouvrent d’ici.' },
      { cible: ou('.par-ou-commencer'), titre: 'Par où commencer', texte: 'Juste sous le verdict : les ETH où il y a le plus à gagner, en une phrase chacune.' },
      { avant: async () => { $('.calendrier-compact')?.click(); await pause(500) }, attendre: '.fenetre .semaine-cal', cible: () => $('.fenetre') , titre: 'Les équipes', texte: 'Le calendrier de l’année : chaque semaine porte ses équipes, A en bleu, B en vert, C en violet. Il pèse sur les indicateurs du niveau 1. En mode administrateur, un clic ou un glissé change les semaines.' },
      { avant: async () => { [...document.querySelectorAll('.fenetre button')].find((b) => b.textContent === 'Fermer')?.click(); await pause(300) }, attendre: '.zone-hof-ligne', cible: ou('.hall-of-fame', '.zone-hof-ligne'), titre: 'Les contributeurs du mois', texte: 'Ceux qui remontent et exécutent le niveau 1 sur cette ligne, et un bouton pour aller à sa maintenance de niveau 1.' },
      { cible: ou('.tuiles-ligne'), titre: 'Les indicateurs', texte: 'Pannes, temps de dépannage, part du préventif, dépanneurs par panne, concentration. Le « ? » dit comment chacun est calculé.' },
      { attendre: '.tableau-cases-zone', cible: '.tableau-cases-zone', titre: 'Le tableau des ETH', texte: 'Les pannes en hauteur, les visites en largeur. Beaucoup de pannes et peu de visites : pas assez de préventif. Beaucoup des deux : le préventif regarde sans doute au mauvais endroit. La légende est dessous.' },
    ],
  },
  'prevtec-zoom': {
    titre: '3. Plonger dans le tableau',
    etapes: [
      { cible: () => lePlusCharge('.puce-eth'), zoom: 1.25, titre: 'L’ETH la plus chargée', texte: 'Celle qui a le plus de pannes et le plus de visites : allons voir ses machines.' },
      { avant: async () => { lePlusCharge('.puce-eth')?.click(); await pause(700) }, attendre: '.tete-equilibre .barre-retour', cible: '.tableau-cases-zone', titre: 'Ses machines', texte: 'Le clic plonge dans le carré : le même tableau, machine par machine. La flèche « Toutes les ETH » remonte d’un niveau.' },
      { cible: () => lePlusCharge('.puce-case:not(.puce-eth)'), zoom: 1.6, titre: 'La machine la plus chargée', texte: 'Le plus de pannes et le plus de visites sur l’ETH : c’est le cas le plus intéressant à ouvrir.' },
    ],
  },
  'prevtec-demonstrateur': {
    titre: '4. Le Démonstrateur',
    etapes: [
      { avant: async () => { lePlusCharge('.puce-case:not(.puce-eth)')?.click(); await pause(700) }, attendre: '.matrice-demo', cible: ou('.resume-machine'), titre: 'Pourquoi regarder cette machine', texte: 'Son rang dans son ETH, le sens de ses pannes, où elles se concentrent, et ce que dit son préventif.' },
      { cible: '.demo-conteneur', titre: 'La matrice', texte: 'En colonnes les équipements, le plus en panne à gauche. En lignes les visites. À la croisée, l’endroit où chaque visite est posée.' },
      { cible: ou('th.col-t'), titre: 'La colonne % RAS', texte: 'La part des passages sans rien trouver, lue dans les observations écrites : très haute, elle désigne une visite trop vague ou trop fréquente.' },
      { cible: ou('.ligne-diagnostics'), titre: 'Le diagnostic', texte: 'Sous chaque équipement, tout en haut : pas de préventif (!), mauvais point contrôlé ou énoncé trop vague (?), préventif ok (✓), ou sur maintenance (+). Le survol dit pourquoi.' },
      { cible: icone('td.posee:not(.titre):not(.attente)', 'posee', () => '●'), zoom: 2, titre: 'Le rond plein', texte: 'La visite est posée sur cet équipement dans la GMAO. Un clic ouvre « Je décide ». Ce qui va bien reste en retrait, pour que les problèmes ressortent.' },
      { cible: icone('td.posee.titre', 'posee titre', () => '○'), zoom: 2, titre: 'Le rond vide', texte: 'Posée sur la machine entière dans la GMAO, mais son titre nomme cet organe : elle est rattachée ici. Un clic propose de valider le déplacement dans la GMAO.' },
      { cible: icone('td.attente', 'posee attente', () => '●'), zoom: 2, titre: 'Le contour ambre', texte: 'Pas encore réel : une visite glissée sur un autre équipement, une fiche préparée par l’IA, un brouillon de niveau 1. Cela ne compte pas dans le diagnostic.' },
      { cible: ou('.barre-attente', '.legende-demo'), titre: 'Ce qui reste à valider', texte: 'Dès qu’un changement attend, une barre le dit au-dessus du tableau. Elle ouvre la liste, avec Valider ou Annuler pour chacun. Rien n’est écrit dans la GMAO avant.' },
      { avant: () => { if (!$('.ligne-n1')) $('.repli-n1')?.click() }, cible: ou('.tete-n1', '.legende-demo'), titre: 'Le niveau 1, à part', texte: 'Repliées par défaut : les fiches des opérateurs sur cette machine, et la charge de leur ETH : un message prévient si une nouvelle fiche ferait dépasser le maximum.' },
      { cible: icone('td.fiche-n1:not(.attente)', 'fiche-n1', logo), zoom: 2, titre: 'Le logo N1', texte: 'Une fiche de niveau 1 active, avec une FI ou en service sur papier. Elle compte dans le diagnostic de l’équipement.' },
      { cible: ou('.ligne-ajout', '.legende-demo'), titre: 'Préparer sans rien casser', texte: 'En mode administrateur, « Nouvelle visite » et « Nouvelle fiche » créent une ligne vide : on clique la case de l’équipement, l’IA rédige d’après ses pannes. Un clic sur une case donne ses actions.' },
    ],
  },
  'prevtec-je-decide': {
    titre: '5. Je décide',
    etapes: [
      { avant: () => { $('.ligne-exemple')?.remove(); ($('td.posee.col-clic:not(.attente):not(.titre):not(.fiche-locale)') || $('td.posee.vague') || $('td.posee.col-clic'))?.click() }, attendre: '.detail-decider', cible: '.detail-decider > .carte:nth-child(1)', titre: 'La visite telle qu’elle est écrite', texte: 'Un clic sur un rond ouvre cette page, pour cette visite et cet équipement : le contenu de sa FI dans la GMAO et les observations des derniers passages.' },
      { cible: '.detail-decider > .carte:nth-child(2)', titre: 'Les préconisations', texte: 'Ce que l’IA en pense, en quelques lignes, à partir de la FI, des observations et des pannes de l’équipement.' },
      { cible: ou('.reco-decider', '.carte-decisions'), titre: 'Une recommandation', texte: 'Le bouton mis en avant dépend des faits. Les contrôles de sécurité et réglementaires sont protégés : ne rien y trouver est justement le résultat espéré.' },
      { cible: ou('[data-decision="supprimer"]', '.carte-decisions'), zoom: 1.2, titre: 'Retirer du préventif', texte: 'Le premier réflexe. Quand une visite ne trouve rien sur un équipement sans panne, PREVTEC recommande de la retirer ou de l’espacer, et chiffre les heures rendues. La simulation d’abord, l’écriture ensuite. Le bilan dira si elle manque.' },
      { cible: ou('[data-decision="n1"]', '.carte-decisions'), zoom: 1.2, titre: 'Créer une fiche N1', texte: 'L’IA rédige un contrôle pour l’opérateur, vous le relisez. Un message prévient si la charge de l’ETH serait dépassée.' },
      { cible: ou('[data-decision="modifier"]', '.carte-decisions'), zoom: 1.2, titre: 'Modifier la FI actuelle', texte: 'L’IA propose une FI revue à côté de l’actuelle, en phrases de contrôle avec les symptômes classiques. On la reporte dans la GMAO.' },
      { cible: ou('.carte-decisions .actions button:last-child', '.carte-decisions'), zoom: 1.2, titre: 'La fiche de visite', texte: 'Pour le mainteneur : l’historique des pannes de ce que la visite couvre et les points à cocher, à imprimer.' },
      { cible: ou('.cas-suivant', '.carte-decisions'), zoom: 1.2, titre: 'Cas suivant', texte: 'On enchaîne sur la visite suivante de cette machine, celles où il y a le plus à gagner d’abord.' },
    ],
  },
  'prevtec-niveau-1': {
    titre: '6. La maintenance de niveau 1',
    etapes: [
      { avant: () => allerPuis('#/niveau1'), attendre: '.vignette-mn1', cible: () => [...document.querySelectorAll('.vignette-mn1')].find((v) => v.querySelector('h2')?.textContent === nomLigne) || $('.vignette-mn1'), titre: 'Le menu de gauche', texte: 'Une vignette par ligne : la charge des opérateurs, la pertinence des fiches, la tendance des pannes et les alertes. Nous revenons sur la même ligne.' },
      { avant: () => allerPuis(`#/niveau1/${parc()}`), attendre: '.barre-onglets-ligne', cible: '.barre-onglets-ligne', titre: 'Quatre onglets', texte: 'Les fiches de la ligne, puis son circuit : la demande, la fiche d’intervention, le rapport.' },
      { cible: ou('.eths-parc', '.haut-parc'), titre: 'La charge des opérateurs', texte: 'Par ETH : les FI en place face au maximum de fiches par semaine. Au-delà, on choisit les FI à suspendre.' },
      { cible: ou('.filtres-mn1'), titre: 'Trier les fiches', texte: 'Avec FI, sur papier, brouillons, à revoir, nouvelles : la vie d’une fiche.' },
      { cible: ou('.encart-eth', '.parc-mn1'), titre: 'Un encart par ETH', texte: 'Chaque fiche avec son état et ses alertes. Un clic en montre le détail, et on les imprime d’ici.' },
      { avant: () => allerPuis(`#/niveau1/${parc()}/demandes`), attendre: onglet('demandes'), cible: ou('.indicateurs-mn1', '.parc-mn1'), titre: 'Le circuit : les indicateurs', texte: 'DI par semaine, tendance, délai jusqu’à la clôture, demandes sans FI, FI en retard. Une alerte prévient si les demandes baissent ou reposent sur une seule personne.' },
      { cible: ou('.barre-demandes ~ .grille', '.parc-mn1'), titre: 'Les demandes (DI)', texte: 'Ce que les conducteurs remontent : par mois, par demandeur, par machine et par ETH, et ce qu’elles sont devenues.' },
      { avant: () => allerPuis(`#/niveau1/${parc()}/fi`), attendre: onglet('fi'), cible: ou('.parc-mn1 > div:last-child', '.parc-mn1'), titre: 'Les fiches d’intervention (FI)', texte: 'Les FI nées des demandes, et ce qu’il leur manque, comme leur double arborescence production et maintenance.' },
      { avant: () => allerPuis(`#/niveau1/${parc()}/ri`), attendre: onglet('ri'), cible: ou('.parc-mn1 > div:last-child > :first-child', '.parc-mn1'), titre: 'Les rapports (RI)', texte: 'Ce qui a été fait, par qui : l’activité des conducteurs et la lecture de leurs rapports.' },
      { avant: () => allerPuis('#/mn1'), attendre: '.fil-etapes', cible: '[data-presentation]', zoom: 1.4, titre: 'À vous', texte: 'Ce bouton relance la présentation quand vous voulez. Maintenir le clic hors de cette bulle la passe.' },
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
  prevtec: ['prevtec-lignes', 'prevtec-ma-ligne', 'prevtec-zoom', 'prevtec-demonstrateur', 'prevtec-je-decide', 'prevtec-niveau-1'],
  aitec: ['aitec-depannage', 'aitec-savoir'],
}
