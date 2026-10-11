# Bloc « fichier »

L'accueil (premier lancement), le choix et la création du fichier `.datassitec`, l'état général
et le passage en mode administrateur.

| Fichier | Rôle |
|---|---|
| `serveur.js` | `/api/etat`, `/api/explorer` (parcourir les dossiers), ouverture, création, `/api/session` |
| `vue.js` | Écran d'accueil, explorateur de dossiers, fenêtre du mode administrateur |

La mécanique du fichier partagé (copie locale, verrou, publication, sauvegardes) est dans
`serveur/socle/partage.js` ; elle est expliquée dans `docs/FICHIER-PARTAGE.md`.
