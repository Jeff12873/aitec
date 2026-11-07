# Bloc « parc »

Les machines, côté serveur seulement. Elles viennent de la GMAO (synchronisation) : pas d'écran pour les lister
ni les modifier. Une machine (source citée par l'IA, lien d'un écran) s'ouvre sur son analyse.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Table `machines`, routes `/api/machines`, texte de la fiche donné à l'IA (`indexerMachine`) |

Les champs sont décrits une seule fois dans `serveur.js` (`creerTable`). Pour ajouter un champ : voir
`docs/AJOUTER-UN-CHAMP.md`.
