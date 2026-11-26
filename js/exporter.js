// Exports : contexte pour Claude, résumé lisible, sauvegarde complète, prompt du jour
import { THEMES, THEME_LABEL, SEV, SEV_RANK, STATUS, LINK_TYPES, DIR, ASSETS, BACKUP_SCHEMA } from './config.js?v=202611261011';
import { liveEvents, lastActivity, liveLinks, currentImpacts, chainOf, snapshot } from './model.js?v=202611261011';
import { today, fmtLong, dayOf, ts, mdText, fmtNum, addDays } from './util.js?v=202611261011';

export function scopeRange(scope) {
  if (scope.kind === 'month') return { from: scope.month + '-01', to: addDays(nextMonth(scope.month) + '-01', -1), label: new Date(scope.month + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  if (scope.kind === 'year') return { from: scope.year + '-01-01', to: scope.year + '-12-31', label: 'année ' + scope.year };
  if (scope.kind === 'range') return { from: scope.from, to: scope.to, label: `du ${scope.from} au ${scope.to}` };
  return { from: '0000-01-01', to: '9999-12-31', label: 'toute la base' };
}
const nextMonth = m => { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${String(mo).padStart(2, '0')}`; };
export const inScope = (e, r) => e.date <= r.to && lastActivity(e) >= r.from;
const latestBatch = db => Object.values(db.batches).sort((a, b) => ts(b.generated_at) - ts(a.generated_at))[0];
const latestBriefing = (db, to = '9999') => Object.values(db.briefings).filter(b => b.date <= to).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : ts(b.generated_at) - ts(a.generated_at))[0];
const line = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------- Contexte pour Claude ----------
// Squelette minimal d'un lot, inclus dans le fichier de contexte autonome
const SKELETON = `{
  "schema": "liveworld.batch/v1",
  "batch_id": "AAAA-MM-JJTHH-MM-claude",
  "generated_at": "AAAA-MM-JJTHH:MM:00+01:00",
  "author": "claude",
  "request": "Résumé de la demande",
  "coverage": { "from": "AAAA-MM-JJ", "to": "AAAA-MM-JJ" },
  "notes": "Ce qui n'a pas pu être vérifié",
  "events": [
    {
      "id": "evt-AAAAMMJJ-slug-court",
      "title": "Titre factuel",
      "summary": "2 à 5 phrases.",
      "date": "AAAA-MM-JJ",
      "status": "active",
      "severity": "high",
      "themes": ["diplomatie"],
      "tags": ["pays", "acteur"],
      "location": { "name": "Lieu", "country": "FR", "lat": 48.85, "lng": 2.35, "precision": "city" },
      "sources": [ { "outlet": "Média", "title": "Titre de l'article", "url": "https://…", "published_at": "AAAA-MM-JJTHH:MM:00+01:00" } ],
      "updates": [ { "at": "AAAA-MM-JJTHH:MM:00+01:00", "text": "Fait nouveau.", "severity": "high" } ],
      "impacts": [ { "sector": "Énergie", "direction": "bullish", "horizon": "weeks", "confidence": "medium", "rationale": "Ce qui monte et pourquoi." } ],
      "blocks": [
        { "id": "chiffres", "type": "key_figures", "items": [ { "label": "Indicateur", "value": "12", "unit": "%", "source_url": "https://…" } ] },
        { "type": "text", "md": "**Pourquoi c'est important.** …" }
      ]
    },
    { "id": "evt-…-existant", "updates": [ { "at": "…", "text": "Mise à jour d'un événement déjà présent." } ], "sources": [ { "outlet": "…", "url": "https://…", "published_at": "…" } ] }
  ],
  "links": [ { "from": "evt-…", "to": "evt-…", "type": "causes", "confidence": "medium", "rationale": "Une phrase." } ],
  "briefing": { "date": "AAAA-MM-JJ", "title": "Briefing du …", "top": [ { "event_id": "evt-…", "why": "…" } ], "macro": "…", "markets": "…", "watch": ["…"] },
  "markets": [ { "date": "AAAA-MM-JJ", "asset": "BRENT", "close": 70.4, "change_pct": 0.6, "source_url": "https://…" } ]
}`;

// opts.instructions : texte de INSTRUCTIONS_CLAUDE.md à inclure (fichier autonome) ; opts.prompt : demande de la session
export function contextMd(db, scope, detail = 'compact', opts = {}) {
  const S = [];
  const lb0 = latestBatch(db);
  S.push(`# LiveWorld — Dossier de session pour Claude`, '');
  if (opts.instructions) S.push(`> Ce fichier est **autonome** : il contient la demande (partie 0), tes instructions permanentes (partie A), l'état actuel de la base (partie B) et un squelette du fichier à produire (partie C). Lis-le en entier avant de commencer.`, '');
  if (opts.prompt) S.push(`## 0. Demande de cette session`, '', opts.prompt, '');
  if (!lb0) S.push(`> **Première session** : la base est vide. Couvre les 7 derniers jours (du ${addDays(today(), -7)} au ${today()}) et crée les événements majeurs de cette période.`, '');
  if (opts.instructions) S.push(`---`, '', `# Partie A — Instructions permanentes`, '', opts.instructions.replace(/^(#{1,5}) /gm, '#$1 '), '', `---`, '', `# Partie B — État actuel de la base`, '');
  const state = contextState(db, scope, detail, !!opts.instructions);
  S.push(state);
  if (opts.instructions) S.push('', `---`, '', `# Partie C — Squelette du fichier à produire`, '', 'Remplace chaque valeur d’exemple ; supprime les champs inutiles. Voir la partie A pour tous les champs et les 12 types de blocs.', '', '```json', SKELETON, '```', '');
  return S.join('\n');
}

function contextState(db, scope, detail, embedded) {
  const r = scopeRange(scope);
  const evs = liveEvents(db).filter(e => inScope(e, r)).sort((a, b) => (lastActivity(b) > lastActivity(a) ? 1 : -1));
  const lb = latestBatch(db);
  const activeCut = addDays(today(), -14);
  const isActive = e => e.status !== 'resolved' && lastActivity(e) >= activeCut;
  const active = evs.filter(isActive), others = evs.filter(e => !isActive(e));
  const tags = {}; for (const e of evs) for (const t of e.tags || []) tags[t] = (tags[t] || 0) + 1;
  const L = [];
  L.push(`- Exporté le : ${new Date().toISOString()} (${fmtLong(today())})`);
  L.push(`- Périmètre : ${r.label} · ${evs.length} événement(s) sur ${liveEvents(db).length} dans la base`);
  L.push(`- **Dernier lot importé : ${lb ? lb.generated_at + ' (' + lb.id + ')' : 'aucun'}**`);
  L.push(`- Format attendu en retour : liveworld.batch/v1 (${embedded ? 'voir parties A et C' : 'voir instructions du Projet'})`, '');
  L.push(`> Règles : réutilise EXACTEMENT les id ci-dessous pour toute mise à jour ; n'envoie que le nouveau ;`);
  L.push(`> ne renvoie pas les sources déjà listées ; relie les nouveaux faits aux id existants via \`links\`.`, '');

  L.push(`## 1. Événements actifs (activité < 14 jours) — à mettre à jour en priorité`, '');
  if (!active.length) L.push('_Aucun._', '');
  for (const e of active) {
    const v = snapshot(e);
    L.push(`### ${e.id}`);
    L.push(`- **${line(e.title)}** · ${SEV[v.sev]} · ${STATUS[v.status]} · début ${e.date} · dernière activité ${v.last}`);
    L.push(`- Thèmes : ${(e.themes || []).join(', ') || '—'} · Lieu : ${e.location?.name || '—'}${(e.tags || []).length ? ' · Tags : ' + e.tags.join(', ') : ''}`);
    L.push(`- Résumé : ${line(e.summary)}`);
    const ups = v.ups.slice(0, detail === 'full' ? 8 : 3);
    if (ups.length) L.push(`- Dernières mises à jour : ${ups.map(u => `[${dayOf(u.at)}] ${line(u.text)}`).join(' | ')}`);
    L.push(`- Sources connues (ne pas renvoyer) : ${v.srcs.map(s => s.url).join(' ')}`);
    const imps = v.imps; if (imps.length) L.push(`- Impacts actuels : ${imps.map(i => `${i.sector} ${DIR[i.direction]?.[0] || i.direction}`).join(', ')}`);
    const ids = (e.blocks || []).filter(b => b.id).map(b => `${b.id} (${b.type})`); if (ids.length) L.push(`- Blocs à identifiant (renvoyer le même id pour les mettre à jour) : ${ids.join(', ')}`);
    L.push('');
  }

  L.push(`## 2. Autres événements de la base (${others.length}) — ne pas recréer`, '');
  const byTheme = {}; for (const e of others) { const t = e.themes?.[0] || 'sans-theme'; (byTheme[t] ||= []).push(e); }
  for (const [tid] of [...THEMES, ['sans-theme', 'Sans thème']]) {
    const list = byTheme[tid]; if (!list?.length) continue;
    L.push(`**${THEME_LABEL[tid] || 'Sans thème'}**`);
    for (const e of list) {
      const base = `- ${e.id} · ${e.date}→${lastActivity(e)} · ${SEV[e.severity]} · ${STATUS[e.status]} · ${line(e.title)}`;
      L.push(detail === 'full' ? `${base}\n  ${line(e.summary)}\n  Sources : ${(e.sources || []).map(s => s.url).join(' ')}` : base);
    }
    L.push('');
  }

  // Archive hors périmètre : identifiants des événements importants, pour les liens et pour éviter les recréations
  const arch = liveEvents(db).filter(e => !inScope(e, r) && e.severity !== 'moderate').sort((a, b) => lastActivity(a) < lastActivity(b) ? 1 : -1).slice(0, 400);
  if (arch.length) {
    L.push(`## 2 bis. Archive hors périmètre (${arch.length} événements critiques ou élevés les plus récents) — utilisables dans \`links\``, '');
    for (const e of arch) L.push(`- ${e.id} · ${STATUS[e.status]} · ${line(e.title)}`);
    L.push('');
  }
  const evIds = new Set(evs.map(e => e.id));
  const links = liveLinks(db).filter(l => evIds.has(l.from) || evIds.has(l.to));
  L.push(`## 3. Liens existants (${links.length})`, '');
  for (const l of links) L.push(`- ${l.from} —${l.type}→ ${l.to}`);
  if (!links.length) L.push('_Aucun._');
  L.push('');

  const br = latestBriefing(db);
  L.push(`## 4. Dernier briefing`, '');
  if (br) { L.push(`- ${br.date} — ${line(br.title || '')}`); if (br.watch?.length) L.push(`- Points de vigilance : ${br.watch.map(line).join(' | ')}`); }
  else L.push('_Aucun._');
  L.push('');

  L.push(`## 5. Dernières cotations connues`, '');
  for (const a of ASSETS) {
    const m = Object.values(db.markets).filter(x => x.asset === a.k).sort((x, y) => x.date < y.date ? 1 : -1)[0];
    L.push(`- ${a.k} : ${m ? `${m.close} au ${m.date}` : 'aucune'}`);
  }
  L.push('');
  const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([t]) => t);
  if (topTags.length) L.push(`## 6. Tags en usage (à réutiliser)`, '', topTags.join(', '), '');
  const notes = lb?.notes; if (notes) L.push(`## 7. Notes de la session précédente`, '', line(notes), '');
  return L.join('\n');
}

// ---------- Résumé lisible ----------
export function summaryMd(db, scope) {
  const r = scopeRange(scope);
  const evs = liveEvents(db).filter(e => inScope(e, r));
  const L = [];
  L.push(`# LiveWorld — Synthèse : ${r.label}`, '', `_Générée le ${fmtLong(today())} à partir de ${evs.length} événement(s)._`, '');
  const bySev = { critical: 0, high: 0, moderate: 0 }; evs.forEach(e => bySev[e.severity]++);
  L.push(`## Vue d'ensemble`, '', `- Critiques : ${bySev.critical} · Élevés : ${bySev.high} · Modérés : ${bySev.moderate}`);
  const byTheme = {}; evs.forEach(e => (e.themes || []).forEach(t => byTheme[t] = (byTheme[t] || 0) + 1));
  L.push(`- Par thème : ${Object.entries(byTheme).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${THEME_LABEL[t]} (${n})`).join(', ') || '—'}`, '');
  L.push(`## Événements majeurs`, '');
  const major = evs.filter(e => e.severity !== 'moderate').sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || (a.date < b.date ? -1 : 1));
  for (const e of major) {
    L.push(`### ${e.title}`, `_${e.date} · ${SEV[e.severity]} · ${STATUS[e.status]} · ${(e.themes || []).map(t => THEME_LABEL[t]).join(', ')} · ${e.location?.name || ''}_`, '', line(e.summary));
    const ups = (e.updates || []).filter(u => dayOf(u.at) >= r.from && dayOf(u.at) <= r.to).slice(-4);
    if (ups.length) { L.push(''); ups.forEach(u => L.push(`- ${dayOf(u.at)} : ${line(u.text)}`)); }
    const imps = currentImpacts(e); if (imps.length) L.push('', `Impacts : ${imps.map(i => `${i.sector} — ${DIR[i.direction]?.[0]} (${line(i.rationale)})`).join(' ; ')}`);
    L.push('', `Sources : ${(e.sources || []).slice(0, 4).map(s => `[${s.outlet}](${s.url})`).join(', ')}`, '');
  }
  const mods = evs.filter(e => e.severity === 'moderate');
  if (mods.length) { L.push(`## Autres faits notables`, ''); mods.sort((a, b) => a.date < b.date ? -1 : 1).forEach(e => L.push(`- ${e.date} — **${e.title}** : ${line(e.summary).slice(0, 220)}`)); L.push(''); }
  const ids = new Set(evs.map(e => e.id));
  const links = liveLinks(db).filter(l => LINK_TYPES[l.type].causal && ids.has(l.from) && ids.has(l.to));
  if (links.length) { L.push(`## Chaînes de causalité`, ''); links.forEach(l => L.push(`- ${db.events[l.from].title} → _${LINK_TYPES[l.type].fwd}_ → ${db.events[l.to].title}`)); L.push(''); }
  const brs = Object.values(db.briefings).filter(b => b.date >= r.from && b.date <= r.to).sort((a, b) => a.date < b.date ? -1 : 1);
  if (brs.length) { L.push(`## Briefings de la période`, ''); brs.forEach(b => { L.push(`### ${b.date} — ${b.title || 'Briefing'}`); if (b.macro) L.push(line(b.macro)); if (b.watch?.length) L.push('', 'À surveiller : ' + b.watch.join(' ; ')); L.push(''); }); }
  return L.join('\n');
}

// ---------- Sauvegarde ----------
export const backupJson = db => JSON.stringify({ schema: BACKUP_SCHEMA, exported_at: new Date().toISOString(), db }, null, 1);

// ---------- Prompts ----------
export function dailyPrompt(db, kind = 'daily', focus = '') {
  const lb = latestBatch(db);
  const last = lb ? lb.generated_at : 'aucun (première session : couvre les 7 derniers jours)';
  const date = fmtLong(today());
  const f = focus.trim() ? `Attention particulière cette fois : ${focus.trim()}.\n` : '';
  if (kind === 'extra') return `Session complémentaire LiveWorld du ${date} (une veille a déjà été faite aujourd'hui, voir le contexte joint).\nNe traite QUE ce qui s'est passé ou a été publié depuis ${last}.\n${f}Pas de nouveau briefing complet, sauf si un événement critique le justifie : dans ce cas, envoie un briefing avec le titre « Mise à jour ».\nLivre un seul fichier JSON liveworld.batch/v1.`;
  if (kind === 'deep') return `Approfondissement LiveWorld : ${focus.trim() || '<sujet ou id>'}.\nEn t'appuyant sur le contexte joint, enrichis cet événement : sources complémentaires, chronologie de fond (bloc timeline), chiffres clés, scénarios, diagramme du mécanisme, lectures utiles. Ajoute les liens vers les événements liés, même anciens.\nRéutilise l'id existant. Livre un seul fichier JSON liveworld.batch/v1.`;
  return `Veille LiveWorld du ${date}.\n\nLe fichier de contexte joint liste tout ce qui existe déjà dans le site (dernier lot importé : ${last}).\nFais la veille géopolitique et économique mondiale depuis ce dernier lot, en suivant tes instructions LiveWorld :\n1. mets à jour les fils actifs du contexte (nouveaux faits, nouvelles sources, changement de sévérité ou de statut) ;\n2. ajoute les nouveaux événements importants qui manquent, sur les 14 thèmes ;\n3. relie-les aux événements existants, même anciens, quand c'est pertinent ;\n4. ajoute le briefing du jour et les clôtures de marché.\n${f}Livre un seul fichier JSON liveworld.batch/v1, puis un compte rendu de 5 lignes.`;
}

// Fiche d'un seul événement, à coller dans une conversation
export function eventMd(db, e) {
  const v = snapshot(e); const ch = chainOf(db, e.id, 2);
  const L = [`## ${e.title} (${e.id})`, `${SEV[v.sev]} · ${STATUS[v.status]} · début ${e.date} · ${e.location?.name || ''}`, '', line(e.summary), ''];
  v.ups.slice().reverse().forEach(u => L.push(`- ${dayOf(u.at)} : ${line(u.text)}`));
  L.push('', 'Sources : ' + v.srcs.map(s => `${s.outlet} ${s.url}`).join(' ; '));
  const rel = [...ch.up.keys(), ...ch.down.keys(), ...ch.rel.map(r => r.other)];
  if (rel.length) L.push('', 'Événements liés : ' + rel.map(id => `${id} (${db.events[id]?.title})`).join(' ; '));
  return L.join('\n');
}
