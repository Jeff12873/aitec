# Les données (structure du fichier `.datassitec`)

Base SQLite. Structure complète : `STRUCTURE` dans `serveur/socle/base.js`.

| Table | Contenu |
|---|---|
| `reglages` | `format` (version de la structure), `nom_atelier`, `mot_de_passe` (empreinte scrypt), `icone` et `icone_type`, `imports` (correspondances de colonnes retenues), `cree_le`, `cree_par` |
| `machines` | `repere` (unique), `designation`, `famille`, `marque`, `modele`, `numero_serie`, `emplacement`, `mise_en_service`, `etat`, `notes` |
| `pieces`, `pieces_machines` | Pièces de rechange : fonction retirée, tables gardées vides pour la compatibilité des fichiers |
| `interventions` | `numero` (unique, facultatif), `date`, `machine_id`, `type`, `description`, `cause`, `intervenant`, `duree_h`, `statut` |
| `documents` | Le fichier lui-même (`contenu`), son nom, type, taille, empreinte SHA-256, machine, état de lecture |
| `passages` | Les morceaux de texte que l'IA peut retrouver, avec leur source, leur page et leur vecteur |
| `passages_mots` | Index de recherche par mots (FTS5), tenu à jour automatiquement |

Les dates sont écrites `AAAA-MM-JJ`.

## Faire évoluer la structure

1. Modifier `STRUCTURE` (pour les nouveaux fichiers).
2. Augmenter `FORMAT` et ajouter la migration dans `migrer()` (pour les fichiers existants), par exemple
   `if (format < 2) base.exec("ALTER TABLE machines ADD COLUMN criticite TEXT NOT NULL DEFAULT ''")`.

Un fichier créé par une version plus récente d'IASSITEC est refusé par une version plus ancienne.
