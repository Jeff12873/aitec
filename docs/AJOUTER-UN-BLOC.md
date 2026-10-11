# Ajouter un bloc (un écran)

1. Créer le dossier `blocs/mon-bloc/` avec :
   - `serveur.js` (facultatif) qui exporte `routes(r)` :
     ```js
     export function routes(r) {
       r.get('/api/mon-bloc', (ctx) => ({ bonjour: 'monde' }))
     }
     ```
     Il est chargé automatiquement au démarrage.
   - `vue.js` qui exporte l'écran :
     ```js
     import { h, vider } from '/socle/ui.js'
     import { api } from '/socle/api.js'
     export default {
       chemin: 'mon-bloc', titre: 'Mon bloc', icone: 'boite', menu: true, aide: 'premiers-pas',
       async afficher(zone, { id, query }) {
         const donnees = await api('/api/mon-bloc')
         vider(zone, h('h1', {}, donnees.bonjour))
       },
     }
     ```
   - `README.md` : à quoi il sert, ses fichiers.
2. L'ajouter dans la liste `BLOCS` de `interface/app.js` (l'ordre est celui du menu).
3. Relancer IASSITEC.

- `menu: 'admin'` : visible seulement en mode administrateur ; `menu: false` : absent du menu.
- Toute écriture dans la base se termine par `noterModification()` (voir `serveur/socle/partage.js`),
  et commence par `ctx.exigerAdmin()`.
- Icônes disponibles : `interface/socle/icones.js`.
