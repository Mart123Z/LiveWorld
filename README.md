# LiveWorld

Tableau de bord personnel d'intelligence géopolitique et économique : carte du monde, dossiers d'événements sourcés, chaînes de causalité, impacts économiques, briefings, recherche et Time-Machine.

**Principe** : le site ne fait aucune collecte lui-même. Chaque jour, vous demandez la veille à **Claude** (dans un Projet Claude), qui renvoie un fichier JSON au format fixe ; vous l'importez dans le site, qui le **fusionne** avec l'existant sans rien écraser. Le site exporte ensuite un **fichier de contexte** pour que la session Claude suivante sache ce qui existe déjà et se concentre sur le nouveau.

```
Site ──Exporter──► contexte.md + prompt ──► Claude (Projet LiveWorld, recherche web)
 ▲                                                         │
 └──────────────Importer◄──── liveworld-batch-….json ◄─────┘
```

- Hébergement : **GitHub Pages** (gratuit), site 100 % statique, aucune dépendance externe hormis les polices.
- Données : **Firebase Firestore** (plan gratuit Spark) pour les retrouver sur tous vos appareils, ou **mode local** (navigateur) sans aucune configuration.
- Coût : 0 € en plus de votre abonnement Claude.

---

## 1. Mettre le site en ligne (5 min)

1. Sur GitHub, ouvrez le dépôt **LiveWorld** → **Settings** → **Pages**.
2. *Source* : **Deploy from a branch** · *Branch* : **main** · dossier **/ (root)** → **Save**.
3. Après une à deux minutes, le site est disponible à l'adresse **https://mart123z.github.io/LiveWorld/**.

À ce stade, le site fonctionne déjà en **mode local** : les données restent dans le navigateur utilisé. Cliquez sur **Charger la démo** pour le découvrir (les données de démo sont fictives et se retirent dans *Réglages*).

## 2. Brancher Firebase pour synchroniser vos appareils (15 min)

