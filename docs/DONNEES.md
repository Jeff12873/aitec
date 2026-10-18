# Les données (tables d'AITEC dans le fichier `.ktec`)

Le fichier de connaissances `.ktec` de KTEC est une base SQLite ; AITEC y range ses propres tables (à côté de celles des autres applications). Structure complète : `STRUCTURE` dans `lib/base.js`.

| Table | Contenu |
|---|---|
| `reglages` | Réglages d'AITEC : `format` (version de la structure, 2 actuellement), `nom_atelier`, `glossaire` (repères des schémas), `imports` (correspondances de colonnes retenues), `requetes_mysql` et `synchronisation` (synchronisation avec la GMAO). Le mot de passe administrateur est celui du fichier `.ktec` (KTEC). |
| `machines` | `repere` (unique), `designation`, `famille`, `marque`, `modele`, `numero_serie`, `emplacement`, `mise_en_service`, `etat`, `notes` |
| `pieces`, `pieces_machines` | Pièces de rechange : fonction retirée, tables gardées vides pour la compatibilité des fichiers |
| `interventions` | `numero` (unique, facultatif), `date`, `machine_id`, `type`, `description`, `cause`, `intervenant`, `duree_h`, `statut` |
| `documents` | Le fichier lui-même (`contenu`), son nom, type, taille, empreinte SHA-256, machine, état de lecture, `genre` (document, schema, plan) |
| `images_pages` | Images des pages de PDF dessinées par le navigateur : folios de schémas et pages de plans (page entière + deux moitiés), pages illustrées en attente ; `lu` = déjà analysée |
| `passages` | Les morceaux de texte que l'IA peut retrouver, avec leur source, leur page et leur vecteur |
| `passages_mots` | Index de recherche par mots (FTS5), tenu à jour automatiquement |

Les dates sont écrites `AAAA-MM-JJ`.

## Faire évoluer la structure

1. Modifier `STRUCTURE` (pour les nouveaux fichiers).
2. Augmenter `FORMAT` et ajouter la migration dans `migrer()` (pour les fichiers existants), par exemple
   `if (format < 2) base.exec("ALTER TABLE machines ADD COLUMN criticite TEXT NOT NULL DEFAULT ''")`.

Un fichier dont les tables d'AITEC viennent d'une version plus récente d'AITEC est refusé par une version plus ancienne.
