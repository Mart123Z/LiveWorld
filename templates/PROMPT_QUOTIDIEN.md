# LiveWorld — Prompts à copier dans une nouvelle conversation Claude

Ouvre une **nouvelle conversation dans le Projet « LiveWorld »**, joins le fichier de contexte exporté depuis le site
(bouton **Exporter → Contexte pour Claude**), puis colle l'un des prompts ci-dessous.
Le site peut aussi copier le prompt du jour directement (**Exporter → Copier le prompt du jour**).

---

## 1. Veille quotidienne (usage normal)

```
Veille LiveWorld du {{DATE}}.

Le fichier de contexte joint liste tout ce qui existe déjà dans le site (dernier lot importé : {{DERNIER_LOT}}).
Fais la veille géopolitique et économique mondiale depuis ce dernier lot, en suivant tes instructions LiveWorld :
1. mets à jour les fils actifs du contexte (nouveaux faits, nouvelles sources, changement de sévérité ou de statut) ;
2. ajoute les nouveaux événements importants qui manquent, sur les 14 thèmes ;
3. relie-les aux événements existants, même anciens, quand c'est pertinent ;
4. ajoute le briefing du jour et les clôtures de marché.
{{FOCUS}}
Livre un seul fichier JSON liveworld.batch/v1, puis un compte rendu de 5 lignes.
```

## 2. Session complémentaire dans la même journée

```
Session complémentaire LiveWorld du {{DATE}} (une veille a déjà été faite aujourd'hui, voir le contexte joint).
Ne traite QUE ce qui s'est passé ou a été publié depuis {{DERNIER_LOT}}.
Pas de nouveau briefing complet, sauf si un événement critique le justifie : dans ce cas, envoie un briefing avec le titre « Mise à jour ».
Livre un seul fichier JSON liveworld.batch/v1.
```

## 3. Approfondir un sujet

```
Approfondissement LiveWorld : {{SUJET OU ID D'ÉVÉNEMENT}}.
En t'appuyant sur le contexte joint, enrichis cet événement : sources complémentaires, chronologie de fond (bloc timeline),
chiffres clés, scénarios, diagramme du mécanisme, lectures utiles. Ajoute les liens vers les événements liés, même anciens.
Réutilise l'id existant. Livre un seul fichier JSON liveworld.batch/v1.
```

## 4. Rattrapage d'une période

```
Rattrapage LiveWorld du {{DÉBUT}} au {{FIN}}.
Le contexte joint montre ce qui existe déjà. Reconstitue les événements majeurs manquants sur cette période
(dates de début exactes, sources datées de la période), avec les liens entre eux et un briefing par journée importante.
Livre un seul fichier JSON liveworld.batch/v1 (ou plusieurs fichiers si le volume dépasse 40 événements).
```

## 5. Bilan mensuel ou annuel (sans import)

```
À partir du fichier « Résumé » joint (export LiveWorld pour {{PÉRIODE}}), rédige une note de synthèse :
grandes tendances par thème, chaînes de causalité majeures, impacts économiques, et ce qu'il faut surveiller ensuite.
```
