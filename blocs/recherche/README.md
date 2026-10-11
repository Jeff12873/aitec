# Bloc « recherche »

Retrouve les passages (morceaux de documents et fiches) qui répondent à une question.
Utilisé par l'assistant et par la barre de recherche.

| Fichier | Rôle |
|---|---|
| `passages.js` | Découpe les textes en passages et les range dans la table `passages` |
| `indexeur.js` | Calcule en arrière-plan les vecteurs des nouveaux passages (mode administrateur) |
| `recherche.js` | La recherche : mots-clés + sens, fusionnés |
| `serveur.js` | Routes `/api/recherche` et `/api/indexation` |

## Réglages faciles à changer

- Taille des passages : `TAILLE` et `CHEVAUCHEMENT` dans `passages.js` (en caractères).
  Après un changement, il faut relire les documents (Documents › Relire) pour que ça s'applique.
- Mots ignorés par la recherche par mots-clés : `MOTS_VIDES` dans `recherche.js`.
- Seuil de ressemblance minimal pour la recherche par le sens : `0.25` dans `chercherParSens`.

## Comment ça marche

1. **Mots-clés** : la table virtuelle `passages_mots` (SQLite FTS5) indexe chaque mot, sans les accents.
   Chaque mot de la question est cherché comme début de mot (`"pompe"*`).
2. **Sens** : chaque passage a un vecteur de 512 nombres calculé par le petit modèle de recherche.
   La question reçoit aussi un vecteur ; on garde les passages dont le vecteur est le plus proche
   (produit scalaire, les vecteurs étant normalisés).
3. **Fusion** : chaque passage reçoit `1 / (60 + rang)` pour chaque liste où il apparaît ; on garde les meilleurs.

Filtrer sur une machine garde ses documents, sa fiche et ses interventions.
