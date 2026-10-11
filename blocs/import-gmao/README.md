# Bloc « import-gmao »

Import des exports de GMAO (CSV, XLSX, ODS) vers les machines ou les interventions.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Lecture du fichier, correspondance des colonnes, import ligne par ligne |
| `vue.js` | Choix du fichier, de la destination, vérification des colonnes, bilan |

## Faire reconnaître les colonnes de votre GMAO

Dans `serveur.js`, chaque champ de `CIBLES` a une liste de `synonymes` : les intitulés de colonnes
reconnus automatiquement, écrits en minuscules et sans accents. Ajoutez-y ceux de votre logiciel.

Une correspondance validée à la main est de toute façon retenue dans le fichier (réglage `imports`).

## Types d'intervention

`normaliserType` traduit les codes de la GMAO (CUR, PREV, SYST…) vers les types d'IASSITEC.
