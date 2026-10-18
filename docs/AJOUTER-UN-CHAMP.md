# Ajouter un champ (exemple : la criticité d'une machine)

1. **Structure** (`lib/base.js`) : ajouter la colonne dans `STRUCTURE`, augmenter `FORMAT`,
   et ajouter la migration dans `migrer()` :
   ```js
   if (format < 2) base.exec("ALTER TABLE machines ADD COLUMN criticite TEXT NOT NULL DEFAULT ''")
   ```
2. **Serveur** (`blocs/parc/serveur.js`) : ajouter `{ nom: 'criticite', type: 'texte' }` dans les champs,
   et une ligne dans `indexerMachine` si l'IA doit la connaître.
3. **Formulaire** (`blocs/parc/vue.js`) : ajouter le champ dans `modifierMachine`, et l'afficher dans la fiche.
4. **Import** (`blocs/import-gmao/serveur.js`) : ajouter le champ et ses synonymes dans `CIBLES.machines`.
