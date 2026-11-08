// Les symptômes classiques par élément, ce que l'IA annote dans les points de contrôle. Une connaissance de métier
// générique, gardée dans le fichier de connaissances (réglage « prev_symptomes ») et modifiable par l'administrateur
// dans les paramètres de « Ma ligne ». Une ligne par élément : « Élément / autre nom : symptôme ; symptôme ».

import { reglageJson, modifierReglage, noterModification } from '../../lib/base.js'

const DE_DEPART = `Bobine / électrovanne / distributeur : bobine noircie ; odeur de brûlé ; connecteur desserré ou oxydé ; fuite d'air ou d'huile à l'échappement ; tiroir collé ; échauffement anormal
Contacteur / relais : arc électrique ; contacts piqués ou collés ; boîtier noirci ou déformé ; bobine qui vibre ; bornes desserrées
Disjoncteur / fusible / sectionneur : trace d'échauffement ; bornes desserrées ; porte-fusible noirci ; déclenchement répété ; poignée qui ne verrouille plus
Variateur / servovariateur : ventilateur à l'arrêt ou encrassé ; radiateur empoussiéré ; condensateur gonflé ; connexions desserrées ; défaut récurrent à l'affichage
Automate / carte électronique : voyant de défaut ; connecteur mal enfiché ; poussière ou humidité sur la carte ; composant noirci ; pile faible
Armoire électrique : poussière ; condensation ; filtre de ventilation colmaté ; porte mal fermée ; câbles échauffés ; bornier desserré
Câble / connecteur / chemin de câble : gaine coupée ou écrasée ; connecteur oxydé ; pli serré ; câble qui frotte ; fixation arrachée
Capteur / détecteur / cellule : optique encrassée ; support desserré ou tordu ; câble pincé ; voyant instable ; jeu de détection incorrect
Codeur / résolveur : accouplement desserré ; connecteur oxydé ; perte de référence ; jeu sur l'arbre
Moteur électrique / motoréducteur : échauffement anormal ; bruit de roulement ; vibration ; ventilateur encrassé ; boîte à bornes ouverte ; fuite au réducteur
Servomoteur : échauffement anormal ; câble de puissance usé ; frein qui colle ; jeu à l'accouplement
Frein : garniture usée ; entrefer hors tolérance ; poussière de friction ; collage au desserrage
Réducteur / boîte de vitesses : fuite d'huile ; niveau bas ; bruit de denture ; jeu en sortie ; échauffement anormal
Roulement / palier : bruit ou grippement ; échauffement anormal ; jeu radial ; poudre métallique ; manque de graisse ; joint abîmé
Courroie / poulie : craquelures ; effilochage ; glaçage ; tension insuffisante ; désalignement ; gorge de poulie usée
Chaîne / pignon : allongement ; maillon raide ; dents usées en crochet ; manque de lubrification ; tension insuffisante
Accouplement : élément élastique fissuré ; jeu ; désalignement ; vis desserrées
Crémaillère / vis à billes / glissière : piste marquée ; jeu ; manque de graisse ; racleur abîmé ; copeaux sur la piste
Vérin hydraulique / vérin pneumatique / vérin : fuite à la tige ; tige rayée ou piquée ; joint usé ; fixation desserrée ; mouvement saccadé
Flexible / tuyau / tuyauterie / raccord : fuite ou suintement ; gaine craquelée ; hernie ; frottement ; raccord desserré ; fixation arrachée ; pli serré
Pompe hydraulique / pompe : bruit de cavitation ; échauffement anormal ; fuite à l'arbre ; pression instable ; vibration
Groupe hydraulique / centrale hydraulique / hydraulique : niveau bas ; huile sombre ou émulsionnée ; température élevée ; filtre colmaté ; fuite sur le bloc ; pression instable
Filtre : indicateur de colmatage ; cartouche encrassée ; fuite au corps de filtre ; joint abîmé
Accumulateur : pression de gonflage basse ; fuite ; fixation desserrée
Limiteur de pression / régulateur / pressostat : pression instable ; réglage déplacé ; fuite ; plombage absent
Pneumatique / circuit d'air : fuite audible ; condensats ; lubrificateur vide ; pression instable ; silencieux colmaté
Lubrification / graissage : réservoir vide ; tuyau débranché ; point de graissage sec ; excès de graisse ; pompe qui ne débite plus
Refroidisseur / échangeur / groupe frigo : ailettes encrassées ; ventilateur bruyant ; fuite de fluide ; température élevée ; givre anormal
Ventilateur / extracteur : pales encrassées ou fissurées ; balourd ; bruit de roulement ; courroie usée
Tapis / convoyeur / bande : bande effilochée ou décentrée ; agrafes usées ; rouleau bloqué ; tension insuffisante ; racleur usé
Rouleau / galet : rotation dure ou bloquée ; roulement bruyant ; surface marquée ; fixation desserrée
Outil / lame / poinçon / matrice : ébréchure ; usure d'arête ; bavure sur la pièce ; fixation desserrée
Mandrin / broche : jeu ; bruit de roulement ; mors usés ; échauffement anormal ; serrage insuffisant
Soudure / torche / électrode : électrode usée ; projections ; câble de masse desserré ; refroidissement insuffisant
Bâti / châssis / structure : fissure ; boulon desserré ; corrosion ; trace de choc
Sécurité / arrêt d'urgence / barrage / porte : verrou usé ou desserré ; capteur de porte déréglé ; bouton abîmé ; barrage encrassé ou désaligné ; shunt
Pupitre / écran / bouton : voyant grillé ; bouton dur ou collé ; écran rayé ou figé ; câble de liaison abîmé`

