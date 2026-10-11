# Bloc « documents »

Dépôt des fichiers, lecture de leur texte, consultation et traduction.

| Fichier | Rôle |
|---|---|
| `extraction.js` | Lecture côté serveur : Word, Excel, LibreOffice, PowerPoint, CSV, texte, HTML, RTF |
| `serveur.js` | Routes `/api/documents…` et `/api/traduire`, lecture des images par l'IA (`CONSIGNE_IMAGE`) |
| `vue.js` | Dépôt (glisser-déposer), lecture des PDF et images dans le navigateur (pdf.js), texte lu, traduction |

## Pourquoi les PDF sont lus par le navigateur

Pour lire un PDF scanné, il faut dessiner chaque page en image, ce que le navigateur sait faire (pdf.js,
dans `interface/vendor/pdfjs`). Les pages qui contiennent du texte envoient directement ce texte ;
les autres sont envoyées en image à l'IA. Le fichier lui-même est enregistré dans la base dès le dépôt.

## Ajouter un format

Dans `extraction.js`, ajouter l'extension dans `extraireTexte` et une fonction qui renvoie le texte.
Les formats Office récents sont des ZIP : `lireZip` (dans `serveur/socle/zip.js`) les ouvre.
