# Architecture

AITEC est une application **KTEC** : le portail KTEC fournit le serveur web (sur le poste de l'agent, utilisé dans
le navigateur), la coquille de l'interface, l'IA, la connexion MySQL et le fichier de connaissances `.ktec` partagé.
Ce dépôt ne contient que ce qui est propre à AITEC.

```
navigateur  ──►  KTEC (127.0.0.1:47700)  ──►  /api/aitec/…  (routes des blocs d'AITEC)
                      │
                      ├──►  copie locale du fichier .ktec  ◄──►  lecteur réseau (verrou, publication)
                      ├──►  llama.cpp : modèle de réponse (Qwen3.5) + modèle de recherche (Qwen3-Embedding)
                      └──►  java Moteur ──► MySQL de la GMAO (lecture seule) : synchronisation du parc et des interventions
```

## Les dossiers

| Dossier | Contenu |
|---|---|
| `app.json` | Nom, description, icône, composants nécessaires (IA, Java) |
| `blocs/<nom>/` | Une fonction de l'application = un dossier : `serveur.js` (routes), `vue.js` (écran), `README.md` |
| `lib/` | Les données d'AITEC dans le `.ktec` (`base.js` : tables, réglages), tables simples (`tables.js`), lecture des tableurs (`tableurs.js`) et des anciens formats Office, glossaire des repères |
| `interface/` | Menu (`menu.js`), icône, aide intégrée, pdf.js |
| `docs/` | Cette documentation, et des exemples d'exports GMAO (usine fictive) |

Le code serveur importe le socle de KTEC par `ktec/…` (`ktec/partage.js` pour le verrou et la publication,
`ktec/ia.js`, `ktec/mysql.js`, `ktec/http.js`…), et `lib/` par chemins relatifs. Toute écriture commence par
`ctx.exigerAdmin()` et se termine par `noterModification()`.

## Les blocs

| Bloc | Écran / rôle |
|---|---|
| `tableau-de-bord` | Tuiles, graphiques, remarques de l'IA |
| `assistant` | Discussion avec l'IA |
| `recherche` | Passages, index, recherche par mots et par le sens |
| `parc`, `interventions` | Fiches des machines et des interventions (ouvertes depuis les sources de l'IA) |
| `documents` | Dépôt et lecture des fichiers |
| `import-gmao` | Données de la GMAO : synchronisation avec la base MySQL (`synchronisation.js`), import des exports |
| `administration` | Documents, données de la GMAO, réglages (atelier, glossaire, index, modèle, reprise d'un fichier IASSITEC) |
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

## La synchronisation avec la GMAO

Deux requêtes, rangées dans le `.ktec` (réglage `requetes_mysql`), renvoient une ligne par machine et par
intervention avec des colonnes nommées comme les champs d'AITEC. Tous les quarts d'heure (et sur demande), elles
sont lancées par la connexion MySQL de KTEC ; seules les lignes nouvelles ou changées sont écrites, et une fiche
inchangée garde ses passages et leurs vecteurs. Rien n'est republié si rien n'a changé.
