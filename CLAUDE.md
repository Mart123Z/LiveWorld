# LiveWorld — notes pour Claude (développement)

Site statique (GitHub Pages) sans étape de build : ES modules natifs, bibliothèques copiées dans `vendor/`.

## Architecture
- `js/model.js` : cœur métier. `analyzeBatch` (validation + détection de doublons) puis `applyBatch` (fusion additive) produisent des `changes` par collection ; `snapshot`/`visibleAt` reconstituent l'état à une date (journaux `severity_log`, `status_log`, `added_at`/`superseded_at`).
- `js/store.js` : `LocalStore` (IndexedDB, clé `db`) ou `FirebaseStore` (base partagée Firestore `spaces/main/{collection}/{id}` = `{ json, _ts, deleted }`, synchronisation incrémentale sur `_ts` + cache IndexedDB). Les objets sont sérialisés en JSON car Firestore refuse les tableaux imbriqués.
- Comptes : profils `users/{uid}` = `{ username, role: admin|editor|reader, disabled, … }`. Identifiant → e-mail technique `identifiant@<authDomain>`. L'Admin racine (`admin@<authDomain>`, codé dans `firestore.rules`) crée son profil à la première connexion. Création de comptes sans Cloud Functions : instance Firebase secondaire en mémoire (`createUser`). Pas d'inscription sur la page de connexion.
- Droits côté interface : `canWrite()` / `isAdmin()` dans `app.js` ; la sécurité réelle est dans `firestore.rules` (toute nouvelle collection doit y être ajoutée).
- Veille automatique : la tâche planifiée suit `tools/VEILLE_AUTOMATIQUE.md`, utilise `tools/inbox.mjs` et pousse les lots sur la branche `claude/liveworld-inbox` du dépôt PRIVÉ `Mart123Z/LiveWorld-data` (`inbox/index.json` + un fichier par lot ; jamais dans le dépôt public). Le site (`refreshFromGitHub` dans `app.js`) le lit via l'API GitHub avec un jeton en lecture seule stocké dans Firestore `config/github` (lecture : comptes actifs, écriture : admin) : il enregistre les lots manquants dans la base pour admin/éditeur, et les applique en mémoire pour un lecteur.
- Collections : `events`, `links` (id `from__to__type`), `briefings` (id `date__batch`), `markets` (id `date__asset`), `batches`.
- `js/exporter.js` : contexte Markdown pour Claude, résumé, sauvegarde `liveworld.backup/v1`, prompts.
- `js/blocks.js` : rendu des blocs libres ; tout texte passe par `esc`/`md` ; URL acceptées uniquement en https.

## Règles
- Format d'échange `liveworld.batch/v1` : toute évolution doit être répercutée dans `templates/liveworld-batch.schema.json`, `templates/INSTRUCTIONS_CLAUDE.md`, `js/config.js` et `js/model.js`.
- Un import ne doit jamais effacer de données : fusion additive, historique conservé.
- Jamais d'événement affiché sans source datée.
- Interface en français, thème sombre unique.

## Commandes
- Local : `python3 -m http.server 8000`
- **Avant chaque commit qui touche `js/`, `css/` ou `vendor/`** : `python3 tools/bump-version.py` (ajoute `?v=` à toutes les références internes, pour qu'un navigateur ne mélange jamais anciens et nouveaux fichiers ; `firebase-config.js` est toujours rechargé sans cache).
- `index.html` contient un diagnostic de démarrage : en cas d'échec, la cause s'affiche à la place de « Chargement… ».
- Vérifier le schéma : `python3 -c "import json,jsonschema;…"` sur `templates/exemple-batch.json` et `data/demo-*.json`.
