# Schéma de base de données — PISTACHE V2

> **Statut : schéma Supabase implémenté et testé localement, non déployé.** La migration initiale prépare une base neuve avec une affectation exclusive par tâche. L'interface et la file hors connexion sont adaptées à ce schéma ; leur activation nécessite la configuration du projet Supabase. Voir [la configuration](supabase-et-synchronisation.md).

Voici le **schéma de référence en français**. Les noms techniques correspondent à la migration SQL. Les fonctions de synchronisation sont définies côté base et utilisées par le repository de l'application en mode Supabase.

Le principe central : **chaque chambre possède ses propres tâches, créées à partir d’un catalogue commun au projet.**

```mermaid
erDiagram
    profiles ||--o{ project_members : "rejoint"
    projects ||--o{ project_members : "comprend"
    projects ||--o{ floors : "contient"
    floors ||--o{ blocks : "contient"
    floors ||--o{ rooms : "contient"
    blocks o|--o{ rooms : "regroupe"
    projects ||--o{ task_types : "définit"
    rooms ||--o{ room_tasks : "possède"
    task_types ||--o{ room_tasks : "définit"
    room_tasks ||--o{ task_assignments : "historique des affectations"
    project_members ||--o{ task_assignments : "reçoit"
    room_tasks ||--o{ sync_operations : "reçoit"
    room_tasks ||--o{ progress_updates : "historique des modifications"
    progress_updates ||--o{ progress_photos : "justificatifs"
    rooms ||--o{ plan_areas : "zones sur le plan"
```

## Conventions

- `uuid` : identifiant unique.
- `FK` : référence à une autre table.
- `?` : champ facultatif.
- `timestamptz` : date et heure avec fuseau horaire.
- `jsonb` : données structurées.

Sauf indication contraire, chaque table possède les champs suivants. `project_members` fait exception : sa clé est composée et `joined_at` remplace `created_at`.

```text
id          uuid PRIMARY KEY
created_at  timestamptz DEFAULT now()
```

Toutes les tables rattachées à un projet possèdent également :

```text
project_id  uuid FK → projects
```

## 1. `profiles` — Utilisateurs

Contient les informations affichées dans l’application. Supabase Auth gère les identifiants de connexion, les mots de passe et les sessions.

| Champ | Type | Signification |
|---|---|---|
| `id` | uuid, PK → auth.users | Identifiant du compte |
| `display_name` | text | Nom affiché |
| `created_at` | timestamptz | Date de création |
| `updated_at` | timestamptz | Dernière modification |

Le rôle n’est pas enregistré ici : une personne peut être administratrice d’un projet et intervenante dans un autre.

## 2. `projects` — Projets

Exemple : **Mixed Use**.

| Champ | Type | Signification |
|---|---|---|
| `id` | uuid, PK | Identifiant du projet |
| `name` | text | Nom du projet |
| `description` | text | Description |
| `created_by` | uuid, FK → profiles | Créateur |
| `created_at` | timestamptz | Date de création |
| `updated_at` | timestamptz | Dernière modification |
| `archived_at` | timestamptz? | Date d’archivage |

Un projet archivé conserve ses données et son historique.

## 3. `project_members` — Membres et droits d’accès

Détermine qui appartient à un projet et ce que cette personne peut faire.

| Champ | Type | Signification |
|---|---|---|
| `project_id` | uuid, FK → projects | Projet concerné |
| `user_id` | uuid, FK → profiles | Utilisateur |
| `role` | text | `admin`, `worker` ou `viewer` |
| `status` | text | `active` ou `inactive` |
| `joined_at` | timestamptz | Date d’ajout au projet |
| `updated_at` | timestamptz | Dernière modification |

**Clé primaire :** `(project_id, user_id)`.

| Rôle | Droits |
|---|---|
| `admin` — Administrateur | Gérer le projet, les membres, le catalogue et les affectations |
| `worker` — Intervenant | Consulter le projet et modifier ses tâches affectées |
| `viewer` — Lecteur | Consulter uniquement |

