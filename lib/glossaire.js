// Le glossaire des repères : ce que signifient les lettres des repères sur les schémas de l'atelier.
// Il est donné à l'IA quand elle lit un folio et quand elle répond, pour qu'elle reconnaisse les composants.
// Modifiable dans Administration › Réglages (enregistré dans le fichier .datassitec, le même pour tous les postes).

import { baseOuverte, reglage } from './base.js'

export const GLOSSAIRE_PAR_DEFAUT = `# Repères électriques (usage courant, à adapter au site)
Q, QF = disjoncteur, sectionneur, interrupteur général
KM = contacteur ; KA, K = relais, relais de sécurité
F, FU = fusible ou protection ; F (relais thermique) = protection moteur
S, SB = bouton, arrêt d'urgence, interrupteur de position
B = capteur (inductif, cellule, codeur…)
Y, YV = électrovanne (bobine) ; H, HL = voyant
M = moteur ; T = transformateur, alimentation ; U, G = variateur, alimentation
X = bornier, connecteur ; W = câble ; PE = terre
I.Data, %I, E = entrée automate ; O.Data, %Q, A = sortie automate

# Repères pneumatiques et hydrauliques (à vérifier sur vos schémas)
C = vérin ; D = distributeur ; YV = bobine de distributeur
SP = pressostat ; RP = régulateur de pression
RD = réducteur de débit ; NR, NRP = clapet anti-retour (piloté)
10x1.25, 8x1… = diamètre extérieur x épaisseur du tube (mm)`

export function glossaire() {
  return (baseOuverte() && reglage('glossaire')) || GLOSSAIRE_PAR_DEFAUT
}
