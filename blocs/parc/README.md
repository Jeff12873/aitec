# Bloc « parc »

La liste des machines. Il n'y a plus de fiche machine : une machine (source citée par l'IA, lien d'un écran) s'ouvre sur son analyse.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Table `machines`, routes `/api/machines`, texte de la fiche donné à l'IA (`indexerMachine`) |
| `vue.js` | Liste, formulaire |

Les champs sont décrits une seule fois dans `serveur.js` (`creerTable`) ; le formulaire est dans `vue.js`
(`modifierMachine`). Pour ajouter un champ : voir `docs/AJOUTER-UN-CHAMP.md`.
