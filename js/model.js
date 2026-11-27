// Modèle : états dans le temps, chaînes de causalité, validation et fusion des lots
import { SCHEMA, SEV, SEV_RANK, STATUS, THEME_LABEL, LINK_TYPES, DIR } from './config.js?v=202611272136';
import { dayOf, ts, addDays, diffDays, safeUrl, normUrl, hash, tokens, jaccard, norm, parseDate } from './util.js?v=202611272136';

const ID_RE = /^evt-\d{8}-[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const slugify = s => norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w.length > 1).slice(0, 6).join('-') || 'evenement';
export const isLive = e => e && !e._deleted && !e.merged_into && !e.deleted;

// ---------- Lecture dans le temps ----------
const atOrBefore = (s, D) => !D || (dayOf(s) || '0') <= D;
export function lastActivity(e, D = null) {
  let m = e.date || '';
  for (const u of e.updates || []) { const d = dayOf(u.at); if (d && atOrBefore(u.at, D) && d > m) m = d; }
  for (const s of e.sources || []) { const d = dayOf(s.published_at); if (d && atOrBefore(s.published_at, D) && d > m) m = d; }
  return m;
}
const logAt = (log, D, fallback) => {
  if (!log?.length) return fallback;
  let v = null; for (const x of log) if (atOrBefore(x.at, D)) v = x.v;
  return v ?? log[0].v ?? fallback;
};
export const currentImpacts = (e, D = null) => (e.impacts || []).filter(i => atOrBefore(i.added_at, D) && !(i.superseded_at && atOrBefore(i.superseded_at, D)));

// Vue d'un événement à la date D (null = état actuel)
export function snapshot(e, D = null) {
  return {
    e, id: e.id,
    sev: logAt(e.severity_log, D, e.severity),
    status: logAt(e.status_log, D, e.status || 'active'),
    srcs: (e.sources || []).filter(s => atOrBefore(s.published_at, D)).sort((a, b) => ts(b.published_at) - ts(a.published_at)),
    ups: (e.updates || []).filter(u => atOrBefore(u.at, D)).sort((a, b) => ts(b.at) - ts(a.at)),
    imps: currentImpacts(e, D),
    blocks: (e.blocks || []).filter(b => atOrBefore(b.added_at, D)),
    last: lastActivity(e, D),
  };
}

// Visible le jour D avec une fenêtre de W jours (ou 'all')
export function visibleAt(e, D, W) {
  if (!isLive(e) || !e.date || e.date > D) return null;
  const v = snapshot(e, D);
  if (!v.srcs.length) return null; // règle : jamais sans source datée
  if (W !== 'all') {
    const from = addDays(D, -(W - 1));
    if (v.last < from) return null;
    if (v.status === 'resolved' && e.ended_on && e.ended_on < from) return null;
  }
  return v;
}
export function visibleEvents(db, D, W, themes) {
  const out = [];
  for (const e of Object.values(db.events)) {
    if (themes?.size && !(e.themes || []).some(t => themes.has(t))) continue;
    const v = visibleAt(e, D, W); if (v) out.push(v);
  }
  return out.sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || (b.last > a.last ? 1 : b.last < a.last ? -1 : 0));
}
export const liveEvents = db => Object.values(db.events).filter(isLive);
export function dataRange(db) {
  let min = null, max = null;
  for (const e of liveEvents(db)) { const l = lastActivity(e); if (!min || e.date < min) min = e.date; if (!max || l > max) max = l; }
  return { min, max };
}

// ---------- Liens & chaînes ----------
export const liveLinks = db => Object.values(db.links).filter(l => !l._deleted && isLive(db.events[l.from]) && isLive(db.events[l.to]));
// Pour un lien causal : qui est en amont (up) et en aval (down)
export const updown = l => (l.type === 'responds_to' || l.type === 'follows') ? { up: l.to, down: l.from } : { up: l.from, down: l.to };

export function chainOf(db, id, depth = 4) {
  const links = liveLinks(db);
  const up = new Map(), down = new Map(), rel = [];
  const walk = (start, dir, map) => {
    let frontier = [start];
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next = [];
      for (const n of frontier) for (const l of links) {
        if (!LINK_TYPES[l.type]?.causal) continue;
        const { up: u, down: w } = updown(l);
        const other = dir === 'up' ? (w === n ? u : null) : (u === n ? w : null);
        if (other && other !== start && !map.has(other)) { map.set(other, { depth: d, link: l, via: n }); next.push(other); }
      }
      frontier = next;
    }
  };
  walk(id, 'up', up); walk(id, 'down', down);
  for (const l of links) if (!LINK_TYPES[l.type]?.causal && (l.from === id || l.to === id)) rel.push({ other: l.from === id ? l.to : l.from, link: l });
  return { up, down, rel };
}

