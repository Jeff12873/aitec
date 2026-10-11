# Bloc « parc »

La liste des machines et leur fiche (informations, documents, pièces, interventions).

| Fichier | Rôle |
|---|---|
| `serveur.js` | Table `machines`, routes `/api/machines`, texte de la fiche donné à l'IA (`indexerMachine`) |
| `vue.js` | Liste, fiche, formulaire |

Les champs sont décrits une seule fois dans `serveur.js` (`creerTable`) ; le formulaire est dans `vue.js`
(`modifierMachine`). Pour ajouter un champ : voir `docs/AJOUTER-UN-CHAMP.md`.
