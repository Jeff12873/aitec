# IASSITEC

Assistant IA pour les agents de maintenance. Il connaît le parc, les pièces de rechange, l'historique
des interventions et les documents de l'atelier, et répond aux questions **en français**, en citant ses sources.

- **IA gratuite, sur le poste** : un modèle libre (Qwen3.5) tourne avec llama.cpp. Rien ne sort de l'entreprise,
  tout fonctionne hors ligne après l'installation.
- **Dans le navigateur**, sous **Windows et Linux**, installé dans le profil de l'utilisateur : aucun droit
  d'administrateur, rien dans Program Files.
- **Un fichier `.datassitec` partagé** (sur le lecteur réseau) contient toute la base ; chaque poste l'ouvre.
  Un seul administrateur modifie à la fois (verrou), les autres consultent.
- **Import des exports de GMAO** (CSV, Excel, LibreOffice), **documents de tout type** (PDF même scannés, Word,
  Excel, photos…), notices en langue étrangère traduites à la volée.

## Installer sur un poste

Télécharger [IASSITEC.zip](https://github.com/Jeff12873/iassitec/releases/latest/download/IASSITEC.zip),
le décompresser, puis :

- **Windows** : double-cliquer sur `Preparer IASSITEC.bat`
- **Linux** : `sh preparer-iassitec.sh`

La préparation installe IASSITEC dans le profil (`%LOCALAPPDATA%\IASSITEC` ou `~/.local/share/iassitec`),
analyse le poste (mémoire, carte graphique), télécharge le moteur d'IA et le modèle adapté, l'essaie,
et crée les raccourcis. Internet n'est nécessaire que pendant cette étape. Détails : aide « Installation »
dans le logiciel, et [docs/MODELES.md](docs/MODELES.md).

Au premier lancement : créer le fichier de l'atelier (premier poste) ou l'ouvrir (postes suivants).

## Développer

Aucune dépendance, aucune compilation : seulement Node 24.

```sh
node outils/preparer.js --ici --sans-raccourcis   # une fois : moteur d'IA et modèle
node serveur/demarrer.js                          # lance IASSITEC et ouvre le navigateur
```

Le code est découpé en **blocs** (`blocs/<nom>/` : `serveur.js`, `vue.js`, `README.md`), chacun modifiable seul.

| Document | Contenu |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Organisation du code, fonctionnement de l'IA |
| [docs/FICHIER-PARTAGE.md](docs/FICHIER-PARTAGE.md) | Le fichier `.datassitec` partagé : copie, verrou, publication, sauvegardes |
| [docs/DONNEES.md](docs/DONNEES.md) | Les tables du fichier |
| [docs/MODELES.md](docs/MODELES.md) | Les modèles d'IA et comment en changer |
| [docs/AJOUTER-UN-BLOC.md](docs/AJOUTER-UN-BLOC.md) | Ajouter un écran |
| [docs/AJOUTER-UN-CHAMP.md](docs/AJOUTER-UN-CHAMP.md) | Ajouter un champ à une table |
| [docs/exemples/](docs/exemples) | Exports GMAO d'une usine fictive, pour essayer l'import |

## Publication

À chaque envoi sur `main`, GitHub fabrique `IASSITEC.zip` et le publie dans les Releases
(`.github/workflows/publier.yml`). Les postes installés le proposent dans Administration › Mises à jour.

## Composants tiers

- [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT), téléchargé par la préparation
- Modèles [Qwen3.5](https://huggingface.co/Qwen) et Qwen3-Embedding (Apache 2.0), téléchargés par la préparation
- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), dans `interface/vendor/pdfjs`
- Tracés d'icônes [Lucide](https://lucide.dev) (ISC), dans `interface/socle/icones.js`
