# Bloc « administration »

Réglages de ce poste, fichier de l'atelier, icône, mot de passe, index de recherche, mises à jour.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Icône (`/api/icone`), réglages communs, réglages du poste, arrêt, mises à jour depuis GitHub |
| `vue.js` | L'écran |

## Mises à jour

`/api/mise-a-jour` compare la version installée (`VERSION`) à la dernière Release GitHub
(`DEPOT_GITHUB`). L'installation télécharge `IASSITEC.zip`, remplace les dossiers de code
(l'ancienne version est gardée dans `cache/version-precedente`), puis quitte avec le code 42 :
le lanceur relance alors IASSITEC.
