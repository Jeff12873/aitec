# Bloc « pièces »

Les pièces de rechange : stock, seuil de commande, fabricant, fournisseur, machines concernées.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Table `pieces` et `pieces_machines`, routes `/api/pieces`, texte donné à l'IA (`indexerPiece`) |
| `vue.js` | Liste (filtre « à commander »), fiche, formulaire |

Une pièce est « à commander » quand son seuil est supérieur à 0 et que le stock l'a atteint.
