# Bloc « administration »

Les trois onglets : Documents (bloc `documents`), Données de la GMAO (bloc `import-gmao` : synchronisation
avec la base MySQL ou import d'un export) et Réglages.

| Fichier | Rôle |
|---|---|
| `serveur.js` | Nom de l'atelier, glossaire des repères, index de recherche, modèle d'IA, reprise d'un fichier IASSITEC (`.datassitec`) |
| `vue.js` | L'écran |

Le fichier de connaissances lui-même (ouverture, mot de passe administrateur, sauvegardes), les réglages du
poste et l'arrêt sont dans les Réglages de KTEC (portail) ; les mises à jour, dans l'installateur KTEC.

## Reprise d'un fichier IASSITEC

`POST /api/admin/importer-datassitec` copie les tables `machines`, `pieces`, `pieces_machines`, `interventions`,
`documents`, `images_pages`, `passages` (avec leurs vecteurs) et les réglages d'un `.datassitec` dans le `.ktec`
(le mot de passe et l'icône ne sont pas repris). Le fichier d'origine n'est pas modifié.
