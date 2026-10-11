# Bloc « tableau-de-bord »

Tuiles chiffrées, graphiques (interventions par mois, types, machines les plus en panne),
pièces à commander, dernières interventions, et « Ce que l'IA remarque ».

| Fichier | Rôle |
|---|---|
| `serveur.js` | Les calculs (requêtes SQL), les remarques de l'IA, `resumeChiffres` (donné à l'assistant) |
| `vue.js` | L'écran ; les graphiques viennent de `interface/socle/graphiques.js` |