Un administrateur peut également recevoir des tâches. Désactiver un membre retire ses accès sans supprimer son historique. La désactivation ou le passage au rôle `viewer` clôture ses affectations actives et augmente les versions des tâches concernées. Le dernier administrateur actif ne peut pas être désactivé ou rétrogradé.

## 4. `floors` — Étages

Champs supplémentaires aux champs communs :

| Champ | Type | Signification |
|---|---|---|
| `code` | text | Code stable, par exemple `r2` |
| `label` | text | Libellé affiché, par exemple `R+2` |
| `sort_order` | integer | Ordre d’affichage |
| `plan_storage_path` | text? | Emplacement du fichier du plan |
| `updated_at` | timestamptz | Dernière modification |
| `archived_at` | timestamptz? | Date d’archivage |

**Unicité :** `(project_id, code)`.

## 5. `blocks` — Blocs

Exemples : blocs **A**, **B** et **C** du R+2.

| Champ | Type | Signification |
|---|---|---|
| `floor_id` | uuid, FK → floors | Étage |
| `code` | text | Code du bloc |
| `label` | text | Nom affiché |
| `sort_order` | integer | Ordre d’affichage |
| `updated_at` | timestamptz | Dernière modification |
| `archived_at` | timestamptz? | Date d’archivage |

**Unicité :** `(floor_id, code)`.

## 6. `rooms` — Chambres

Chaque ligne représente une chambre indépendante.

| Champ | Type | Signification |
|---|---|---|
| `floor_id` | uuid, FK → floors | Étage de la chambre |
| `block_id` | uuid?, FK → blocks | Bloc, si applicable |
| `number` | text | Numéro : `201`, `202`, éventuellement `201A` |
| `room_type` | text? | Type : standard, junior, executive… |
| `sort_order` | integer | Ordre d’affichage |
| `updated_at` | timestamptz | Dernière modification |
| `archived_at` | timestamptz? | Date d’archivage |

**Unicité :** `(floor_id, number)`.

Le bloc sélectionné doit appartenir au même étage que la chambre.

## 7. `task_types` — Catalogue commun des types de tâches

Définit les travaux que l’on retrouve dans toutes les chambres du projet.

| Champ | Type | Signification |
|---|---|---|
| `code` | text | Identifiant métier, par exemple `paint` |
| `label` | text | Intitulé : « Peinture 1ère couche » |
| `zone` | text | `bedroom`, `bathroom` ou `loggia` |
| `group_label` | text | Groupe : peinture, plomberie, électricité… |
| `description` | text | Description du travail |
| `source_column` | text? | Colonne Excel d’origine |
| `sort_order` | integer | Ordre d’affichage |
| `updated_at` | timestamptz | Dernière modification |
| `archived_at` | timestamptz? | Date d’archivage |

**Unicité :** `(project_id, zone, code)`.

Les zones correspondent à la **chambre**, la **salle de bain** et la **loggia**.

Cette table ne contient ni avancement ni personne affectée.

## 8. `room_tasks` — Tâches propres à chaque chambre

C’est la table centrale. Exemple : **peinture de la chambre 201, réalisée à 60 %**.

| Champ | Type | Signification |
|---|---|---|
| `room_id` | uuid, FK → rooms | Chambre concernée |
| `task_type_id` | uuid, FK → task_types | Type de travail |
| `progress` | smallint | Avancement entre 0 et 100, initialement 0 |
| `blocked` | boolean | Tâche bloquée ou non |
| `note` | text | Observation actuelle |
| `start_date` | date? | Date de début |
| `end_date` | date? | Date de fin |
| `version` | bigint | Numéro de version, initialement 1 |
| `updated_at` | timestamptz | Dernière modification |
| `updated_by` | uuid?, FK → profiles | Auteur de la dernière modification |
| `archived_at` | timestamptz? | Date d’archivage |

**Unicité :** `(room_id, task_type_id)`.

Une chambre ne peut donc pas avoir deux exemplaires du même type de tâche.

Avec les données actuelles : **40 chambres × 70 types de tâches = 2 800 tâches individuelles**.

