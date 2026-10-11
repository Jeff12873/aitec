# Bloc « interventions »

L'historique des pannes, entretiens et réglages.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Table `interventions`, routes `/api/interventions`, types proposés (`TYPES`), texte donné à l'IA |
| `vue.js` | Liste filtrable (500 plus récentes), fiche, formulaire |

Le numéro d'OT est facultatif mais unique : il sert à reconnaître une intervention lors d'un nouvel import.
