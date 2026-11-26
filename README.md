# LiveWorld

Tableau de bord personnel d'intelligence géopolitique et économique : carte du monde, dossiers d'événements sourcés, chaînes de causalité, impacts économiques, briefings, recherche et Time-Machine.

**Principe** : le site ne fait aucune collecte lui-même. Chaque jour, vous demandez la veille à **Claude** (dans un Projet Claude), qui renvoie un fichier JSON au format fixe ; vous l'importez dans le site, qui le **fusionne** avec l'existant sans rien écraser. Le site exporte ensuite un **fichier de contexte** pour que la session Claude suivante sache ce qui existe déjà et se concentre sur le nouveau.

```
Site ──Exporter──► contexte.md + prompt ──► Claude (Projet LiveWorld, recherche web)
 ▲                                                         │
 └──────────────Importer◄──── liveworld-batch-….json ◄─────┘
```

- Hébergement : **GitHub Pages** (gratuit), site 100 % statique, aucune dépendance externe hormis les polices.
- Données et comptes : **Firebase** (plan gratuit Spark). Accès réservé aux comptes créés par l'Admin, avec trois rôles (administrateur, éditeur, lecteur). Sans Firebase, le site fonctionne en **mode local**, sans compte.
- Coût : 0 € en plus de votre abonnement Claude.

---

## 1. Mettre le site en ligne (5 min)

1. Sur GitHub, ouvrez le dépôt **LiveWorld** → **Settings** → **Pages**.
2. *Source* : **Deploy from a branch** · *Branch* : **main** · dossier **/ (root)** → **Save**.
3. Après une à deux minutes, le site est disponible à l'adresse **https://mart123z.github.io/LiveWorld/**.

À ce stade, le site fonctionne en **mode local**, sans compte : les données restent dans le navigateur utilisé. Cliquez sur **Charger la démo** pour le découvrir (les données de démo sont fictives et se retirent dans *Réglages*). L'étape 2 active les comptes.

## 2. Activer Firebase et les comptes (20 min)

Une fois Firebase configuré, **le site n'est accessible qu'avec un compte**. La page de connexion permet uniquement de se connecter : les comptes sont créés par l'**Admin**, depuis le site. Tous les comptes partagent la même base.

| Rôle | Droits |
|---|---|
| **Administrateur** | Tout, y compris créer, modifier, désactiver et supprimer des comptes, restaurer ou vider la base |
| **Éditeur** | Consulter, importer les lots de Claude, créer et supprimer des liens et des événements, charger la démo |
| **Lecteur** | Consulter, rechercher et exporter (lecture seule) |

### 2.1 Créer le projet Firebase

1. Allez sur **console.firebase.google.com** → **Créer un projet** (nom : `liveworld`). Google Analytics n'est pas nécessaire. Restez sur le plan gratuit **Spark**.
2. Notez l'**identifiant du projet** (par ex. `liveworld-1a2b3`) : il apparaît dans ⚙ *Paramètres du projet*.

### 2.2 Activer la connexion par identifiant et mot de passe

1. *Build* → **Authentication** → **Commencer**.
2. Onglet *Méthode de connexion* → **Adresse e-mail/Mot de passe** → **Activer** (laissez « Lien par e-mail » désactivé) → **Enregistrer**.

> Le site transforme chaque identifiant en adresse technique : `Admin` → `admin@<identifiant-du-projet>.firebaseapp.com`, `marie` → `marie@<identifiant-du-projet>.firebaseapp.com`. Aucun e-mail n'est jamais envoyé.

### 2.3 Créer le compte Admin (une seule fois, dans la console)

1. *Authentication* → onglet **Utilisateurs** → **Ajouter un utilisateur**.
2. Adresse e-mail : `admin@<identifiant-du-projet>.firebaseapp.com` (ex. `admin@liveworld-1a2b3.firebaseapp.com`).
3. Mot de passe : un mot de passe solide (12 caractères ou plus). C'est le mot de passe du compte **Admin**.

C'est le seul compte à créer dans la console : tous les autres se créent depuis le site.

### 2.4 Créer la base Firestore et publier les règles

1. *Build* → **Firestore Database** → **Créer une base de données** → emplacement en Europe (par ex. `europe-west9` Paris) → **mode production**.
2. Onglet **Règles** → remplacez tout par le contenu de [`firestore.rules`](firestore.rules).
3. Dans ce texte, remplacez `VOTRE-PROJET` par votre identifiant de projet (ex. `admin@liveworld-1a2b3.firebaseapp.com`) → **Publier**.

