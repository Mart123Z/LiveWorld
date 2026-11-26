# Procédure de la veille automatique LiveWorld

Tu es lancé par une **tâche planifiée** : personne ne répondra à tes questions. Suis ces étapes dans l'ordre,
prends les décisions raisonnables toi-même et signale-les dans le champ `notes` du lot.

## 1. Préparer les dépôts

- Le **code** est dans le dépôt public `Mart123Z/LiveWorld` (dossier `~/lw`).
- Les **veilles** vont dans le dépôt **privé** `Mart123Z/LiveWorld-data`, branche `claude/liveworld-inbox` (dossier `~/data`). Le site les lit à cet endroit.

```bash
cd ~ && rm -rf lw data
git clone https://github.com/Mart123Z/liveworld lw
git clone https://github.com/Mart123Z/LiveWorld-data data
```

Si le clonage de `LiveWorld-data` échoue, ajoute le dépôt à la session avec l'outil `add_repo` (propriétaire `Mart123Z`, dépôt `LiveWorld-data`, accès `push`), puis recommence.

**Vérification de confidentialité, obligatoire.** La commande suivante doit afficher `404`, ce qui prouve que le dépôt n'est pas public :

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.github.com/repos/Mart123Z/LiveWorld-data
```

Si elle affiche `200` (dépôt public), ou si le dépôt privé reste inaccessible : **ARRÊTE-TOI**. N'écris aucune veille ailleurs, en particulier pas dans le dépôt public `LiveWorld`, et explique le problème dans ton compte rendu.

Prépare ensuite la branche des veilles :

```bash
cd ~/data
if git fetch origin claude/liveworld-inbox 2>/dev/null; then
  git checkout -B claude/liveworld-inbox origin/claude/liveworld-inbox
else
  git checkout --orphan claude/liveworld-inbox && git rm -rfq . 2>/dev/null; mkdir -p inbox
  printf '{\n "schema": "liveworld.inbox/v1",\n "batches": []\n}\n' > inbox/index.json
fi
```

## 2. Lire le dossier de session

```bash
cd ~/lw && LW_INBOX=~/data/inbox node tools/inbox.mjs context > /tmp/contexte.md
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
   cd ~/lw && LW_INBOX=~/data/inbox node tools/inbox.mjs add /tmp/lot.json
   ```
3. Si la commande signale des entrées **REJETÉ** ou **DOUBLON PROBABLE**, corrige `/tmp/lot.json` et relance-la, jusqu'à ce qu'elle affiche « Enregistré ». Pour un doublon, réutilise l'identifiant existant si c'est le même sujet.

## 5. Publier

```bash
cd ~/data && git add inbox && git commit -m "Veille automatique du $(date +%F)" && git push origin claude/liveworld-inbox
```

Ne modifie **rien** dans le dépôt public `LiveWorld`, et ne pousse que la branche `claude/liveworld-inbox` du dépôt privé.

## 6. Compte rendu final (5 lignes maximum)

- nombre de nouveaux événements et de mises à jour ;
- les 3 faits majeurs ;
- les points non vérifiés ou à creuser.
