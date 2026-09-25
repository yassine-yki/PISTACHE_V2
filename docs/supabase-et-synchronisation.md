# Accès, affectations et synchronisation Supabase

## Ce qui a été repris

L'interface de connexion, le profil, l'espace administrateur, la liste des intervenants, les cartes des chambres et l'activité proviennent du travail de la livraison `d956c6d`. Ils sont adaptés à Supabase.

**Une tâche d'une chambre possède au maximum un intervenant actif.** Deux personnes peuvent travailler dans le même bloc, mais elles ne peuvent pas modifier la même tâche. Le bloc est un regroupement de chambres ; il ne constitue pas une autorisation d'écriture.

Le service SQLite, les comptes Python, le code administrateur partagé et les permissions d'écriture par bloc de cette livraison ne sont pas utilisés.

## Deux modes de fonctionnement

- **Sans configuration Supabase** : la version locale existante reste disponible, avec ses données dans le navigateur et un indicateur « Version locale ». Ce mode personnel ne propose pas de comptes partagés.
- **Avec configuration Supabase** : connexion par e-mail et mot de passe, projets autorisés, droits contrôlés par la base et saisies conservées localement en attente de synchronisation.

Les anciennes saisies du navigateur ne sont ni supprimées ni envoyées automatiquement à Supabase. Un nouveau projet partagé commence à 0 %. Leur import doit être préparé et validé séparément.

## Première configuration

1. Créer un projet Supabase.
2. Pour une **base neuve**, exécuter les migrations dans cet ordre :
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_create_mixed_use.sql`
3. Copier `.env.example` vers `.env.local` et renseigner :
   - `VITE_SUPABASE_URL` : URL du projet ;
   - `VITE_SUPABASE_PUBLISHABLE_KEY` : clé publique publishable du projet.
4. Ne jamais mettre de clé secrète ou `service_role` dans ces variables : elles sont destinées au navigateur.
5. Configurer dans Supabase Auth l'URL du site et les URL de redirection autorisées pour les liens de confirmation d'e-mail.
6. Exécuter `pnpm install`, puis `pnpm run build`. Ouvrir l'application avec **Lancer le suivi.cmd**.
7. Créer un compte et confirmer l'e-mail si Supabase le demande.
8. Cliquer sur **Créer un projet Mixed Use**. La création est transactionnelle : 40 chambres, 70 types de tâches, 2 800 tâches distinctes. Le créateur devient administrateur de ce nouveau projet.

Si une ancienne migration a déjà été appliquée à une base, ne pas rejouer `0001` et ne pas supprimer cette base. Il faut préparer une migration de mise à niveau adaptée aux données existantes.

Aucun projet Supabase distant n'a été créé ou configuré pendant cette intégration.

## Ajouter des collègues

1. Chaque collègue crée son compte et confirme son e-mail.
2. Il transmet l'identifiant affiché à l'écran de choix du projet ou dans **Mon profil**.
3. L'administrateur ouvre **Équipe & tâches**, saisit cet identifiant, choisit le rôle et active l'accès.
4. Dans **Affecter une tâche**, l'administrateur choisit une chambre, une tâche et un intervenant.

Une nouvelle affectation remplace l'ancienne et conserve son historique. Le rôle `viewer` permet uniquement la consultation. Les corrections administratives exigent un motif et une explication ; il n'existe pas de code partagé pour obtenir des droits administrateur.

## Sans Internet

Ouvrir d'abord le projet avec une connexion. Les données et affectations nécessaires sont alors mises en cache pour ce compte.

Une saisie autorisée est enregistrée dans IndexedDB avant d'être annoncée comme conservée sur l'appareil. L'écran affiche le nombre de modifications en attente. La synchronisation est relancée au retour de la connexion, à l'actualisation, au retour dans l'onglet et périodiquement tant que l'application est visible.

Le serveur revérifie l'identité, l'affectation, les droits et la version. Les relances réutilisent le même identifiant d'opération pour éviter les doublons, même si la connexion a été coupée après l'enregistrement serveur.

Une modification refusée reste visible dans **Synchronisation**. L'utilisateur peut conserver la valeur du serveur ; la proposition refusée reste archivée localement. Une nouvelle proposition nécessite une nouvelle saisie autorisée. Les opérations dépendant d'une saisie refusée sont bloquées elles aussi.

Les opérations en attente sont conservées après une déconnexion du compte et ne sont envoyées que depuis leur compte d'origine. Effacer les données du navigateur peut les supprimer. Les actions administratives nécessitent Internet.

La version compilée met en cache les fichiers de l'application avec un service worker. Laisser la première ouverture se terminer avant de compter sur une réouverture sans réseau. Le mode de développement nécessite son serveur Vite et ne propose pas ce cache des fichiers.

## Vérifications et limites

- `pnpm run check` : vérification TypeScript.
- `pnpm test` : modèle existant, persistance locale, droits par tâche et file hors connexion.
- `pnpm run test:database` : migrations, RLS, affectations exclusives, conflits et opérations transactionnelles dans PostgreSQL embarqué (PGlite).
- `pnpm run build` : version quotidienne et cache hors connexion.

Les scénarios navigateur utilisent des réponses Supabase simulées. Une validation de bout en bout sur le vrai projet Supabase reste nécessaire après configuration, notamment pour les e-mails, les sessions et les politiques d'accès.

Le rafraîchissement des données est périodique ; Realtime n'est pas encore branché. L'envoi de photos et la configuration de leur stockage privé restent à intégrer. L'interface est actuellement prévue pour le catalogue R+2 existant.

Le schéma complet est décrit dans [le schéma de base de données](schema-base-de-donnees-fr.md).