La création d’une chambre génère ses tâches. L’ajout d’un type de tâche au catalogue génère une tâche correspondante pour chaque chambre active.

## 9. `task_assignments` — Affectations des tâches

Conserve les affectations actuelles et passées.

| Champ | Type | Signification |
|---|---|---|
| `room_task_id` | uuid, FK → room_tasks | Tâche précise à réaliser |
| `assignee_id` | uuid, FK → profiles | Personne affectée |
| `assigned_by` | uuid, FK → profiles | Administrateur ayant effectué l’affectation |
| `ended_at` | timestamptz? | Fin de l’affectation |
| `ended_by` | uuid?, FK → profiles | Personne ayant clôturé l’affectation |
| `reason` | text | Motif de l’affectation ou du changement |

`created_at` correspond au début de l’affectation.

**Règle obligatoire : une seule affectation active par tâche.** Une affectation est active lorsque `ended_at` est vide.

Lors d’une réaffectation, le serveur clôture l’ancienne affectation, crée la nouvelle et augmente la version de la tâche dans une seule transaction.

## 10. `sync_operations` — Suivi des changements envoyés au serveur

Permet de synchroniser les modifications hors connexion sans les appliquer deux fois.

Ici, **l’identifiant `id` est généré sur l’appareil avant l’envoi**.

| Champ | Type | Signification |
|---|---|---|
| `room_task_id` | uuid, FK → room_tasks | Tâche modifiée |
| `assignment_id` | uuid?, FK → task_assignments | Affectation utilisée lors de la saisie ; facultative pour une correction administrative |
| `submitted_by` | uuid, FK → profiles | Auteur |
| `device_id` | uuid | Identifiant de l’appareil |
| `base_version` | bigint | Version connue au début de la modification |
| `depends_on_operation_id` | uuid?, FK → sync_operations | Modification précédente à traiter d’abord |
| `payload` | jsonb | Contenu de la modification |
| `client_created_at` | timestamptz | Date de saisie sur l’appareil |
| `status` | text | `accepted`, `conflict` ou `rejected` |
| `result_version` | bigint? | Version obtenue après acceptation |
| `error_code` | text? | Motif du conflit ou du refus |
| `processed_at` | timestamptz | Date de traitement par le serveur |

Renvoyer la même opération retourne son résultat précédent. Le serveur refuse la réutilisation du même identifiant avec un contenu différent.

Le serveur détermine lui-même l’auteur authentifié, le résultat et la nouvelle version.

## 11. `progress_updates` — Historique des modifications acceptées

Permet de savoir **qui a changé quoi, et quand**.

| Champ | Type | Signification |
|---|---|---|
| `room_task_id` | uuid, FK → room_tasks | Tâche concernée |
| `operation_id` | uuid?, unique, FK → sync_operations | Opération à l’origine du changement |
| `assignment_id` | uuid?, FK → task_assignments | Affectation concernée |
| `changed_by` | uuid?, FK → profiles | Auteur |
| `source` | text | `user` ou `import` |
| `previous_version` | bigint | Version précédente |
| `new_version` | bigint | Nouvelle version |
| `before_state` | jsonb | Valeurs avant modification |
| `after_state` | jsonb | Valeurs après modification |
| `correction_reason` | text? | `input-error` ou `scope-change` |
| `correction_note` | text? | Explication de la correction |

Les états avant/après comprennent l’avancement, le blocage, les observations et les dates.

**L’historique ne se réécrit pas.** Une correction ajoute une nouvelle entrée.

L’enregistrement de l’avancement, de son historique et du résultat de synchronisation se fait dans une seule transaction.

## 12. `progress_photos` — Photos justificatives

Prépare l’ajout de photos liées aux modifications d’avancement.

| Champ | Type | Signification |
|---|---|---|
| `progress_update_id` | uuid, FK → progress_updates | Modification justifiée |
| `storage_path` | text, unique | Emplacement de l’image |
| `uploaded_by` | uuid, FK → profiles | Auteur de l’envoi |
| `mime_type` | text | Format du fichier |
| `file_size` | bigint | Taille en octets |
| `captured_at` | timestamptz? | Date de prise de vue |
| `deleted_at` | timestamptz? | Date de suppression logique |

