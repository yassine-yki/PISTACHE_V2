# Suivi des chambres R+2

L'application locale s'ouvre avec `Lancer le suivi.cmd`. Les fichiers de `dist/` sont directement servis par `local_server.py`; aucune connexion Internet n'est nécessaire pour l'utiliser. Au démarrage, l'utilisateur choisit un projet existant. L'application charge ensuite uniquement les données et le plan configurés pour ce projet.

## Données

- Les avancements restent enregistrés dans le navigateur de ce PC et sont isolés par projet.
- Au premier chargement de cette version, les avancements de l'ancien stockage `suivi-hotel-r2-v1` sont copiés dans le projet versionné `suivi-hotel-project-v1`. L'ancien stockage n'est pas supprimé.
- Le projet est organisé par étage. Seul R+2 est utilisable dans l'interface pour le moment.
- Le référentiel R+2 provient de `Mixed Use Avancement VERSION 1.xlsx` : 40 chambres réparties entre les blocs A, B et C, avec 35 tâches SDB, 33 tâches chambre et 2 tâches loggia. Les colonnes Excel sources sont conservées dans le catalogue des tâches pour préparer un futur import contrôlé.
- Chaque projet possède sa propre clé de stockage locale. Les avancements d'un projet ne peuvent donc pas être lus ou écrasés par un autre projet.
- Le projet `Mixed Use` est enregistré dans `src/project-catalog.ts`. Son plan `a2.dxf` est inclus dans `public/projects/mixed-use/r2/` et dans chaque build de production ; aucun ajout manuel n'est nécessaire.
- Les tâches sont présentées par grande partie et sous-tâche. Une recherche filtre les sous-tâches dans la fiche de la chambre.

## Développement

`src/model.ts` définit les chambres, blocs, zones visuelles, tâches, modifications et photos. `src/storage.ts` gère les migrations et sauvegardes. `src/dxf-identification.ts` extrait les numéros du plan. `src/repositories/` isole le stockage de l'interface afin de pouvoir remplacer le stockage local par Supabase. L'interface et le rendu DXF sont encore dans `src/app.js`; leur migration vers TypeScript peut se faire progressivement.

La cible technique et les étapes de synchronisation sont décrites dans `docs/architecture-technique.md`. Le schéma initial de la future base partagée se trouve dans `supabase/migrations/0001_initial_schema.sql`. Cette migration ne contient volontairement aucune chambre, aucun bloc et aucune tâche métier avant validation des listes définitives.

Avec Node.js et pnpm :

```powershell
pnpm install
pnpm dev
pnpm run build
pnpm run check
pnpm test
```

`pnpm dev` lance Vite sur `http://127.0.0.1:4173`. `pnpm run build` vérifie TypeScript puis produit l'application dans `dist/`. Les sources utilisent des imports ES standards et aucune API spécifique à Vite. Le test d'intégration utilise `Documents/a2.dxf` sur ce PC ; ailleurs, définir `R2_DXF` vers le fichier ou le test sera ignoré.
