# Bloc « aide »

L'aide intégrée. Chaque page est un fichier HTML simple dans `interface/aide/` : on peut la
corriger avec n'importe quel éditeur de texte, sans rien relancer.

Pour ajouter une page : créer `interface/aide/ma-page.html`, puis l'ajouter à la liste `PAGES` de `vue.js`.
Le bouton « ? » de chaque écran ouvre la page indiquée par la propriété `aide` du bloc.
