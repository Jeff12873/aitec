# Bloc « documents »

Dépôt des fichiers, lecture de leur texte, consultation et traduction.

| Fichier | Rôle |
|---|---|
| `extraction.js` | Lecture côté serveur : Word, Excel, PowerPoint (récents et anciens formats), LibreOffice, CSV, texte, HTML, RTF ; liste des images d'un document |
| `lecteur-images.js` | Lecture des images des documents par l'IA, en arrière-plan (`CONSIGNE_IMAGE`) |
| `serveur.js` | Routes `/api/documents…` (dont « Tout relire ») et `/api/traduire` |
| `vue.js` | Dépôt (glisser-déposer), lecture des PDF et images dans le navigateur (pdf.js), texte lu, traduction |

## Pourquoi les PDF sont lus par le navigateur

Pour lire un PDF scanné, il faut dessiner chaque page en image, ce que le navigateur sait faire (pdf.js,
dans `interface/vendor/pdfjs`). Les pages qui contiennent du texte envoient directement ce texte ;
les autres sont envoyées en image à l'IA. Le fichier lui-même est enregistré dans la base dès le dépôt.

## Ajouter un format

Dans `extraction.js`, ajouter l'extension dans `extraireTexte` et une fonction qui renvoie le texte.
Les formats Office récents sont des ZIP : `lireZip` (dans `serveur/socle/zip.js`) les ouvre.

## Les images dans les documents

Après le texte, les photos et captures d'écran d'un .docx, .pptx, .odt (dossiers `word/media`, `ppt/media`, `Pictures`)
ou d'un ancien .doc / .ppt (flux `Data` / `Pictures`, images PNG et JPEG) sont lues une à une par l'IA, qui les décrit et recopie leur texte.
Les petites images (moins de 15 Ko : logos, icônes) et les doublons sont ignorés ; 40 images au plus par document.
Les dessins vectoriels (EMF, WMF) ne sont pas lus.
