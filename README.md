# AITEC

Application de la suite **[KTEC](https://github.com/Jeff12873/ktec)** (ex **IASSITEC**) : l'assistant IA des
agents de maintenance. Il connaît le parc, l'historique des interventions et les documents de l'atelier, et répond
aux questions **en français**, en citant ses sources.

- **IA gratuite, sur le poste** : un modèle libre (Qwen3.5) tourne avec llama.cpp. Rien ne sort de l'entreprise,
  tout fonctionne hors ligne après l'installation. Moteur et modèle sont ceux de KTEC, partagés avec les autres
  applications.
- **Données de la GMAO en direct** : le parc et les interventions sont lus dans la base de la GMAO (connexion MySQL
  de KTEC) et tenus à jour tout seuls, tous les quarts d'heure ; seules les lignes nouvelles ou changées sont écrites
  et réindexées. L'import d'exports CSV, Excel ou LibreOffice reste possible.
- **Documents de tout type** (PDF même scannés, schémas et plans, Word, Excel, photos…), notices en langue étrangère
  traduites à la volée.
- **Un seul fichier de connaissances `.ktec`**, commun aux applications KTEC et partagé sur le lecteur réseau : copie
  locale, un seul poste modifie à la fois (verrou), publication automatique, sauvegardes. Un ancien fichier IASSITEC
  (`.datassitec`) se reprend en un clic (Administration › Réglages).
- **Parcs machines** : les racines de l'arborescence de la GMAO rangées en parcs (production, maintenance), avec un
  sélecteur de parc pour tout AITEC ; les racines masquées ne comptent nulle part.
- **Maintenance de niveau 1** : une vignette par parc (charge réelle des FI de la GMAO, pertinence des fiches face
  au Pareto des pannes, tendance, alertes), la fiche MN1 du parc, et la création, le remplacement ou la suspension
  des FI dans la GMAO (SQL du site, simulé d'abord, en mode administrateur).

Tout ce qui est propre au site (données, requêtes de synchronisation, glossaire) est dans le `.ktec`, jamais dans
ce dépôt : c'est une coquille vide.

## Installer

AITEC s'installe avec KTEC : voir le [dépôt ktec](https://github.com/Jeff12873/ktec). À chaque envoi sur `main`,
GitHub publie `aitec.zip` (l'application seule) dans les Releases.

## Développer

Dans le `reglages-poste.json` de KTEC : `{ "applisDev": ["/chemin/vers/AITEC"] }`, puis lancer KTEC et ouvrir
http://127.0.0.1:47700/aitec/.

| Dossier | Contenu |
|---|---|
| `blocs/<nom>/` | Une fonction = un dossier : `serveur.js` (routes, sous `/api/aitec/…`), `vue.js` (écran), `README.md` |
| `lib/` | Les données d'AITEC dans le `.ktec` (`base.js`), tables simples (`tables.js`), lecture des tableurs et des anciens formats Office, glossaire |
| `interface/` | Menu (`menu.js`), icône, aide intégrée, pdf.js |
| `docs/` | Documentation, et des exemples d'exports GMAO (usine fictive) |

| Document | Contenu |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Organisation du code, fonctionnement de l'IA, synchronisation avec la GMAO |
| [docs/DONNEES.md](docs/DONNEES.md) | Les tables d'AITEC dans le `.ktec` |
| [docs/MODELES.md](docs/MODELES.md) | Les modèles d'IA et comment en changer |
| [docs/AJOUTER-UN-BLOC.md](docs/AJOUTER-UN-BLOC.md) | Ajouter un écran |
| [docs/AJOUTER-UN-CHAMP.md](docs/AJOUTER-UN-CHAMP.md) | Ajouter un champ à une table |
| [docs/exemples/](docs/exemples) | Exports GMAO d'une usine fictive, pour essayer l'import |

## Composants tiers

- [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT), installé par KTEC
- Modèles [Qwen3.5](https://huggingface.co/Qwen) et Qwen3-Embedding (Apache 2.0), installés par KTEC
- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), dans `interface/vendor/pdfjs`
