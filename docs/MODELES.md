# Les modèles d'IA

La liste est dans `outils/catalogue.json`. La préparation (`outils/preparer.js`) propose le plus grand modèle
que le poste peut faire tourner :

| Code | Modèle | Taille | Conseillé pour |
|---|---|---|---|
| `mini` | Qwen3.5 2B | ~2 Go | moins de 8 Go de mémoire |
| `petit` | Qwen3.5 4B | ~3,4 Go | 8 à 16 Go, sans carte graphique |
| `moyen` | Qwen3.5 9B | ~6,6 Go | 16 Go et plus, ou carte graphique de 8 Go |
| `grand` | Qwen3.5 35B-A3B | ~23 Go | 48 Go et plus, ou carte graphique de 24 Go |

Tous lisent les images (fichier « vision »), sont multilingues et sous licence Apache 2.0.
Le modèle de recherche (Qwen3-Embedding 0.6B, ~0,6 Go) est le même sur tous les postes : les vecteurs
enregistrés dans le fichier partagé doivent être calculés par le même modèle partout.

## Choisir un autre modèle

- Sur un poste : relancer la préparation et choisir dans la liste (ou `--modele grand`).
- Ajouter un modèle à la liste : une entrée de plus dans `catalogue.json` (dépôt Hugging Face, nom du
  fichier GGUF, fichier « vision » s'il y en a un, mémoire minimale). Le modèle doit être pris en charge
  par llama.cpp.
- Changer le **modèle de recherche** impose de tout recalculer : Administration › Recherche par le sens ›
  Tout recalculer (et de préparer à nouveau tous les postes).

## Version de llama.cpp

`llama` dans `catalogue.json` : le numéro de la version publiée sur
https://github.com/ggml-org/llama.cpp/releases. La préparation prend la version « Vulkan » (cartes NVIDIA,
AMD et Intel, sous Windows et Linux) et se replie sur la version « processeur » si le poste ne la supporte pas.
