# Version hors ligne

Pour les postes **sans connexion à Internet**. La version en ligne (`IASSITEC.zip` sur GitHub, qui télécharge
Node, llama.cpp et le modèle pendant la préparation) reste la version normale ; la version hors ligne est un
**kit** qui contient déjà tout.

## Fabriquer le kit (sur un PC connecté à Internet)

```sh
node outils/fabriquer-kit-hors-ligne.js                      # Windows, modèles petit + moyen (~11 Go)
node outils/fabriquer-kit-hors-ligne.js --modeles moyen,grand # avec le modèle lourd (~31 Go)
node outils/fabriquer-kit-hors-ligne.js --systeme linux       # kit pour des postes Linux
```

Le kit est créé à côté du dossier IASSITEC (`IASSITEC-hors-ligne-windows`). Les modèles déjà téléchargés sur
le PC sont repris ; tout est vérifié (taille et empreinte). Relancer la commande complète un kit interrompu.

Le kit est trop gros pour les Releases GitHub (2 Go par fichier au plus) : il se copie sur une clé USB
(formatée en exFAT ou NTFS : un modèle dépasse 4 Go) ou sur un partage réseau.

## Contenu

```
IASSITEC-hors-ligne-windows/
├── Preparer IASSITEC.bat, Lancer IASSITEC.bat, serveur/, blocs/, interface/…   ← le programme, comme le zip
├── LISEZ-MOI (hors ligne).txt
└── hors-ligne/
    ├── kit.json          ← système, version, modèles inclus
    ├── node/             ← Node pour Windows
    ├── llama-vulkan/     ← llama.cpp, carte graphique
    ├── llama-cpu/        ← llama.cpp, processeur seul
    └── modeles/          ← fichiers GGUF des modèles inclus + modèle de recherche
```

## Installer un poste

Lancer `Preparer IASSITEC.bat` depuis le kit. La préparation voit le dossier `hors-ligne/` et **copie** au lieu
de télécharger ; elle ne propose que les modèles présents dans le kit. Le reste (installation dans le profil,
analyse du poste, essai, raccourcis) est identique à la version en ligne.

## Limites

- Pas de mise à jour automatique (le bouton de l'écran Administration demande Internet) : fabriquer un nouveau
  kit et relancer la préparation ; le fichier de l'atelier et les réglages sont gardés.
- Le changement de modèle depuis Administration › Réglages télécharge le modèle : sur un poste hors ligne,
  relancer plutôt la préparation depuis un kit qui contient le modèle voulu.
