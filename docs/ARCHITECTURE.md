# Architecture

IASSITEC est un petit serveur web qui tourne **sur le poste de l'agent** et qu'on utilise dans le navigateur.
Aucune bibliothèque à installer, aucune étape de compilation : on modifie un fichier, on relance, c'est pris en compte.

```
navigateur  ──►  serveur Node (127.0.0.1:47800)  ──►  copie locale du fichier .datassitec  ◄──►  lecteur réseau
                          │
                          └──►  llama.cpp : modèle de réponse (Qwen3.5) + modèle de recherche (Qwen3-Embedding)
```

## Les dossiers

| Dossier | Contenu |
|---|---|
| `serveur/demarrer.js` | Point de départ : rouvre le fichier, charge les blocs, démarre le serveur, ouvre le navigateur |
| `serveur/socle/` | Les outils communs (voir ci-dessous) |
| `blocs/<nom>/` | Une fonction de l'application = un dossier : `serveur.js` (routes), `vue.js` (écran), `README.md` |
| `interface/` | La page, le thème (`theme.css`), le menu (`app.js`), les outils d'écran (`socle/`), l'aide, pdf.js |
| `outils/` | La préparation d'un poste (`preparer.js`) et la liste des versions à télécharger (`catalogue.json`) |
| `docs/` | Cette documentation, et des exemples d'exports GMAO (usine fictive) |

Dossiers créés sur le poste, jamais dans Git : `moteur/` (Node, llama.cpp), `cache/` (copie du fichier,
icône des raccourcis), `installation.json`, `reglages-poste.json`, `journal.txt`.

## Le socle du serveur

| Fichier | Rôle |
|---|---|
| `installation.js` | Chemins, réglages du poste, journal |
| `http.js` | Le serveur web : routes, fichiers de l'interface, réponses en flux |
| `base.js` | Ouverture de la base SQLite, structure des tables, transactions |
| `partage.js` | Le fichier partagé : copie locale, verrou administrateur, publication, sauvegardes |
| `tables.js` | Lecture et écriture des tables simples, routes standard, conversion des dates et nombres |
| `ia.js` | Démarrage / arrêt des modèles (llama.cpp), questions au modèle, vecteurs de recherche |
| `zip.js`, `tar.js`, `tableurs.js` | Lecture des ZIP (Office récent), des .tar.gz (kits Linux), des CSV, XLS, XLSX et ODS |
| `fichier-compose.js`, `word97.js`, `excel97.js`, `powerpoint97.js` | Lecture des anciens formats Office (.doc, .xls, .ppt) |
| `telechargement.js` | Téléchargements avec reprise et vérification |
| `icone.js`, `securite.js` | Icône des raccourcis ; mots de passe |

## Les blocs

| Bloc | Écran / rôle |
|---|---|
| `fichier` | Accueil, choix et création du fichier, mode administrateur |
| `tableau-de-bord` | Tuiles, graphiques, remarques de l'IA |
| `assistant` | Discussion avec l'IA |
| `recherche` | Passages, index, recherche par mots et par le sens |
| `parc`, `interventions` | Fiches des machines et des interventions (ouvertes depuis les sources de l'IA) |
| `documents` | Dépôt et lecture des fichiers |
| `import-gmao` | Import des exports de GMAO |
| `administration` | Réglages, icône, mises à jour |
| `aide` | L'aide intégrée |

## Le fonctionnement de l'IA

1. Tout ce qui peut être cherché est découpé en **passages** (table `passages`) : morceaux de documents
   d'environ 1 200 caractères, et une fiche texte par machine et par intervention.
2. Chaque passage reçoit un **vecteur** (512 nombres) calculé par le petit modèle de recherche,
   en arrière-plan, sur le poste de l'administrateur.
3. À chaque question : recherche par mots-clés (SQLite FTS5) + recherche par le sens (vecteurs),
   fusion des deux classements, 8 passages au plus.
4. Le modèle reçoit les consignes, les chiffres de la base, ces passages et la question ; il répond en
   français en citant les passages ([1], [2]…).

Les deux modèles tournent avec `llama-server` (llama.cpp), lancés à la demande et arrêtés après un moment
sans utilisation. Rien ne sort du poste.
