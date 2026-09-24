# Architecture technique

## Objectif

L'application doit rester utilisable sur ordinateur et téléphone. Le plan est une vue principale sur les deux formats : il sert à visualiser l'étage, zoomer, déplacer la vue et sélectionner une chambre. La fiche de suivi et le sélecteur de chambre doivent toujours refléter la même sélection.

## Découpage retenu

- `src/model.ts` contient les types métier indépendants de l'interface et du stockage.
- `src/dxf-identification.ts` extrait les chambres et les zones du DXF.
- `src/repositories/` fournit le contrat de stockage utilisé par l'interface.
- `LocalProjectRepository` conserve le fonctionnement actuel hors connexion dans `localStorage`.
- un futur `SupabaseProjectRepository` implémentera le même contrat pour le partage multi-utilisateur.
- `src/app.js` orchestre encore l'interface et le rendu SVG. Sa migration vers TypeScript peut être progressive, module par module.

L'interface ne doit jamais appeler directement Supabase. Elle passe par le repository, ce qui permet de tester localement et de changer de stockage sans réécrire le plan ou les écrans.

Le démarrage passe par un catalogue de projets existants. Chaque entrée définit son identifiant, son libellé, son étage et le chemin de son DXF préchargé. Le repository utilise l'identifiant du projet pour isoler les avancements. Aucun fichier n'est demandé à l'utilisateur pendant l'ouverture normale du projet.

## Plan et données

Le fichier DXF reste un document de plan. Les données de suivi ne sont pas écrites dans le DXF : chambres, tâches, avancements, observations et photos sont enregistrés dans la base.

Chaque étage possède une référence vers son plan. Chaque zone géométrique peut être associée à une chambre et à un type de zone (`room`, `bathroom` ou `loggia`). Le premier référentiel validé couvre le R+2 : blocs A, B et C, 40 chambres et 70 tâches issues du classeur de suivi. Les références de colonnes Excel sont conservées avec les tâches pour permettre une future synchronisation contrôlée.

## Synchronisation prévue

1. Au démarrage, le repository charge le projet et les avancements.
2. Une modification est enregistrée comme une mise à jour d'avancement, sans effacer l'historique.
3. Les photos sont rattachées à une mise à jour précise.
4. Les autres appareils reçoivent ensuite les changements via Supabase Realtime ou un rafraîchissement ciblé.
5. Une stratégie de conflit basée sur `updated_at` et `version` empêche qu'une ancienne fiche écrase silencieusement une modification récente.

## Étapes suivantes

1. Valider la règle d'import des avancements Excel existants.
2. Créer le projet Supabase, appliquer la migration et définir les rôles utilisateurs.
3. Ajouter l'authentification et les règles d'accès par projet.
4. Implémenter `SupabaseProjectRepository`, la synchronisation et le stockage des photos.
5. Installer l'application comme PWA et tester sur les téléphones du chantier.
