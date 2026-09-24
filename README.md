# PISTACHE V2 — Suivi des chambres

Application Windows pour suivre l’avancement des travaux des **40 chambres du R+2** du projet **Mixed Use**. Le plan est inclus et se charge automatiquement.

## Ouvrir l’application

1. Ouvrez le dossier du projet.
2. Double-cliquez sur **Lancer le suivi.cmd**.
3. Dans le navigateur, choisissez **Mixed Use**.
4. Sélectionnez une chambre pour consulter et mettre à jour son avancement.

L’application fonctionne sans Internet. Pour cette utilisation, vous n’avez pas besoin d’installer Python, Node.js ou pnpm.

Elle s’ouvre dans Brave s’il est installé à son emplacement habituel, sinon dans votre navigateur par défaut. Son adresse est [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Fermer et rouvrir

- **Fermer la page** : fermez l’onglet du navigateur. Le service qui permet d’ouvrir l’application continue de fonctionner en arrière-plan.
- **Rouvrir l’application** : double-cliquez à nouveau sur **Lancer le suivi.cmd**. Le service déjà ouvert est réutilisé.
- **Arrêter complètement l’application** : double-cliquez sur **Arreter le suivi.cmd**, puis fermez son onglet.

L’ancien raccourci **Ouvrir dans Brave.cmd** lance désormais la même procédure que **Lancer le suivi.cmd**.

## Où sont enregistrés les avancements ?

Les modifications sont enregistrées automatiquement **dans le navigateur de ce PC**, séparément pour chaque projet.

Utilisez toujours le même navigateur et le même profil pour retrouver vos données. Changer de navigateur, utiliser une fenêtre privée ou effacer les données du site peut vous empêcher de retrouver vos avancements.

**Copier le dossier de l’application ou l’envoyer sur GitHub ne sauvegarde pas les avancements saisis.** Ils ne sont pas synchronisés entre plusieurs ordinateurs. La version actuelle ne propose pas de boutons d’export ou de restauration dans l’interface.

## Si l’application ne s’ouvre pas

| Message ou problème | Que faire ? |
| --- | --- |
| Le port 4173 est déjà utilisé | Fermez l’autre serveur ou une ancienne fenêtre de lancement, puis réessayez. |
| « Application compilée absente » | Le dossier est incomplet ou la version utilisable n’a pas été préparée. Récupérez une copie complète, ou suivez la commande de préparation ci-dessous. |
| Une erreur persiste | Consultez le message affiché. Si le service a tenté de démarrer, les détails peuvent se trouver dans `.runtime/server-error.log`. |
| Vos avancements semblent avoir disparu | Vérifiez que vous utilisez le même navigateur, le même profil et l’adresse habituelle se terminant par `:4173`. |

## Pour modifier l’application

Cette partie concerne uniquement le développement.

**La première fois :** installez Node.js et pnpm, ouvrez un terminal dans le dossier du projet, puis exécutez :

```powershell
pnpm install
```

**Pour travailler sur le code :** double-cliquez sur **Demarrer le developpement.cmd**. Une fenêtre de commande reste ouverte et le navigateur affiche [http://127.0.0.1:5173](http://127.0.0.1:5173). Les modifications du code sont rechargées automatiquement. Appuyez sur **Ctrl+C** dans cette fenêtre pour arrêter le développement.

Vous pouvez aussi démarrer depuis un terminal avec `pnpm dev`, puis ouvrir cette adresse.

Les versions quotidienne et de développement peuvent fonctionner en même temps. **Leurs avancements sont enregistrés séparément** : les saisies de la version quotidienne n’apparaissent pas automatiquement dans la version de développement.

**Pour rendre les changements disponibles dans la version quotidienne :**

```powershell
pnpm run build
```

Cette commande prépare les fichiers utilisés par **Lancer le suivi.cmd**. Rechargez ensuite la page de la version quotidienne.

Pour vérifier le code, utilisez `pnpm run check` et `pnpm test`. Les détails d’architecture sont dans [la documentation technique](docs/architecture-technique.md).