L'image est destinée à un espace privé de **Supabase Storage**. Cette table contient ses références et ses informations. **Le bucket, les politiques Storage et le parcours d'envoi ne sont pas encore configurés** : les clients ne disposent donc d'aucun droit d'écriture sur cette table. Les formats prévus sont JPEG, PNG et WebP, avec une taille strictement positive.

## 13. `plan_areas` — Zones interactives du plan

Associe les formes du plan aux chambres.

| Champ | Type | Signification |
|---|---|---|
| `room_id` | uuid, FK → rooms | Chambre représentée |
| `zone` | text | `bedroom`, `bathroom` ou `loggia` |
| `source_layer` | text? | Calque d’origine dans le plan |
| `geometry` | jsonb | Forme ou ensemble de formes |
| `updated_at` | timestamptz | Dernière modification |

**Unicité :** `(room_id, zone)`.

Le plan affiche les avancements enregistrés dans `room_tasks`.

## Stockage local pour le travail hors connexion

Ces trois espaces seront enregistrés sur chaque appareil, dans **IndexedDB**, séparément pour chaque utilisateur connecté :

| Espace local | Contenu |
|---|---|
| `cached_data` | Projets, chambres, tâches, affectations et versions téléchargées |
| `outbox` | Modifications en attente, ordre d’envoi, tentatives et conflits |
| `pending_files` | Photos en attente d’envoi, si cette fonction est activée |

Une modification hors connexion existe d’abord dans `outbox`. Elle apparaît dans `sync_operations` une fois reçue et traitée par le serveur.

## Règles communes à toutes les tables

- Les références doivent rester dans le même projet.
- Seul l’intervenant actuellement affecté peut effectuer les modifications ordinaires d’une tâche.
- Seul un administrateur actif peut corriger une tâche sans en être l'intervenant affecté. Il doit fournir un motif (`input-error` ou `scope-change`) et une explication non vide.
- Les permissions sont vérifiées par le serveur, même si la modification a été saisie hors connexion.
- Les accès aux données sont limités aux membres autorisés grâce aux règles **RLS** de Supabase.
- Les chambres et les tâches sont archivées pour conserver leur historique.
- Les versions du serveur déterminent si une modification est à jour ; l’heure de l’appareil sert uniquement d’information.

Pour l'intégration multi-utilisateur, la **gestion du projet et les affectations nécessitent une connexion**, tandis que la **saisie des avancements est prévue hors connexion**, dans la file locale IndexedDB. Cette file est implémentée dans IndexedDB pour le mode Supabase.

## Comportement implémenté dans la migration

- Les 13 tables disposent de RLS. Les membres actifs lisent les données de leurs projets, y compris les archives ; les autres utilisateurs n'y ont pas accès.
- Les clés étrangères composées imposent le même projet et, pour le bloc d'une chambre, le même étage. L'affectation et l'opération référencées par un historique appartiennent à la même tâche.
- Aucun client ne peut supprimer physiquement les données, modifier directement l'avancement ou réécrire les historiques. L'archivage conserve les références ; les clés étrangères ne suppriment rien en cascade.
- Les administrateurs modifient les informations de structure et archivent les projets, étages, blocs, chambres et types de tâches. Une tâche dont un parent est archivé ne reçoit plus d'avancement ni d'affectation.
- L'ajout ou la restauration d'une chambre ou d'un type de tâche crée les tâches manquantes sans doublon et sans réinitialiser les avancements existants.
- Les opérations de gestion et de synchronisation verrouillent le projet pendant leur transaction. Ce choix privilégie la cohérence pour le volume initial ; les écritures d'un même projet sont sérialisées.
- Les profils sont créés automatiquement à l'inscription Supabase Auth ; les comptes préexistants sont repris lors de la migration.

## Fonctions accessibles à l'application