1. Allez sur **console.firebase.google.com** → **Créer un projet** (nom : `liveworld`). Google Analytics n'est pas nécessaire.
2. **Firestore** : menu *Build* → **Firestore Database** → **Créer une base de données** → emplacement en Europe (par ex. `europe-west9` Paris) → **mode production**.
3. **Règles** : onglet *Règles* de Firestore → collez le contenu de [`firestore.rules`](firestore.rules) en remplaçant `VOTRE_EMAIL@exemple.com` par votre adresse → **Publier**.
4. **Authentification** : *Build* → **Authentication** → **Commencer** → onglet *Méthode de connexion* → activez **Adresse e-mail/Mot de passe**. Onglet *Utilisateurs* → **Ajouter un utilisateur** avec la même adresse et un mot de passe solide.
5. **Configuration web** : ⚙ *Paramètres du projet* → *Vos applications* → icône **Web `</>`** → nom `liveworld` (pas besoin de Firebase Hosting) → copiez l'objet `firebaseConfig`.
6. Sur GitHub, ouvrez [`js/firebase-config.js`](js/firebase-config.js) → icône crayon → remplacez `export const firebaseConfig = null;` par la configuration copiée (voir l'exemple dans le fichier) → **Commit changes**.
7. Rechargez le site : un écran de connexion apparaît. Connectez-vous avec le compte créé à l'étape 4.

> La configuration Firebase n'est pas secrète (elle est visible dans tout site Firebase). La protection vient des **règles** : seul votre compte peut lire et écrire vos données, stockées sous `users/<votre-uid>/…`.
>
> Vous aviez commencé en mode local ? *Réglages* → **Envoyer la base locale de ce navigateur vers Firebase**.

## 3. Créer le Projet Claude « LiveWorld » (5 min, une seule fois)

1. Sur claude.ai : **Projets** → **Créer un projet** → nom : `LiveWorld`.
2. **Instructions du projet** : collez tout le contenu de [`templates/INSTRUCTIONS_CLAUDE.md`](templates/INSTRUCTIONS_CLAUDE.md) (ou bouton *Réglages → Copier les instructions* sur le site).
3. **Connaissances du projet** : ajoutez les fichiers [`templates/liveworld-batch.schema.json`](templates/liveworld-batch.schema.json) et [`templates/exemple-batch.json`](templates/exemple-batch.json).
4. Vérifiez que la **recherche web** est activée dans vos réglages Claude.

## 4. La routine quotidienne (2 min de manipulation)

1. Sur le site : **Exporter** → *Veille quotidienne* → **Télécharger le contexte + copier le prompt**.
2. Dans Claude : **nouvelle conversation dans le Projet LiveWorld** → joignez le fichier `liveworld-contexte-….md` → collez le prompt → envoyez.
3. Claude fait ses recherches et livre `liveworld-batch-….json` (ou un bloc de code JSON).
4. Sur le site : **Importer** → choisissez le fichier (ou collez le JSON) → **Analyser** → vérifiez l'aperçu → **Importer**.

Sur iPhone : le fichier de Claude s'enregistre dans *Fichiers*, et le bouton *Importer* sait l'y retrouver. Coller le JSON fonctionne aussi.

### Plusieurs demandes dans la même journée

Aucun lot n'écrase le précédent. Choisissez *Session complémentaire* dans **Exporter** : le prompt demande à Claude de ne traiter que ce qui est postérieur au dernier lot importé. À l'import :

| Élément reçu | Ce que fait le site |
|---|---|
| Nouvel identifiant | Crée l'événement (au moins une source datée obligatoire, sinon rejet). |
| Identifiant existant | **Fusionne** : sources et mises à jour ajoutées sans doublon (par URL, par date et texte) ; thèmes et tags réunis ; titre, résumé, sévérité ou statut mis à jour **avec historique**. |
| Bloc avec un `id` déjà présent | Remplace ce bloc (ex. chiffres clés actualisés) ; un bloc sans `id` est ajouté. |
| Impact sur un secteur déjà évalué | La nouvelle évaluation remplace l'ancienne, qui reste visible dans la Time-Machine. |
| Titre proche d'un événement existant | Signalé comme **doublon probable** : vous choisissez de fusionner ou de séparer. |
| Briefing | Chaque lot ajoute une **édition** ; plusieurs éditions par jour sont consultables dans l'onglet *Bilan*. |
| Même lot réimporté | Sans effet (tout est dédoublonné). |

## 5. Ce que fait le site

- **Carte** : repères par sévérité (rouge pulsant, orange, cyan), arcs de causalité, repères « fantômes » pour les événements liés hors période, points secondaires fournis par Claude. Sur mobile : un doigt fait défiler la page, deux doigts déplacent la carte.
- **Time-Machine** : choisissez une date et une **fenêtre d'activité** (1, 7, 30, 90 jours ou tout) ; la carte, les sévérités, les sources, les impacts et les cotations reprennent l'état de ce jour-là.
- **Dossier** : résumé, blocs d'analyse libres (chiffres clés, graphiques, tableaux, diagrammes, scénarios, chronologie, citations, images sous licence libre, lectures utiles), sources, chronologie, impacts, chaîne de causalité en amont et en aval, historique des modifications.
- **Liens entre événements** de n'importe quelle date : proposés par Claude, ou ajoutés à la main (**+ Lier**).
- **Thèmes** : 14 thématiques, filtre de la carte, historique complet d'un thème mois par mois.
- **Recherche** (touche `/`) : plein texte, tolérante aux fautes, sur toute la base (titres, résumés, mises à jour, sources, blocs), avec filtres par thème, sévérité, statut et année.
- **Exports** : contexte pour Claude (90 jours, un mois, une année, une période ou tout ; compact ou détaillé), résumé lisible en Markdown, sauvegarde complète en JSON (restaurable dans *Réglages*).
- **Marchés** : statut en temps réel des grandes places boursières (jours fériés inclus jusqu'à fin 2027) ; cotations fournies par Claude dans chaque lot ; Bitcoin et EUR/USD actualisés en direct depuis des sources gratuites quand vous regardez la date du jour.

## 6. iPhone

Ouvrez le site dans Safari → **Partager** → **Sur l'écran d'accueil** : LiveWorld s'ouvre alors comme une application, en plein écran.

Pas de notifications sur l'écran verrouillé dans cette architecture : le site n'a pas de serveur qui tourne en permanence, et c'est vous qui importez les nouveautés. L'icône 🔔 affiche le journal des imports.

## 7. Sauvegardes

**Exporter** → *Sauvegarde complète (.json)* une fois par mois (ou avant toute manipulation importante). Restauration : *Réglages* → **Restaurer une sauvegarde**.

## 8. Structure du dépôt

```
index.html                 page unique
css/app.css                styles
js/app.js                  interface
js/model.js                Time-Machine, chaînes de causalité, validation et fusion des lots
js/exporter.js             contexte Claude, résumés, sauvegarde, prompts
js/blocks.js               rendu des blocs libres (aucun HTML brut accepté)
js/store.js                stockage local (IndexedDB) ou Firebase (Firestore + cache)
js/map.js, js/markets.js   carte, places boursières et cotations
js/config.js               vocabulaires (thèmes, sévérités, types de liens…)
js/firebase-config.js      votre configuration Firebase
templates/                 instructions Claude, prompts, schéma JSON, exemple de lot
data/                      fond de carte et lots de démonstration
vendor/                    d3, topojson, MiniSearch, Mermaid, Firebase (copies locales)
firestore.rules            règles de sécurité à publier dans Firebase
```

Tester en local : `python3 -m http.server 8000` à la racine, puis http://localhost:8000.

Pour modifier le format, changez ensemble `templates/liveworld-batch.schema.json`, `templates/INSTRUCTIONS_CLAUDE.md`, `js/config.js` et `js/model.js`.
