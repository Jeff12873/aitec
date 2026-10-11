# Bloc « assistant »

La discussion avec l'IA : l'agent pose une question, l'assistant cherche les passages utiles
(bloc `recherche`) et rédige une réponse qui cite ses sources.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Route `POST /api/assistant` : recherche, consignes données au modèle, réponse en flux |
| `vue.js` | L'écran de discussion, les sources cliquables, la machine concernée |

## Changer le comportement de l'IA

Tout est dans `CONSIGNES`, en haut de `serveur.js` (en français). Par exemple, pour des réponses plus
courtes, ajouter une règle : « Réponds en 5 lignes au plus. »

Nombre de passages donnés à l'IA : `limite: 8` dans `serveur.js`. Plus de passages = réponses plus
complètes mais plus lentes.

## Où est gardée la conversation ?

Dans le navigateur du poste (`localStorage`, 40 derniers messages), jamais dans le fichier partagé.