// ---------- Validation d'un lot ----------
export function parseInput(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  if (!t.startsWith('{') && !t.startsWith('[')) { const i = t.indexOf('{'); const j = t.lastIndexOf('}'); if (i >= 0 && j > i) t = t.slice(i, j + 1); }
  const v = JSON.parse(t);
  return Array.isArray(v) ? v : [v];
}

function cleanSource(s, warn, eid) {
  const url = safeUrl(s?.url);
  const pub = s?.published_at && parseDate(s.published_at);
  if (!url || !pub || !s.outlet) { warn.push(`${eid} : source ignorée (${!url ? 'URL https manquante' : !pub ? 'date de publication manquante' : 'média manquant'})`); return null; }
  return { outlet: String(s.outlet).slice(0, 80), title: s.title ? String(s.title).slice(0, 300) : '', url, published_at: String(s.published_at), lang: s.lang || undefined };
}
function cleanEvent(raw, warn) {
  const e = { ...raw };
  if (e.severity && !SEV[e.severity]) { warn.push(`${raw.id} : sévérité « ${e.severity} » inconnue, ignorée`); delete e.severity; }
  if (e.status && !STATUS[e.status]) { warn.push(`${raw.id} : statut « ${e.status} » inconnu, ignoré`); delete e.status; }
  if (e.date && !DATE_RE.test(e.date)) { const d = dayOf(e.date); if (d) e.date = d; else delete e.date; }
  if (e.themes) { const bad = e.themes.filter(t => !THEME_LABEL[t]); if (bad.length) warn.push(`${raw.id} : thème(s) inconnu(s) ignoré(s) : ${bad.join(', ')}`); e.themes = e.themes.filter(t => THEME_LABEL[t]); }
  if (e.location) {
    const { lat, lng } = e.location;
    if (!(typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) { warn.push(`${raw.id} : coordonnées invalides, pas de repère sur la carte`); delete e.location; }
  }
  e.sources = (e.sources || []).map(s => cleanSource(s, warn, raw.id)).filter(Boolean);
  e.updates = (e.updates || []).filter(u => u && u.text && parseDate(u.at)).map(u => ({ at: String(u.at), text: String(u.text).slice(0, 600), severity: SEV[u.severity] ? u.severity : undefined, source_url: safeUrl(u.source_url) || undefined }));
  e.impacts = (e.impacts || []).filter(i => i && i.sector && DIR[i.direction] && i.rationale);
  e.blocks = (e.blocks || []).filter(b => b && typeof b === 'object' && b.type);
  return e;
}

// Doublons probables : titres proches et dates voisines, ou source commune
export function findDuplicate(db, e, extra = []) {
  const tk = tokens(e.title + ' ' + (e.location?.name || ''));
  const urls = new Set((e.sources || []).map(s => normUrl(s.url)));
  let best = null;
  for (const x of [...liveEvents(db), ...extra]) {
    if (x.id === e.id) continue;
    const shared = (x.sources || []).some(s => urls.has(normUrl(s.url)));
    const close = e.date && x.date ? Math.abs(diffDays(e.date, x.date)) <= 5 : false;
    const sim = jaccard(tk, tokens(x.title + ' ' + (x.location?.name || '')));
    const score = shared ? 1 + sim : (close && sim >= 0.45 ? sim : 0);
    const samePlace = close && Math.abs(diffDays(e.date, x.date)) <= 2 && e.location?.name && norm(e.location.name) === norm(x.location?.name || '');
    if (score && (!best || score > best.score)) best = { id: x.id, title: x.title, score, shared, samePlace };
  }
  return best;
}

export function analyzeBatch(raw, db) {
  const fatal = [], warn = [];
  if (!raw || typeof raw !== 'object') return { fatal: ['Contenu illisible.'], warnings: [], events: [] };
  if (raw.schema !== SCHEMA) {
    if (raw.schema === 'liveworld.backup/v1') return { fatal: ['Ceci est une sauvegarde complète : utilisez Réglages → Restaurer une sauvegarde.'], warnings: [], events: [] };
    warn.push(`Champ « schema » absent ou différent de ${SCHEMA} : import tenté quand même.`);
  }
  const generated_at = raw.generated_at && parseDate(raw.generated_at) ? raw.generated_at : new Date().toISOString();
  if (!raw.generated_at) warn.push('generated_at absent : date d’import utilisée.');
  const batch_id = String(raw.batch_id || generated_at.replace(/[:.]/g, '-').slice(0, 16) + '-claude').replace(/[\/\s]/g, '-');
  const alreadyImported = !!db.batches[batch_id];
  const events = [];
  const batchNew = [];
  const seen = new Set();
  const aliasOf = {}; for (const x of Object.values(db.events)) for (const a of x.aliases || []) aliasOf[a] = x.id;
  for (const r0 of raw.events || []) {
    const reasons = [];
    let r = r0 && typeof r0 === 'object' ? { ...r0 } : null;
    if (!r) { events.push({ kind: 'rejected', inc: r0, reasons: ['Entrée illisible'] }); continue; }
    if (!r.id || !ID_RE.test(r.id)) {
      if (r.id && db.events[r.id]) { /* id existant hors format : accepté */ }
      else if (r.title && (r.date || '').match(/^\d{4}-\d{2}-\d{2}/)) {
        const nid = `evt-${r.date.slice(0, 10).replace(/-/g, '')}-${slugify(r.title)}`;
        warn.push(`Identifiant « ${r.id || '(absent)'} » invalide : remplacé par ${nid}`); r.id = nid;
      } else { events.push({ kind: 'rejected', inc: r, reasons: ['Identifiant invalide et pas de titre/date pour en créer un'] }); continue; }
    }
    const e = cleanEvent(r, warn);
    if (!db.events[e.id] && aliasOf[e.id] && !e.merge_into) { reasons.push(`identifiant déjà fusionné dans ${aliasOf[e.id]}`); e.id = aliasOf[e.id]; delete e.title; delete e.date; delete e.location; }
    const exists = db.events[e.id];
    if (e.merge_into) {
      if (!(db.events[e.merge_into] || (raw.events || []).some(x => x?.id === e.merge_into))) { events.push({ kind: 'rejected', inc: e, reasons: [`Fusion impossible : ${e.merge_into} introuvable`] }); continue; }
      if (!exists) { events.push({ kind: 'rejected', inc: e, reasons: [`Fusion impossible : ${e.id} n’existe pas dans la base`] }); continue; }
      events.push({ kind: 'merge', inc: e, reasons }); continue;
    }
    if (exists && isLive(exists) || seen.has(e.id)) { events.push({ kind: 'update', inc: e, reasons, existing: exists }); seen.add(e.id); continue; }
    if (exists?.merged_into) { events.push({ kind: 'update', inc: { ...e, id: exists.merged_into }, reasons: [`Redirigé vers ${exists.merged_into} (fusionné)`], existing: db.events[exists.merged_into] }); continue; }
    // Nouvel événement : champs obligatoires
    if (!e.title) reasons.push('titre manquant');
    if (!e.date) reasons.push('date de début manquante');
    if (!e.severity) reasons.push('sévérité manquante');
    if (!e.sources.length) reasons.push('aucune source valide (outlet, url https, published_at)');
    if (reasons.length) { events.push({ kind: 'rejected', inc: e, reasons }); continue; }
    if (!e.themes?.length) warn.push(`${e.id} : aucun thème valide`);
    if (!e.location) warn.push(`${e.id} : pas de localisation, l’événement n’apparaîtra pas sur la carte`);
    const dup = findDuplicate(db, e, batchNew);
    seen.add(e.id); batchNew.push(e);
    events.push(dup ? { kind: 'dup', inc: e, dupOf: dup, decision: dup.shared || dup.score >= 0.6 || dup.samePlace ? 'merge' : 'separate', reasons } : { kind: 'new', inc: e, reasons });
  }
  const ids = new Set([...Object.keys(db.events), ...events.filter(x => x.kind !== 'rejected').map(x => x.inc.id)]);
  const links = { valid: [], skipped: [] };
  for (const l of raw.links || []) {
    if (!l?.from || !l?.to || !LINK_TYPES[l.type]) { links.skipped.push({ l, reason: 'type ou extrémité invalide' }); continue; }
    if (l.from === l.to) { links.skipped.push({ l, reason: 'lien vers lui-même' }); continue; }
    if (!ids.has(l.from) || !ids.has(l.to)) { links.skipped.push({ l, reason: `événement inconnu (${!ids.has(l.from) ? l.from : l.to})` }); continue; }
    links.valid.push(l);
  }
  links.skipped.forEach(s => warn.push(`Lien ignoré ${s.l?.from} → ${s.l?.to} : ${s.reason}`));
  const markets = (raw.markets || []).filter(m => m && DATE_RE.test(m.date) && m.asset && typeof m.close === 'number');
  if ((raw.markets || []).length !== markets.length) warn.push(`${(raw.markets || []).length - markets.length} cotation(s) invalide(s) ignorée(s)`);
  let briefing = raw.briefing && raw.briefing.date ? { ...raw.briefing, date: dayOf(raw.briefing.date) } : null;
  if (briefing) briefing.top = (briefing.top || []).filter(t => t?.event_id && ids.has(t.event_id));
  return { fatal, warnings: warn, meta: { batch_id, generated_at, request: raw.request || '', coverage: raw.coverage || null, notes: raw.notes || '', author: raw.author || 'claude' }, alreadyImported, events, links, briefing, markets, demo: !!raw._demo };
}

// ---------- Fusion ----------
const pushLog = (log, at, v) => { if (!v) return log; if (log.length && log[log.length - 1].v === v) return log; return [...log, { at, v }].sort((a, b) => ts(a.at) - ts(b.at)); };
const blockHash = b => { const { id, added_at, batch, _h, ...rest } = b; return hash(JSON.stringify(rest)); };

export function mergeEvent(ex, inc, meta) {
  const at = meta.generated_at, batch = meta.batch_id;
  const diff = { sources: 0, updates: 0, blocks: 0, blocksReplaced: 0, impacts: 0, fields: [] };
  const e = ex ? structuredClone(ex) : {
    id: inc.id, title: inc.title, summary: inc.summary || '', date: inc.date, status: inc.status || 'active', severity: inc.severity,
    themes: [], tags: [], location: inc.location || null, sources: [], updates: [], impacts: [], blocks: [],
    severity_log: [], status_log: [], history: [], created_at: at, batches: [], demo: meta.demo || undefined,
  };
  const isNew = !ex;
  // Champs simples : la valeur la plus récente gagne, l'ancienne part dans l'historique
  for (const f of ['title', 'summary', 'date', 'ended_on', 'location']) {
    if (inc[f] === undefined || inc[f] === null || inc[f] === '') continue;
    if (JSON.stringify(e[f]) !== JSON.stringify(inc[f])) { if (!isNew) { e.history.push({ at, batch, field: f, from: e[f] ?? null }); diff.fields.push(f); } e[f] = inc[f]; }
  }
  // Sources (dédoublonnées par URL)
  const urls = new Set(e.sources.map(s => normUrl(s.url)));
  for (const s of inc.sources || []) { const k = normUrl(s.url); if (urls.has(k)) continue; urls.add(k); e.sources.push({ ...s, added_at: at, batch }); diff.sources++; }
  // Mises à jour (dédoublonnées par date + texte)
  const uk = new Set(e.updates.map(u => u.k));
  for (const u of inc.updates || []) { const k = hash(dayOf(u.at) + '|' + norm(u.text)); if (uk.has(k)) continue; uk.add(k); e.updates.push({ ...u, k, added_at: at, batch }); diff.updates++; }
  e.updates.sort((a, b) => ts(a.at) - ts(b.at));
  // Sévérité et statut : journal daté pour la Time-Machine
  if (isNew) {
    for (const u of e.updates) if (u.severity) e.severity_log = pushLog(e.severity_log, u.at, u.severity);
    if (!e.severity_log.length) e.severity_log = [{ at: e.date, v: inc.severity }];
    const st = inc.status || 'active';
    e.status_log = st === 'active' ? [{ at: e.date, v: 'active' }]
      : st === 'resolved' ? [{ at: e.date, v: 'active' }, { at: inc.ended_on || lastActivity(e) || at, v: 'resolved' }]
      : [{ at: e.date, v: 'active' }, { at: lastActivity(e) || at, v: st }];
  } else for (const u of inc.updates || []) if (u.severity) e.severity_log = pushLog(e.severity_log, u.at, u.severity);
  if (inc.severity && (isNew ? e.severity_log.at(-1).v !== inc.severity : inc.severity !== e.severity)) {
    if (!isNew) { e.history.push({ at, batch, field: 'severity', from: e.severity }); diff.fields.push('severity'); }
    e.severity_log = pushLog(e.severity_log, at, inc.severity);
  }
  e.severity = e.severity_log.at(-1)?.v || inc.severity || e.severity;
  if (!isNew && inc.status && inc.status !== e.status) { e.history.push({ at, batch, field: 'status', from: e.status }); diff.fields.push('status'); e.status_log = pushLog(e.status_log, inc.status === 'resolved' && inc.ended_on ? inc.ended_on : at, inc.status); e.status = inc.status; }
  // Thèmes et étiquettes : union
  for (const t of inc.themes || []) if (!e.themes.includes(t)) { e.themes.push(t); if (!isNew) diff.fields.push('themes'); }
  for (const t of inc.tags || []) { const v = String(t).toLowerCase().slice(0, 40); if (!e.tags.includes(v)) e.tags.push(v); }
  // Impacts : le plus récent par secteur remplace l'ancien (conservé avec superseded_at)
  for (const i of inc.impacts || []) {
    const cur = e.impacts.find(x => !x.superseded_at && norm(x.sector) === norm(i.sector));
    if (cur && cur.direction === i.direction && norm(cur.rationale) === norm(i.rationale)) continue;
    if (cur) cur.superseded_at = at;
    e.impacts.push({ sector: String(i.sector), direction: i.direction, horizon: i.horizon, confidence: i.confidence, rationale: String(i.rationale), added_at: at, batch }); diff.impacts++;
  }
  // Blocs : même id → remplacé ; sans id → ajouté s'il est nouveau
  const hashes = new Set(e.blocks.map(b => b._h));
  for (const b of inc.blocks || []) {
    const h = blockHash(b);
    if (b.id) {
      const i = e.blocks.findIndex(x => x.id === b.id);
      if (i >= 0) { if (e.blocks[i]._h === h) continue; e.blocks[i] = { ...b, _h: h, added_at: at, batch }; diff.blocksReplaced++; continue; }
    } else if (hashes.has(h)) continue;
    hashes.add(h); e.blocks.push({ ...b, _h: h, added_at: at, batch }); diff.blocks++;
  }
  if (!e.batches.includes(batch)) e.batches.push(batch);
  e.updated_at = at;
  return { doc: e, diff };
}

export function eventLinks(inc) {
  const out = [];
  for (const p of inc.parents || []) out.push({ from: p, to: inc.id, type: 'causes', confidence: 'medium', rationale: '' });
  for (const r of inc.related || []) out.push({ from: inc.id, to: r, type: 'relates_to', confidence: 'medium', rationale: '' });
  return out;
}
export const linkId = l => `${l.from}__${l.to}__${l.type}`;

// Applique un lot analysé. decisions : { [id]: 'merge' | 'separate' } pour les doublons
export function applyBatch(db, an, decisions = {}) {
  const meta = { ...an.meta, demo: an.demo };
  const work = {}; const get = id => work[id] || db.events[id];
  const linkWork = {}; const changes = { events: [], links: [], briefings: [], markets: [], batches: [] };
  const counts = { new: 0, updated: 0, merged: 0, rejected: 0, links: 0, markets: 0 };
  const alias = {};
  const addLink = (l, origin = 'claude') => {
    const from = alias[l.from] || l.from, to = alias[l.to] || l.to;
    if (from === to) return;
    const id = linkId({ from, to, type: l.type });
    const ex = linkWork[id] || db.links[id];
    if (ex && !ex._deleted) { if (l.rationale && !ex.rationale) linkWork[id] = { ...ex, rationale: l.rationale }; return; }
    linkWork[id] = { id, from, to, type: l.type, confidence: l.confidence || 'medium', rationale: l.rationale || '', origin, added_at: meta.generated_at, batch: meta.batch_id };
    counts.links++;
  };
  for (const x of an.events) {
    if (x.kind === 'rejected') { counts.rejected++; continue; }
    if (x.kind === 'merge') continue;
    let inc = x.inc;
    let aliasFrom = null;
    if (x.kind === 'dup' && (decisions[inc.id] ?? x.decision) === 'merge') {
      alias[inc.id] = x.dupOf.id; aliasFrom = inc.id;
      const target = get(x.dupOf.id);
      inc = { ...inc, id: x.dupOf.id, title: undefined, date: undefined, location: undefined, summary: target?.summary ? undefined : inc.summary };
    }
    const ex = get(inc.id);
    const { doc } = mergeEvent(ex && isLive(ex) ? ex : null, inc, meta);
    if (aliasFrom && !(doc.aliases ||= []).includes(aliasFrom)) doc.aliases.push(aliasFrom);
    work[doc.id] = doc;
    if (ex) counts.updated++; else counts.new++;
  }
  for (const x of an.events) for (const l of x.kind === 'rejected' ? [] : eventLinks(x.inc)) if (get(alias[l.from] || l.from) && get(alias[l.to] || l.to)) addLink(l);
  // Fusions de doublons signalées par Claude
  for (const x of an.events.filter(x => x.kind === 'merge')) {
    const src = get(x.inc.id), target = get(x.inc.merge_into);
    if (!src || !target) continue;
    const { doc } = mergeEvent(target, { ...src, id: target.id, title: undefined, summary: undefined, date: undefined, location: undefined, severity: undefined, status: undefined }, meta);
    (doc.aliases ||= []).push(src.id, ...(src.aliases || []));
    work[target.id] = doc; work[src.id] = { ...src, merged_into: target.id, updated_at: meta.generated_at };
    for (const l of Object.values(db.links)) if (!l._deleted && (l.from === src.id || l.to === src.id)) {
      linkWork[l.id] = { id: l.id, _deleted: true };
      addLink({ ...l, from: l.from === src.id ? target.id : l.from, to: l.to === src.id ? target.id : l.to }, l.origin);
    }
    counts.merged++;
  }
  for (const l of an.links.valid) addLink(l);
  if (an.briefing) {
    const b = { ...an.briefing, id: `${an.briefing.date}__${meta.batch_id}`, batch: meta.batch_id, generated_at: meta.generated_at, demo: meta.demo || undefined };
    b.top = (b.top || []).map(t => ({ ...t, event_id: alias[t.event_id] || t.event_id }));
    b.blocks = (b.blocks || []).map(x => ({ ...x, added_at: meta.generated_at }));
    changes.briefings.push(b);
  }
  for (const m of an.markets) { changes.markets.push({ id: `${m.date}__${m.asset}`, date: m.date, asset: String(m.asset).toUpperCase(), close: m.close, change_pct: typeof m.change_pct === 'number' ? m.change_pct : null, source_url: safeUrl(m.source_url) || null, batch: meta.batch_id }); counts.markets++; }
  changes.events = Object.values(work);
  changes.links = Object.values(linkWork);
  changes.batches.push({ id: meta.batch_id, generated_at: meta.generated_at, imported_at: new Date().toISOString(), request: meta.request, coverage: meta.coverage, notes: meta.notes, author: meta.author, counts, demo: meta.demo || undefined, reimport: an.alreadyImported || undefined });
  return { changes, counts };
}

// Résumé lisible d'un événement en préparation d'import
export function previewDiff(db, x) {
  if (x.kind === 'rejected' || x.kind === 'merge') return '';
  const ex = x.kind === 'dup' ? db.events[x.dupOf.id] : x.existing;
  if (!ex) return [`${x.inc.sources.length} source(s)`, `${x.inc.updates.length} mise(s) à jour`, x.inc.blocks.length ? `${x.inc.blocks.length} bloc(s)` : '', x.inc.impacts.length ? `${x.inc.impacts.length} impact(s)` : ''].filter(Boolean).join(' · ');
  const { diff } = mergeEvent(ex, x.inc, { generated_at: new Date().toISOString(), batch_id: 'preview' });
  const parts = [];
  if (diff.sources) parts.push(`+${diff.sources} source(s)`);
  if (diff.updates) parts.push(`+${diff.updates} mise(s) à jour`);
  if (diff.blocks) parts.push(`+${diff.blocks} bloc(s)`);
  if (diff.blocksReplaced) parts.push(`${diff.blocksReplaced} bloc(s) remplacé(s)`);
  if (diff.impacts) parts.push(`${diff.impacts} impact(s) révisé(s)`);
  if (x.inc.severity && x.inc.severity !== ex.severity) parts.push(`sévérité : ${SEV[ex.severity]} → ${SEV[x.inc.severity]}`);
  if (x.inc.status && x.inc.status !== ex.status) parts.push(`statut : ${STATUS[ex.status]} → ${STATUS[x.inc.status]}`);
  for (const f of diff.fields.filter(f => !['severity', 'status', 'themes'].includes(f))) parts.push(`${{ title: 'titre', summary: 'résumé', date: 'date', ended_on: 'date de fin', location: 'lieu' }[f] || f} modifié`);
  return parts.join(' · ') || 'rien de nouveau';
}