Ces règles garantissent que :
- un visiteur non connecté ne peut rien lire ni écrire ;
- un compte sans fiche dans la collection `users`, ou désactivé, n'a accès à rien (même s'il a réussi à créer un compte Firebase par un autre moyen) ;
- seul un administrateur peut créer, modifier ou supprimer des comptes ;
- seuls les administrateurs et les éditeurs peuvent modifier la base partagée (`spaces/main/…`).

### 2.5 Relier le site à Firebase

1. ⚙ *Paramètres du projet* → *Vos applications* → icône **Web `</>`** → nom `liveworld` (pas besoin de Firebase Hosting) → copiez l'objet `firebaseConfig`.
2. Sur GitHub, ouvrez [`js/firebase-config.js`](js/firebase-config.js) → icône crayon → remplacez `export const firebaseConfig = null;` par la configuration copiée (voir l'exemple dans le fichier) → **Commit changes**.

> La configuration Firebase n'est pas secrète : elle est visible dans tout site Firebase. La sécurité repose sur les règles de l'étape 2.4.

### 2.6 Première connexion et création des comptes

1. Ouvrez le site : l'écran **Connexion à LiveWorld** apparaît. Identifiant : `Admin`, mot de passe : celui de l'étape 2.3. Le profil administrateur est créé automatiquement.
2. ⚙ **Réglages** → **Gérer les comptes** → *Créer un compte* :
   - choisissez un identifiant (minuscules, chiffres, `.`, `_` ou `-`) ;
   - choisissez un rôle ;
   - tapez un mot de passe provisoire ou cliquez sur **Générer** ;
   - transmettez l'identifiant et le mot de passe à la personne.
3. Chaque utilisateur peut changer son mot de passe : ⚙ **Réglages** → **Changer mon mot de passe**. Faites-le aussi pour l'Admin si vous le souhaitez.

Gestion courante (⚙ **Réglages** → **Gérer les comptes**) :
- **Changer le rôle** : liste déroulante, effet immédiat.
- **Désactiver / Réactiver** : un compte désactivé ne peut plus rien lire ; il est refusé dès sa prochaine ouverture du site.
- **Supprimer** : retire l'accès. Pour libérer complètement l'identifiant, supprimez aussi l'utilisateur dans la console Firebase (*Authentication → Utilisateurs*).
- **Mot de passe oublié** : sans serveur payant, le site ne peut pas réinitialiser le mot de passe d'un autre compte. Supprimez le compte dans le site **et** dans la console Firebase, puis recréez-le avec le même identifiant et un nouveau mot de passe provisoire.
- **Mot de passe Admin oublié** : console Firebase → *Authentication → Utilisateurs* → supprimez `admin@…`, puis recréez-le (étape 2.3). Le profil administrateur et les données sont conservés.

> Vous aviez commencé en mode local ? Connecté en Admin, dans le navigateur qui contient ces données : ⚙ **Réglages** → **Envoyer la base locale de ce navigateur vers Firebase**.

## 3. Créer le Projet Claude « LiveWorld » (facultatif, 5 min)

> Le fichier de contexte exporté est **autonome** par défaut : il contient vos instructions, la demande du jour, l'état de la base et un modèle du fichier à produire. Il fonctionne donc dans **n'importe quelle** conversation Claude. Un Projet reste utile pour tout regrouper au même endroit ; dans ce cas, vous pouvez décocher « Fichier autonome » à l'export pour un fichier plus léger.

1. Sur claude.ai : **Projets** → **Créer un projet** → nom : `LiveWorld`.
2. **Instructions du projet** : collez tout le contenu de [`templates/INSTRUCTIONS_CLAUDE.md`](templates/INSTRUCTIONS_CLAUDE.md) (ou bouton *Réglages → Copier les instructions* sur le site).
3. **Connaissances du projet** : ajoutez les fichiers [`templates/liveworld-batch.schema.json`](templates/liveworld-batch.schema.json) et [`templates/exemple-batch.json`](templates/exemple-batch.json).
4. Vérifiez que la **recherche web** est activée dans vos réglages Claude.

## 4. Veille automatique (recommandé)

Une **tâche planifiée Claude** (incluse dans l'abonnement, elle consomme votre quota Claude) fait la veille chaque matin vers 6 h 30, sans intervention. Elle suit [`tools/VEILLE_AUTOMATIQUE.md`](tools/VEILLE_AUTOMATIQUE.md) :
1. elle reconstitue l'état de la base à partir des veilles précédentes ;
2. elle fait les recherches web et produit un lot ;
3. elle le valide et le dépose dans le dépôt **privé** `Mart123Z/LiveWorld-data` (branche `claude/liveworld-inbox`).

Le site lit ce dépôt privé, **uniquement une fois connecté**, à l'ouverture, au retour sur l'onglet et toutes les 15 minutes. Il n'y a aucun bouton à utiliser.
- **Admin et éditeurs** : les nouvelles veilles sont aussi enregistrées dans Firebase.
- **Lecteurs** : les veilles sont seulement affichées.

### 4.1 Mise en place (une seule fois, 10 min)

1. **Créer le dépôt privé** sur GitHub : **New repository** → nom `LiveWorld-data` → **Private** → cochez *Add a README file* → **Create**.
2. **Créer un jeton en lecture seule** : GitHub → photo de profil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   - Nom : `LiveWorld lecture`.
   - Expiration : la plus longue proposée.
   - *Repository access* : **Only select repositories** → `LiveWorld-data`.
   - *Permissions* → *Repository permissions* → **Contents : Read-only**.
   - **Generate token**, puis copiez le jeton (`github_pat_…`).
3. Sur le site, connecté en **Admin** : ⚙ **Réglages** → *Veille automatique (dépôt privé)* → collez le jeton → **Tester et enregistrer**. Le site refuse un dépôt public.
4. Republiez les **règles Firestore** à partir de [`firestore.rules`](firestore.rules) : elles protègent ce jeton, lisible seulement par les comptes connectés.
5. Vérifiez que la tâche planifiée Claude a accès à `LiveWorld-data`. Si sa première exécution signale un problème d'accès, autorisez ce dépôt dans les réglages GitHub de Claude.

L'icône 🔔 (*Journal des veilles*) montre l'état de la veille et propose **Vérifier maintenant**. Quand le jeton expire, le journal l'indique : créez-en un nouveau et recollez-le dans les Réglages.

- **Lancer une veille tout de suite** : https://claude.ai/code/routines → « Veille LiveWorld quotidienne » → **Exécuter maintenant**. Elle apparaît sur le site 10 à 20 minutes plus tard.
- **Bon à savoir** : la veille automatique ne voit que ses propres veilles. Les liens ajoutés à la main, les suppressions et les imports manuels ne lui sont pas connus.

## 5 bis. Confidentialité

- **Le site** (code, page de connexion, modèles pour Claude) est public : il ne contient aucune donnée.
- **Les données** sont accessibles uniquement après connexion. Firebase protège les événements, les briefings et les comptes. Le dépôt privé `LiveWorld-data` protège les veilles brutes de Claude.
- **Seul l'Admin crée les comptes** : bouton **Comptes** dans l'en-tête, visible uniquement par l'Admin. Après la création, **Partager…** envoie l'adresse du site, l'identifiant et le mot de passe provisoire par Messages, WhatsApp, e-mail…

## 4 bis. La routine manuelle (si besoin)

1. Sur le site : **Exporter** → *Veille quotidienne* → **Télécharger le contexte + copier le prompt**.
2. Dans Claude : **nouvelle conversation** (dans le Projet LiveWorld ou non) → joignez le fichier `liveworld-contexte-….md` → collez le prompt copié (« Fais ce qui est demandé dans le fichier joint… ») → envoyez.
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
js/store.js                stockage local (IndexedDB) ou Firebase (Firestore + cache), comptes et rôles
js/map.js, js/markets.js   carte, places boursières et cotations
js/config.js               vocabulaires (thèmes, sévérités, types de liens…)
js/firebase-config.js      votre configuration Firebase
templates/                 instructions Claude, prompts, schéma JSON, exemple de lot
data/                      fond de carte et lots de démonstration
vendor/                    d3, topojson, MiniSearch, Mermaid, Firebase (copies locales)
firestore.rules            règles de sécurité à publier dans Firebase (rôles, base partagée)
```

Tester en local : `python3 -m http.server 8000` à la racine, puis http://localhost:8000.

Pour modifier le format, changez ensemble `templates/liveworld-batch.schema.json`, `templates/INSTRUCTIONS_CLAUDE.md`, `js/config.js` et `js/model.js`.