| Fonction SQL / RPC | Usage |
|---|---|
| `create_project(p_name, p_description)` | Crée un projet et inscrit l'utilisateur connecté comme premier administrateur |
| `set_project_member(p_project_id, p_user_id, p_role, p_status)` | Ajoute ou modifie un membre existant dans Auth ; administrateur uniquement |
| `assign_task(p_task_id, p_assignee_id, p_reason)` | Clôture l'affectation précédente et crée la nouvelle ; `null` retire l'affectation ; administrateur uniquement |
| `submit_progress(...)` | Valide et enregistre atomiquement une saisie, son historique et son résultat de synchronisation |

`submit_progress` reçoit : `p_operation_id`, `p_task_id`, `p_assignment_id`, `p_device_id`, `p_base_version`, `p_client_created_at`, `p_payload` et éventuellement `p_depends_on_operation_id`.

Le payload représente **l'état complet** à enregistrer, et non une modification partielle :

```json
{
  "progress": 60,
  "blocked": false,
  "note": "Première couche en cours",
  "start_date": "2026-09-24",
  "end_date": null
}
```

Les dates sont au format `YYYY-MM-DD` ou `null`, avec une fin non antérieure au début. L'avancement est un entier de 0 à 100. Les champs supplémentaires sont refusés, sauf `correction_reason` et `correction_note` pour une correction administrative. Une baisse d'avancement ou toute modification d'une tâche déjà à 100 % exige cette correction.

### Résultats et relances hors connexion

- `accepted` : avancement, historique et résultat enregistrés dans une seule transaction ; version augmentée de 1.
- `conflict` / `version_conflict` : version locale dépassée ; aucun avancement modifié. Recharger la tâche, résoudre le conflit et créer une **nouvelle** opération.
- `rejected` : aucun avancement modifié. Exemples : `assignment_changed`, `permission_denied`, `task_archived`, `invalid_payload`, `correction_required`, `dependency_failed`.
- Le même identifiant et la même requête renvoient le résultat enregistré, sans nouvelle écriture. Une requête différente avec le même identifiant déclenche `operation_id_reused`.
- Une dépendance doit appartenir à la même tâche, au même auteur et au même appareil ; sa version résultante doit correspondre à `base_version`. Une dépendance non encore reçue déclenche `dependency_pending`, sans enregistrer de rejet : envoyer d'abord la dépendance, puis relancer la même opération.
- Une erreur d'authentification, d'accès au projet, d'enveloppe ou de référence invalide lève une erreur SQL sans enregistrer d'opération. Un utilisateur désactivé ne peut pas relire ses anciens résultats via la RPC.
- Une réaffectation augmente aussi la version, sans créer d'entrée d'avancement : son historique reste dans `task_assignments`.

## Installation et limites actuelles

La migration initiale a été révisée pour une **installation neuve**. Si l'ancienne `0001` a déjà été appliquée ailleurs, ne pas la rejouer et ne pas réinitialiser cette base : il faut préparer une migration de mise à niveau à partir de son schéma et de ses données réels.

L'application actuelle conserve `room` pour certaines géométries locales. Le futur repository Supabase doit convertir cette valeur en `bedroom` ; les autres correspondances sont `observation` → `note`, `task_id` → `task_type_id` et les anciennes dates optionnelles → `start_date` / `end_date`. Le format de stockage local n'est pas modifié par cette migration.

Restent à configurer ou intégrer : le projet Supabase distant, les e-mails de confirmation, Realtime, les photos et les politiques Storage. Le catalogue R+2 est créé par la migration 0002 et la fonction create_mixed_use_project. L'import des anciens avancements dans Supabase reste une étape à valider ; la création d'un projet partagé initialise les tâches à 0 %.

## Vérification locale

Après `pnpm install`, exécuter `pnpm run test:database`. Les tests appliquent le fichier SQL sans modification à PostgreSQL embarqué (PGlite), avec des comptes et des rôles de test et un contexte Auth simulé. Ils vérifient les contraintes, RLS, les droits des RPC, les relances, les conflits, les corrections et l'archivage. Aucune connexion à une base distante n'est nécessaire. Une validation sur Supabase reste nécessaire pour PostgREST, Storage, Realtime et la concurrence entre connexions.
