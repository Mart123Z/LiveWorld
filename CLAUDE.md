# LiveWorld — notes pour Claude (développement)

Site statique (GitHub Pages) sans étape de build : ES modules natifs, bibliothèques copiées dans `vendor/`.

## Architecture
- `js/model.js` : cœur métier. `analyzeBatch` (validation + détection de doublons) puis `applyBatch` (fusion additive) produisent des `changes` par collection ; `snapshot`/`visibleAt` reconstituent l'état à une date (journaux `severity_log`, `status_log`, `added_at`/`superseded_at`).
- `js/store.js` : `LocalStore` (IndexedDB, clé `db`) ou `FirebaseStore` (base partagée Firestore `spaces/main/{collection}/{id}` = `{ json, _ts, deleted }`, synchronisation incrémentale sur `_ts` + cache IndexedDB). Les objets sont sérialisés en JSON car Firestore refuse les tableaux imbriqués.
- Comptes : profils `users/{uid}` = `{ username, role: admin|editor|reader, disabled, … }`. Identifiant → e-mail technique `identifiant@<authDomain>`. L'Admin racine (`admin@<authDomain>`, codé dans `firestore.rules`) crée son profil à la première connexion. Création de comptes sans Cloud Functions : instance Firebase secondaire en mémoire (`createUser`). Pas d'inscription sur la page de connexion.
- Droits côté interface : `canWrite()` / `isAdmin()` dans `app.js` ; la sécurité réelle est dans `firestore.rules` (toute nouvelle collection doit y être ajoutée).
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
- Vérifier le schéma : `python3 -c "import json,jsonschema;…"` sur `templates/exemple-batch.json` et `data/demo-*.json`.
