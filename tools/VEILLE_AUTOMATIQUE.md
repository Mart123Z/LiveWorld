# Procédure de la veille automatique LiveWorld

Tu es lancé par une **tâche planifiée** : personne ne répondra à tes questions. Suis ces étapes dans l'ordre,
prends les décisions raisonnables toi-même et signale-les dans le champ `notes` du lot.

## 1. Préparer le dépôt

```bash
cd ~ && rm -rf lw inbox-wt
git clone https://github.com/Mart123Z/liveworld lw
cd lw
git fetch origin claude/liveworld-inbox
git worktree add ../inbox-wt origin/claude/liveworld-inbox --detach
cd ../inbox-wt && git checkout -B claude/liveworld-inbox origin/claude/liveworld-inbox && cd ../lw
```

- Le code (outils, instructions) vient de `main` (dossier `~/lw`).
- Les lots de veille sont stockés sur la branche `claude/liveworld-inbox` (dossier `~/inbox-wt/inbox`), que le site lit.
- Si le clonage ou l'envoi (`git push`) échoue faute d'accès, ajoute le dépôt à la session avec l'outil `add_repo` (propriétaire `Mart123Z`, dépôt `LiveWorld`, accès `push`), puis recommence.

## 2. Lire le dossier de session

```bash
cd ~/lw && LW_INBOX=~/inbox-wt/inbox node tools/inbox.mjs context > /tmp/contexte.md
```

Lis **entièrement** `/tmp/contexte.md` (avec l'outil de lecture, par morceaux si nécessaire). Il contient :
- la demande (partie 0) ;
- tes instructions permanentes (partie A) ;
- l'état actuel de la base (partie B) ;
- le squelette du fichier à produire (partie C).

## 3. Faire la veille

Suis la partie A : **au moins 10 recherches web différentes**, lecture des articles importants, deux sources indépendantes pour chaque fait majeur. Concentre-toi sur ce qui est **nouveau** par rapport à la partie B.

## 4. Produire et déposer le lot

1. Écris le lot dans `/tmp/lot.json` (format `liveworld.batch/v1`). Mets `"request": "Veille automatique du <date>"` et un `batch_id` horodaté unique.
2. Valide et dépose :
   ```bash
   cd ~/lw && LW_INBOX=~/inbox-wt/inbox node tools/inbox.mjs add /tmp/lot.json
   ```
3. Si la commande signale des entrées **REJETÉ** ou **DOUBLON PROBABLE**, corrige `/tmp/lot.json` et relance-la, jusqu'à ce qu'elle affiche « Enregistré ». Pour un doublon, réutilise l'identifiant existant si c'est le même sujet.

## 5. Publier

```bash
cd ~/inbox-wt && git add inbox && git commit -m "Veille automatique du $(date +%F)" && git push origin claude/liveworld-inbox
```

Ne modifie **rien d'autre** dans le dépôt, en particulier pas la branche `main`.

## 6. Compte rendu final (5 lignes maximum)

- nombre de nouveaux événements et de mises à jour ;
- les 3 faits majeurs ;
- les points non vérifiés ou à creuser.