export const symptomesTexte = () => reglageJson('prev_symptomes', null)?.texte || DE_DEPART
const lire = () => symptomesTexte().split('\n').map((l) => {
  const i = l.indexOf(':')
  return i < 0 ? null : { element: l.slice(0, i).trim(), symptomes: l.slice(i + 1).trim() }
}).filter(Boolean)

export function enregistrerSymptomes(texte) {
  modifierReglage('prev_symptomes', { texte: String(texte || '').trim() })
  noterModification()
  return symptomesTexte()
}
// La liste rejoint le fichier de connaissances à la première écriture de l'administrateur.
export function garderSymptomes() {
  if (!reglageJson('prev_symptomes', null)) modifierReglage('prev_symptomes', { texte: DE_DEPART })
}

const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Les éléments dont parle ce texte (désignation, rapports de panne), les plus cités d'abord : pour la consigne de l'IA.
export function symptomesPour(texte, maximum = 8) {
  const t = sansAccents(texte)
  return lire().map((e) => {
    const mots = e.element.split('/').map((x) => sansAccents(x).trim()).filter((x) => x.length >= 4)
    return { ...e, cites: mots.reduce((s, m) => s + t.split(m.replace(/s$/, '')).length - 1, 0) }
  }).filter((e) => e.cites).sort((a, b) => b.cites - a.cites).slice(0, maximum).map((e) => `- ${e.element} : ${e.symptomes}`).join('\n')
}

// Un point de contrôle commence par son action, et ne dit pas « état attendu ».
export const FORMAT_POINT = `Chaque point est une seule phrase qui commence par l'action (Contrôle, Vérification, Inspection, Mesure, Nettoyage…), puis l'élément, puis ce qu'on doit constater, séparé par des virgules. Jamais de libellé comme « Organe : » ni les mots « état attendu ».
Quand un élément a des symptômes classiques dans la liste fournie, cite ceux qui s'appliquent.
Exemples de forme : « Contrôle de la tuyauterie du groupe, bien accrochée, pas de trace d'usure ni de fuite. » ; « Contrôle des bobines du distributeur, pas de bobine noircie ni d'odeur de brûlé, connecteur bien serré. » ; « Inspection des contacteurs, pas d'arc électrique ni de contacts piqués, bornes serrées. »`
const ACTION = /^(controle|verification|inspection|mesure|nettoyage|releve|essai|serrage|graissage|examen)\b/
export const commenceParAction = (p) => ACTION.test(sansAccents(p))
export const nettoyerPoint = (p) => String(p).replace(/^\s*[\d.)-]*\s*organe\s*:\s*/i, '').replace(/,?\s*l['’]état attendu est( une?| un)?\s*/gi, ', ').replace(/\s+,/g, ',').trim()
