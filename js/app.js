// LiveWorld — application principale
import { THEMES, THEME_LABEL, SEV, SEV_RANK, STATUS, DIR, HORIZON, CONF, LINK_TYPES, WINDOWS, BACKUP_SCHEMA, ASSETS } from './config.js?v=202611260959';
import { $, $$, esc, extLink, safeUrl, md, mdText, today, addDays, dayOf, fmtDay, fmtLong, fmtDT, ts, norm, download, copyText, readFile, fmtNum, plural, diffDays } from './util.js?v=202611260959';
import { LocalStore, FirebaseStore, emptyDb, COLLECTIONS, ROLES, USERNAME_RE } from './store.js?v=202611260959';
import { snapshot, visibleAt, visibleEvents, liveEvents, lastActivity, chainOf, liveLinks, isLive, analyzeBatch, applyBatch, parseInput, previewDiff, linkId, dataRange } from './model.js?v=202611260959';
import { renderBlocks, hydrate, mapPoints } from './blocks.js?v=202611260959';
import { WorldMap } from './map.js?v=202611260959';
import { exchangesStatus, quotesAt, liveQuotes } from './markets.js?v=202611260959';
import { contextMd, summaryMd, backupJson, dailyPrompt, eventMd, scopeRange } from './exporter.js?v=202611260959';

const pref = { get(k, d) { try { const v = localStorage.getItem('lw:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('lw:' + k, JSON.stringify(v)); } catch {} } };
const S = { role: 'local', db: emptyDb(), store: null, D: today(), W: pref.get('window', 7), themes: new Set(), sel: null, tab: 'dossier', fSev: 'all', fStatus: 'all', fSort: 'sev', live: {}, mini: null, miniDirty: true };

// ---------- Droits ----------
// local : mode sans Firebase (tous les droits) · admin · editor · reader (lecture seule)
const canWrite = () => ['local', 'admin', 'editor'].includes(S.role);
const isAdmin = () => S.role === 'admin';
const displayName = p => p?.username === 'admin' ? 'Admin' : (p?.username || '');

// ---------- Utilitaires d'interface ----------
const sevTag = s => `<span class="sev ${esc(s)}">${esc(SEV[s] || s)}</span>`;
const isDemoUrl = u => /^https:\/\/example\.org\/demo\//.test(u || '');
function toast(msg, kind = '') { const t = document.createElement('div'); t.className = 'toast ' + kind; t.innerHTML = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 6000); }
const modal = $('#modal');
function openModal(title, html, onReady) { $('#mTitle').textContent = title; $('#mBody').innerHTML = html; if (!modal.open) modal.showModal(); onReady?.($('#mBody')); }
const closeModal = () => modal.open && modal.close();
$('#mClose').onclick = closeModal;
modal.addEventListener('click', e => { if (e.target === modal && !modal.dataset.locked) closeModal(); });
modal.addEventListener('cancel', e => { if (modal.dataset.locked) e.preventDefault(); });
function confirmBox(title, text, okLabel, cb, danger = true) {
  openModal(title, `<p>${text}</p><div class="row"><button class="btn ${danger ? 'danger' : 'pri'}" id="cOk">${esc(okLabel)}</button><button class="btn" id="cNo">Annuler</button></div>`, b => { $('#cOk', b).onclick = () => { closeModal(); cb(); }; $('#cNo', b).onclick = closeModal; });
}
async function save(changes, msg) {
  try { await S.store.save(changes); S.db = S.store.db; S.miniDirty = true; if (msg) toast(msg, 'ok'); renderAll(); return true; }
  catch (e) { console.error(e); toast('Enregistrement impossible : ' + esc(e.message || e), 'err'); return false; }
}

// ---------- En-tête & Time-Machine ----------
function setDate(d) { S.D = d > today() ? today() : d; renderAll(); }
$('#prevDay').onclick = () => setDate(addDays(S.D, -1));
$('#nextDay').onclick = () => setDate(addDays(S.D, 1));
$('#todayBtn').onclick = () => setDate(today());
$('#cal').onchange = e => { if (e.target.value) setDate(e.target.value); };
function renderHeader() {
  const isToday = S.D === today();
  $('#live').classList.toggle('past', !isToday);
  $('#liveTxt').textContent = isToday ? 'Aujourd’hui' : 'Archive · ' + fmtDay(S.D, { day: 'numeric', month: 'short', year: 'numeric' });
  $('#cal').value = S.D; $('#cal').max = today();
  $('#nextDay').disabled = isToday; $('#todayBtn').setAttribute('aria-pressed', isToday);
  $('#win').innerHTML = WINDOWS.map(([w, l]) => `<button class="chip" data-w="${w}" aria-pressed="${S.W === w}">${l}</button>`).join('');
  $$('#win [data-w]').forEach(b => b.onclick = () => { S.W = b.dataset.w === 'all' ? 'all' : +b.dataset.w; pref.set('window', S.W); renderAll(); });
  const counts = {}; for (const e of liveEvents(S.db)) for (const t of e.themes || []) counts[t] = (counts[t] || 0) + 1;
  $('#themeChips').innerHTML = `<button class="chip" data-th="" aria-pressed="${!S.themes.size}">Tous les thèmes</button>` + THEMES.filter(([id]) => counts[id] || S.themes.has(id)).map(([id, l]) => `<button class="chip" data-th="${id}" aria-pressed="${S.themes.has(id)}">${esc(l)}</button>`).join('');
  $$('#themeChips [data-th]').forEach(b => b.onclick = () => toggleTheme(b.dataset.th));
  $('#importBtn').hidden = !canWrite();
  const unseen = Object.values(S.db.batches).filter(b => ts(b.imported_at) > pref.get('seenBatches', 0)).length;
  $('#badge').textContent = unseen || '';
}
function toggleTheme(id, only = false) { if (!id) S.themes.clear(); else if (only) { S.themes = new Set([id]); } else S.themes.has(id) ? S.themes.delete(id) : S.themes.add(id); renderAll(); }

// ---------- Marchés ----------
function renderTicker() {
  const isToday = S.D === today();
  $('#ticker').innerHTML = quotesAt(S.db, S.D).map(a => {
    const live = isToday && S.live[a.k]; const q = live || a.q;
    if (!q) return `<div class="tk na"><span>${a.n}</span><strong>—</strong><em class="meta">aucune donnée</em></div>`;
    const c = q.change_pct; const cls = c == null ? 'meta' : c >= 0 ? 'pos' : 'neg';
    const ctext = c == null ? '' : a.bp ? `${c >= 0 ? '+' : ''}${fmtNum(c, 0)} pb` : `${c >= 0 ? '+' : ''}${fmtNum(c, 2)} %`;
    const when = live ? 'direct · ' + live.live : (q.date === S.D ? 'clôture' : 'au ' + fmtDay(q.date, { day: 'numeric', month: 'short' }));
    return `<div class="tk" title="${esc(when)}"><span>${a.n}</span><strong>${fmtNum(q.close, a.dp)}${a.unit || ''}</strong><em class="${cls}">${ctext} <span class="meta">${esc(when)}</span></em></div>`;
  }).join('');
}
function renderEx() { $('#ex').innerHTML = exchangesStatus().map(s => `<span><i class="dot ${s.c}"></i><b>${s.n}</b> ${s.t} <small>${s.h}</small></span>`).join(''); }
async function refreshLive() { try { S.live = await liveQuotes(); renderTicker(); } catch {} }

// ---------- Carte ----------
let map;
function renderMap() {
  const vis = visibleEvents(S.db, S.D, S.W, S.themes);
  $('#cnt').textContent = vis.length;
  $('#cntTxt').textContent = S.W === 'all' ? 'événements jusqu’à cette date' : `actifs sur ${S.W === 1 ? '1 jour' : S.W + ' jours'}`;
  let ghosts = [], arcs = [], points = [];
  if (S.sel && S.db.events[S.sel]) {
    const ch = chainOf(S.db, S.sel, 2);
    const nodes = new Set([S.sel, ...ch.up.keys(), ...ch.down.keys(), ...ch.rel.map(r => r.other)]);
    const visIds = new Set(vis.map(v => v.id));
    for (const id of nodes) if (!visIds.has(id)) { const e = S.db.events[id]; if (isLive(e)) ghosts.push(snapshot(e, e.date <= S.D ? S.D : null)); }
    for (const l of liveLinks(S.db)) if (nodes.has(l.from) && nodes.has(l.to)) arcs.push([S.db.events[l.from], S.db.events[l.to], LINK_TYPES[l.type].causal]);
    points = mapPoints(snapshot(S.db.events[S.sel], S.D >= S.db.events[S.sel].date ? S.D : null).blocks);
  }
  map?.render({ events: vis, ghosts, arcs, points, sel: S.sel });
  return vis;
}
$('#zin').onclick = () => map.zoomBy(1.6); $('#zout').onclick = () => map.zoomBy(1 / 1.6); $('#zreset').onclick = () => map.reset();

// ---------- Panneau latéral ----------
$$('.tabs [data-t]').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderPane(); });
function select(id, { jump = false, focus = false } = {}) {
  let e = S.db.events[id]; if (e?.merged_into) { id = e.merged_into; e = S.db.events[id]; }
  if (!e) return;
  S.sel = id; S.tab = 'dossier';
  if (jump && !visibleAt(e, S.D, S.W)) S.D = lastActivity(e) || e.date;
  renderAll();
  if (focus && e.location) map.focus(e.location.lng, e.location.lat);
  if (innerWidth <= 980) $('.side').scrollIntoView({ behavior: 'smooth' });
}
function srcItem(s) {
  const demo = isDemoUrl(s.url);
  return `<li><span class="o">${esc(s.outlet)}</span><time>${esc(fmtDT(s.published_at))}</time>${demo ? '<span class="demo">DÉMO</span>' : ''}<br>${demo ? `<span class="meta">${esc(s.title || 'Article de démonstration')}</span>` : extLink(s.url, s.title || s.url)}</li>`;
}
const impCard = (i, ev) => `<div><span class="dir ${DIR[i.direction]?.[1] || 'vol'}">${DIR[i.direction]?.[0] || esc(i.direction)}</span><b>${esc(i.sector)}</b><br>${esc(i.rationale)}<br><span class="meta">${[i.horizon ? 'horizon : ' + HORIZON[i.horizon] : '', i.confidence ? 'confiance ' + CONF[i.confidence] : ''].filter(Boolean).join(' · ')}</span>${ev ? `<br><button class="lnk" data-go="${esc(ev.id)}">↳ ${esc(ev.e.title)}</button>` : ''}</div>`;
const evButton = (v, extra = '') => `<button data-go="${esc(v.id)}">${sevTag(v.sev)}<span class="t">${esc(v.e.title)}</span><span class="m">${esc(v.e.location?.name || 'Sans lieu')} · ${(v.e.themes || []).slice(0, 2).map(t => esc(THEME_LABEL[t])).join(', ')} · activité ${esc(fmtDay(v.last, { day: 'numeric', month: 'short' }))} · ${plural(v.srcs.length, 'source')}</span>${extra}</button>`;

function chainItem(id, info, dirLabel) {
  const e = S.db.events[id]; if (!e) return '';
  const l = info.link, lt = LINK_TYPES[l.type];
  return `<div class="ci"><button class="go" data-go="${esc(id)}">${sevTag(snapshot(e).sev)} ${esc(e.title)}</button>${canWrite() ? `<button class="x" data-unlink="${esc(l.id)}" aria-label="Supprimer ce lien" title="Supprimer ce lien">×</button>` : ''}<span class="meta"><span class="rel-type">${esc(dirLabel(lt))}</span> · ${esc(fmtDay(e.date, { day: 'numeric', month: 'short', year: 'numeric' }))}${info.depth > 1 ? ` · via ${esc(S.db.events[info.via]?.title?.slice(0, 40) || '')}…` : ''}${l.rationale ? ' · ' + esc(l.rationale) : ''}${l.origin === 'manuel' ? ' · ajouté manuellement' : ''}</span></div>`;
}

function paneDossier() {
  const e = S.sel && S.db.events[S.sel];
  if (!e || !isLive(e)) return paneOverview();
  const inRange = e.date <= S.D;
  const v = snapshot(e, inRange ? S.D : null);
  const visible = visibleAt(e, S.D, S.W);
  const ch = chainOf(S.db, e.id, 4);
  const sortByDate = m => [...m.entries()].sort((a, b) => S.db.events[a[0]].date < S.db.events[b[0]].date ? -1 : 1);
  let banner = '';
  if (!inRange) banner = `<div class="banner">Cet événement commence le ${esc(fmtLong(e.date))}, après la date affichée. <button class="lnk" data-jump="${esc(e.date)}">Aller à cette date</button></div>`;
  else if (!visible) banner = `<div class="banner">Hors de la fenêtre d’activité affichée (dernière activité le ${esc(fmtDay(v.last, { day: 'numeric', month: 'long', year: 'numeric' }))}). <button class="lnk" data-jump="${esc(v.last)}">Aller à cette date</button></div>`;
  if (!inRange || S.D !== today()) banner += inRange ? `<div class="meta" style="margin-bottom:8px">État de la fiche au ${esc(fmtLong(S.D))}.</div>` : '';
  const hist = (e.history || []).slice().reverse();
  const batches = (e.batches || []).map(id => S.db.batches[id]).filter(Boolean);
  return `${banner}
  <div class="row" style="margin-top:0">${sevTag(v.sev)}<span class="st">${esc(STATUS[v.status])}</span><span class="meta">${esc(e.location?.name || 'Sans localisation')}</span></div>
  <h2>${esc(e.title)}</h2>
  <p class="meta">Début : ${esc(fmtDay(e.date, { day: 'numeric', month: 'long', year: 'numeric' }))} · dernière activité : ${esc(fmtDay(v.last, { day: 'numeric', month: 'long' }))}${e.ended_on ? ' · fin : ' + esc(fmtDay(e.ended_on, { day: 'numeric', month: 'long' })) : ''}</p>
  <div class="tags">${(e.themes || []).map(t => `<button class="tag" data-theme="${esc(t)}">${esc(THEME_LABEL[t] || t)}</button>`).join('')}${(e.tags || []).map(t => `<button class="tag" data-q="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
  <p>${esc(e.summary)}</p>
  ${v.blocks.length ? `<h3>Analyse</h3><div class="blocks">${renderBlocks(v.blocks)}</div>` : ''}
  <h3>Sources vérifiées (${v.srcs.length})</h3><ul class="src">${v.srcs.map(srcItem).join('') || '<li class="meta">Aucune source à cette date.</li>'}</ul>
  <h3>Chronologie des mises à jour</h3><ul class="tl">${v.ups.map(u => `<li class="${esc(u.severity || '')}"><span class="meta">${esc(fmtDT(u.at))}</span><br>${esc(u.text)}${safeUrl(u.source_url) && !isDemoUrl(u.source_url) ? ' ' + extLink(u.source_url, '↗') : ''}</li>`).join('') || '<li class="meta">Aucune.</li>'}</ul>
  <h3>Impacts économiques</h3><div class="imp">${v.imps.map(i => impCard(i)).join('') || '<p class="meta">Aucun impact évalué.</p>'}</div>
  <h3>Chaîne de causalité ${canWrite() ? '<button class="btn" id="addLink" style="min-height:34px;padding:4px 10px;font-size:13px">+ Lier</button>' : ''}</h3>
  ${ch.up.size ? `<p class="meta">En amont (causes, antécédents)</p><div class="chainlist">${sortByDate(ch.up).map(([id, info]) => chainItem(id, info, lt => lt.back.replace('est causé par', 'cause'))).join('')}</div>` : ''}
  ${ch.down.size ? `<p class="meta" style="margin-top:10px">En aval (conséquences, suites)</p><div class="chainlist">${sortByDate(ch.down).map(([id, info]) => chainItem(id, info, lt => ({ causes: 'conséquence', escalates: 'aggravation', responds_to: 'réaction', follows: 'suite' })[info.link.type] || lt.label)).join('')}</div>` : ''}
  ${ch.rel.length ? `<p class="meta" style="margin-top:10px">Liens thématiques</p><div class="chainlist">${ch.rel.map(r => chainItem(r.other, { link: r.link, depth: 1 }, () => 'lié')).join('')}</div>` : ''}
  ${!ch.up.size && !ch.down.size && !ch.rel.length ? '<p class="meta">Aucun lien. Les liens peuvent relier des événements de n’importe quelle date.</p>' : ''}
  <div class="row"><button class="btn" id="copyEv">Copier la fiche</button>${e.location ? '<button class="btn" id="centerEv">Centrer la carte</button>' : ''}${canWrite() ? '<button class="btn danger" id="delEv">Supprimer</button>' : ''}</div>
  <details class="hist"><summary>Historique et provenance (${plural(batches.length, 'lot')}, ${plural(hist.length, 'modification')})</summary>
    <ul class="tl small" style="margin-top:8px">${hist.map(h => `<li><span class="meta">${esc(fmtDT(h.at))}</span> ${esc({ title: 'Titre', summary: 'Résumé', date: 'Date', severity: 'Sévérité', status: 'Statut', location: 'Lieu', ended_on: 'Date de fin' }[h.field] || h.field)} modifié${h.from && typeof h.from === 'string' ? ` (avant : ${esc(SEV[h.from] || STATUS[h.from] || h.from.slice(0, 160))})` : ''}</li>`).join('')}
    ${batches.map(b => `<li><span class="meta">${esc(fmtDT(b.generated_at))}</span> Lot ${esc(b.id)}${b.request ? ' — ' + esc(b.request) : ''}</li>`).join('')}</ul>
    <p class="meta">Identifiant : <code>${esc(e.id)}</code></p></details>`;
}
function paneOverview() {
  const vis = visibleEvents(S.db, S.D, S.W, S.themes);
  if (!liveEvents(S.db).length) return welcomeHtml();
  return `<h2>${S.D === today() ? 'Situation actuelle' : 'Situation au ' + esc(fmtDay(S.D, { day: 'numeric', month: 'long', year: 'numeric' }))}</h2>
  <p class="meta">${plural(vis.length, 'événement')} sur la période · sélectionnez un repère ou un événement.</p>
  <div class="list" style="margin-top:12px">${vis.slice(0, 10).map(v => evButton(v)).join('') || '<p class="empty">Aucun événement sur cette période. Élargissez la fenêtre d’activité ou changez de date.</p>'}</div>
  ${vis.length > 10 ? `<div class="row"><button class="lnk" data-tab="flux">Voir les ${vis.length} événements</button></div>` : ''}`;
}
function welcomeHtml() {
  if (!canWrite()) return `<div class="welcome"><h2>Bienvenue sur LiveWorld</h2><p>La base est encore vide. Les événements apparaîtront dès qu’un éditeur aura importé une veille.</p></div>`;
  return `<div class="welcome"><h2>Bienvenue sur LiveWorld</h2>
  <p>La base est vide. Pour commencer :</p>
  <ol><li><b>Exporter → Copier le prompt du jour</b>, puis demandez la veille à Claude dans votre Projet « LiveWorld ».</li>
  <li><b>Importer</b> le fichier JSON que Claude vous renvoie.</li>
  <li>Recommencez chaque jour : seuls les nouveautés et les compléments sont ajoutés.</li></ol>
  <div class="row"><button class="btn pri" data-act="import">Importer un lot</button><button class="btn" data-act="demo">Charger la démo</button></div>
  <p class="meta">Le guide complet est dans le fichier README du dépôt GitHub.</p></div>`;
}
function paneImpacts() {
  const vis = visibleEvents(S.db, S.D, S.W, S.themes), rows = [];
  for (const v of vis) for (const i of v.imps) rows.push({ ...i, ev: v });
  const sectors = [...new Set(rows.map(r => r.sector))].sort((a, b) => rows.filter(r => r.sector === b).length - rows.filter(r => r.sector === a).length);
  const f = S.sectorF && sectors.includes(S.sectorF) ? S.sectorF : null;
  const shown = rows.filter(r => !f || r.sector === f).sort((a, b) => SEV_RANK[b.ev.sev] - SEV_RANK[a.ev.sev]);
  const tally = s => { const r = rows.filter(x => x.sector === s); return { up: r.filter(x => x.direction === 'bullish').length, down: r.filter(x => x.direction === 'bearish').length, vol: r.filter(x => x.direction === 'volatile').length, n: r.length }; };
  return `<h2>Impacts économiques</h2><p class="meta">${plural(rows.length, 'effet estimé', 'effets estimés')} sur ${plural(sectors.length, 'secteur')} · ${S.D === today() ? 'état actuel' : 'au ' + esc(fmtDay(S.D))}</p>
  <div class="imp" style="margin:12px 0">${sectors.map(s => { const t = tally(s), net = t.up - t.down, vol = t.vol > t.n / 2; return `<div style="cursor:pointer" data-sector="${esc(s)}"><span class="dir ${vol ? 'vol' : net > 0 ? 'up' : net < 0 ? 'down' : 'vol'}">${vol ? 'Volatil' : net > 0 ? 'Haussier' : net < 0 ? 'Baissier' : 'Mixte'}</span><b>${esc(s)}</b><br><span class="meta">${plural(t.n, 'signal', 'signaux')} · ▲${t.up} ▼${t.down} ↕${t.vol}</span></div>`; }).join('') || '<p class="meta">Aucun impact sur la période.</p>'}</div>
  ${sectors.length ? `<div class="filters"><button class="chip" data-sector="" aria-pressed="${!f}">Tous</button>${sectors.map(s => `<button class="chip" data-sector="${esc(s)}" aria-pressed="${f === s}">${esc(s)}</button>`).join('')}</div>` : ''}
  <div class="imp">${shown.map(r => impCard(r, r.ev)).join('')}</div>`;
}
function paneBilan() {
  const brs = Object.values(S.db.briefings).filter(b => b.date === S.D).sort((a, b) => ts(b.generated_at) - ts(a.generated_at));
  const cur = brs.find(b => b.id === S.briefSel) || brs[0];
  const nav = `<div class="row" style="margin-top:0"><button class="lnk" data-jump="${addDays(S.D, -1)}">‹ veille</button>${S.D < today() ? `<button class="lnk" data-jump="${addDays(S.D, 1)}">lendemain ›</button>` : ''}</div>`;
  if (!cur) {
    const day = liveEvents(S.db).map(e => snapshot(e, S.D)).filter(v => v.e.date <= S.D && (v.ups.some(u => dayOf(u.at) === S.D) || v.srcs.some(s => dayOf(s.published_at) === S.D) || v.e.date === S.D)).sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
    return `${nav}<h2>Bilan du ${esc(fmtLong(S.D))}</h2><p class="banner">Aucun briefing importé pour ce jour. Synthèse automatique à partir des événements :</p>
    <div class="list">${day.slice(0, 8).map(v => evButton(v, `<span class="snip">${esc(v.ups.find(u => dayOf(u.at) === S.D)?.text || v.e.summary.slice(0, 160))}</span>`)).join('') || '<p class="empty">Aucune activité enregistrée ce jour-là.</p>'}</div>`;
  }
  return `${nav}<h2>${esc(cur.title || 'Briefing exécutif')}</h2><p class="meta">${esc(fmtLong(cur.date))} · produit le ${esc(fmtDT(cur.generated_at))}${brs.length > 1 ? ` · ${brs.length} éditions ce jour` : ''}</p>
  ${brs.length > 1 ? `<div class="filters">${brs.map(b => `<button class="chip" data-brief="${esc(b.id)}" aria-pressed="${b.id === cur.id}">${esc(fmtDT(b.generated_at).split(' ').pop())}</button>`).join('')}</div>` : ''}
  <h3>Top événements</h3><ol style="padding-left:20px;display:grid;gap:8px">${(cur.top || []).map(t => { const e = S.db.events[t.event_id]; return `<li>${e ? `<button class="lnk" data-go="${esc(e.id)}">${esc(e.title)}</button> — ` : ''}${esc(t.why)}</li>`; }).join('')}</ol>
  ${cur.macro ? `<h3>Bilan macroéconomique</h3>${md(cur.macro)}` : ''}
  ${cur.markets ? `<h3>Marchés</h3>${md(cur.markets)}` : ''}
  ${cur.watch?.length ? `<h3>Points de vigilance</h3><ul>${cur.watch.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
  ${cur.blocks?.length ? renderBlocks(cur.blocks) : ''}`;
}
function paneFlux() {
  let vis = visibleEvents(S.db, S.D, S.W, S.themes);
  if (S.fSev !== 'all') vis = vis.filter(v => v.sev === S.fSev);
  if (S.fStatus !== 'all') vis = vis.filter(v => v.status === S.fStatus);
  if (S.fSort === 'recent') vis.sort((a, b) => a.last < b.last ? 1 : a.last > b.last ? -1 : 0);
  return `<h2>Flux d’événements</h2><p class="meta">${plural(vis.length, 'événement')} · ${S.W === 'all' ? 'toute la période' : 'activité sur ' + S.W + ' j'}${S.themes.size ? ' · ' + [...S.themes].map(t => THEME_LABEL[t]).join(', ') : ''}</p>
  <div class="filters">${[['all', 'Toutes sévérités'], ['critical', 'Critiques'], ['high', 'Élevés'], ['moderate', 'Modérés']].map(([k, l]) => `<button class="chip" data-fsev="${k}" aria-pressed="${S.fSev === k}">${l}</button>`).join('')}</div>
  <div class="filters">${[['all', 'Tous statuts'], ...Object.entries(STATUS)].map(([k, l]) => `<button class="chip" data-fst="${k}" aria-pressed="${S.fStatus === k}">${l}</button>`).join('')}<button class="chip" data-fsort="${S.fSort === 'sev' ? 'recent' : 'sev'}">Tri : ${S.fSort === 'sev' ? 'sévérité' : 'plus récents'}</button></div>
  <div class="list">${vis.map(v => evButton(v)).join('') || '<p class="empty">Aucun événement.</p>'}</div>`;
}
function paneThemes() {
  const vis = visibleEvents(S.db, S.D, S.W, null), all = liveEvents(S.db);
  const cnt = (list, t) => list.filter(x => ((x.e || x).themes || []).includes(t)).length;
  const max = Math.max(1, ...THEMES.map(([t]) => cnt(all, t)));
  let detail = '';
  if (S.themes.size === 1) {
    const t = [...S.themes][0];
    const evs = all.filter(e => (e.themes || []).includes(t)).sort((a, b) => lastActivity(a) < lastActivity(b) ? 1 : -1);
    const byMonth = {}; for (const e of evs) (byMonth[lastActivity(e).slice(0, 7)] ||= []).push(e);
    detail = `<h3>${esc(THEME_LABEL[t])} — toutes dates (${evs.length})</h3>` + Object.entries(byMonth).map(([m, list]) => `<div class="month">${esc(new Date(m + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))}</div><div class="list">${list.map(e => evButton(snapshot(e))).join('')}</div>`).join('');
  }
  return `<h2>Thématiques</h2><p class="meta">Nombre d’événements sur la période affichée / dans toute la base. Touchez un thème pour filtrer la carte.</p>
  <div class="themegrid" style="margin-top:12px">${THEMES.map(([t, l]) => { const a = cnt(all, t); return `<button data-themeonly="${t}" aria-pressed="${S.themes.has(t)}"><span>${esc(l)}</span><span class="n">${cnt(vis, t)} <span class="meta">/ ${a}</span></span><span class="bar"><i style="width:${a / max * 100}%"></i></span></button>`; }).join('')}</div>
  ${S.themes.size ? `<div class="row"><button class="lnk" data-theme="">Retirer le filtre</button></div>` : ''}${detail}`;
}
function renderPane() {
  $$('.tabs [data-t]').forEach(b => b.setAttribute('aria-selected', b.dataset.t === S.tab));
  const p = $('#pane');
  p.innerHTML = { dossier: paneDossier, impacts: paneImpacts, bilan: paneBilan, flux: paneFlux, themes: paneThemes }[S.tab]();
  hydrate(p);
  $$('[data-go]', p).forEach(b => b.onclick = () => select(b.dataset.go, { jump: true }));
  $$('[data-jump]', p).forEach(b => b.onclick = () => setDate(b.dataset.jump));
  $$('[data-theme]', p).forEach(b => b.onclick = () => toggleTheme(b.dataset.theme, true));
  $$('[data-themeonly]', p).forEach(b => b.onclick = () => { const t = b.dataset.themeonly; if (S.themes.size === 1 && S.themes.has(t)) S.themes.clear(); else S.themes = new Set([t]); renderAll(); });
  $$('[data-q]', p).forEach(b => b.onclick = () => openSearch(b.dataset.q));
  $$('[data-sector]', p).forEach(b => b.onclick = () => { S.sectorF = b.dataset.sector || null; renderPane(); });
  $$('[data-brief]', p).forEach(b => b.onclick = () => { S.briefSel = b.dataset.brief; renderPane(); });
  $$('[data-fsev]', p).forEach(b => b.onclick = () => { S.fSev = b.dataset.fsev; renderPane(); });
  $$('[data-fst]', p).forEach(b => b.onclick = () => { S.fStatus = b.dataset.fst; renderPane(); });
  $$('[data-fsort]', p).forEach(b => b.onclick = () => { S.fSort = b.dataset.fsort; renderPane(); });
  $$('[data-tab]', p).forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderPane(); });
  $$('[data-act=import]', p).forEach(b => b.onclick = openImport);
  $$('[data-act=demo]', p).forEach(b => b.onclick = loadDemo);
  $$('[data-unlink]', p).forEach(b => b.onclick = () => { const l = S.db.links[b.dataset.unlink]; confirmBox('Supprimer ce lien ?', `${esc(S.db.events[l.from]?.title)} → ${esc(S.db.events[l.to]?.title)}`, 'Supprimer', () => save({ links: [{ id: l.id, _deleted: true }] }, 'Lien supprimé.')); });
  const e = S.sel && S.db.events[S.sel];
  if (S.tab === 'dossier' && e) {
    $('#addLink', p) && ($('#addLink', p).onclick = () => openLinkPicker(e));
    $('#copyEv', p) && ($('#copyEv', p).onclick = async () => toast(await copyText(eventMd(S.db, e)) ? 'Fiche copiée.' : 'Copie impossible.'));
    $('#centerEv', p) && ($('#centerEv', p).onclick = () => map.focus(e.location.lng, e.location.lat));
    if ($('#delEv', p)) $('#delEv', p).onclick = () => confirmBox('Supprimer cet événement ?', `« ${esc(e.title)} » et ses liens seront retirés de la base. Un futur lot de Claude utilisant le même identifiant le recréera.`, 'Supprimer', () => {
      const links = Object.values(S.db.links).filter(l => l.from === e.id || l.to === e.id).map(l => ({ id: l.id, _deleted: true }));
      S.sel = null; save({ events: [{ id: e.id, _deleted: true }], links }, 'Événement supprimé.');
    });
  }
}
function renderAll() { renderHeader(); renderTicker(); renderMap(); renderPane(); }

// ---------- Recherche ----------
function buildIndex() {
  if (!S.miniDirty && S.mini) return S.mini;
  const mini = new window.MiniSearch({
    fields: ['title', 'summary', 'tags', 'place', 'themes', 'text'], storeFields: ['id'],
    processTerm: t => norm(t).length > 1 ? norm(t) : null,
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3, tags: 2, place: 1.5 }, combineWith: 'AND' },
  });
  mini.addAll(liveEvents(S.db).map(e => ({
    id: e.id, title: e.title, summary: e.summary, tags: (e.tags || []).join(' '), place: e.location?.name || '',
    themes: (e.themes || []).map(t => THEME_LABEL[t]).join(' '),
    text: [...(e.updates || []).map(u => u.text), ...(e.sources || []).map(s => `${s.outlet} ${s.title}`), ...(e.impacts || []).map(i => `${i.sector} ${i.rationale}`), ...(e.blocks || []).map(b => mdText(JSON.stringify(b).replace(/"[a-z_]+":/g, ' ')))].join(' \n '),
  })));
  S.mini = mini; S.miniDirty = false; return mini;
}
function snippet(e, terms) {
  const hay = [e.summary, ...(e.updates || []).map(u => u.text)].join(' · ');
  const n = norm(hay); let pos = -1;
  for (const t of terms) { const i = n.indexOf(t); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
  const start = Math.max(0, pos - 60), raw = (start ? '…' : '') + hay.slice(start, start + 200) + (hay.length > start + 200 ? '…' : '');
  let html = esc(raw);
  for (const t of terms.filter(t => t.length > 2)) html = html.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('').map(c => `${c}[\\u0300-\\u036f]?`).join('')})`, 'gi'), '<mark>$1</mark>');
  return html;
}
function openSearch(q0 = '') {
  const years = [...new Set(liveEvents(S.db).map(e => e.date.slice(0, 4)))].sort().reverse();
  openModal('Rechercher dans toute la base', `
    <input type="search" id="sq" placeholder="Mots-clés, pays, acteur, secteur…" value="${esc(q0)}" autocomplete="off">
    <div class="grid2" style="margin-top:8px">
      <select id="sTheme"><option value="">Tous les thèmes</option>${THEMES.map(([t, l]) => `<option value="${t}">${esc(l)}</option>`).join('')}</select>
      <select id="sSev"><option value="">Toutes sévérités</option>${Object.entries(SEV).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select id="sYear"><option value="">Toutes les années</option>${years.map(y => `<option>${y}</option>`).join('')}</select>
      <select id="sStatus"><option value="">Tous statuts</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    </div>
    <p class="meta" id="sCount" style="margin:10px 0 6px"></p><div class="list" id="sRes"></div>`, b => {
    const mini = buildIndex();
    const run = () => {
      const q = $('#sq', b).value.trim(), th = $('#sTheme', b).value, sv = $('#sSev', b).value, yr = $('#sYear', b).value, st = $('#sStatus', b).value;
      let res;
      if (q) res = mini.search(q).map(r => ({ e: S.db.events[r.id], terms: r.terms }));
      else res = liveEvents(S.db).sort((a, b) => lastActivity(a) < lastActivity(b) ? 1 : -1).map(e => ({ e, terms: [] }));
      res = res.filter(r => r.e && (!th || (r.e.themes || []).includes(th)) && (!sv || r.e.severity === sv) && (!yr || r.e.date.startsWith(yr) || lastActivity(r.e).startsWith(yr)) && (!st || r.e.status === st));
      $('#sCount', b).textContent = `${plural(res.length, 'résultat')}${res.length > 60 ? ' (60 premiers affichés)' : ''}`;
      $('#sRes', b).innerHTML = res.slice(0, 60).map(({ e, terms }) => `<button data-res="${esc(e.id)}">${sevTag(e.severity)}<span class="t">${esc(e.title)}</span><span class="m">${esc(fmtDay(e.date, { day: 'numeric', month: 'short', year: 'numeric' }))} → ${esc(fmtDay(lastActivity(e), { day: 'numeric', month: 'short', year: 'numeric' }))} · ${esc(e.location?.name || '')} · ${(e.themes || []).map(t => esc(THEME_LABEL[t])).join(', ')}</span><span class="snip">${snippet(e, terms.map(norm))}</span></button>`).join('') || '<p class="empty">Aucun résultat.</p>';
      $$('[data-res]', b).forEach(x => x.onclick = () => { closeModal(); select(x.dataset.res, { jump: true, focus: true }); });
    };
    let t; $('#sq', b).oninput = () => { clearTimeout(t); t = setTimeout(run, 120); };
    ['#sTheme', '#sSev', '#sYear', '#sStatus'].forEach(s => $(s, b).onchange = run);
    run(); setTimeout(() => $('#sq', b).focus(), 50);
  });
}
$('#searchBtn').onclick = () => openSearch();
document.addEventListener('keydown', e => { if (e.key === '/' && !modal.open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); } });

// ---------- Lier deux événements ----------
function openLinkPicker(e) {
  const OPTS = [
    ['causes', false, 'Cet événement est une CAUSE de…'], ['causes', true, 'Cet événement est une CONSÉQUENCE de…'],
    ['responds_to', false, 'Cet événement est une RÉACTION à…'], ['follows', false, 'Cet événement fait SUITE à… (épisode antérieur)'],
    ['escalates', true, 'Cet événement est une AGGRAVATION de…'], ['relates_to', false, 'Cet événement est LIÉ (sans causalité) à…'],
  ];
  openModal('Lier « ' + e.title.slice(0, 60) + ' »', `
    <label class="f">Type de relation<select id="lType">${OPTS.map((o, i) => `<option value="${i}">${o[2]}</option>`).join('')}</select></label>
    <label class="f">Événement cible (toutes dates)<input type="search" id="lq" placeholder="Rechercher…" autocomplete="off"></label>
    <div class="list" id="lRes" style="margin-top:8px;max-height:280px;overflow:auto"></div>
    <label class="f">Justification (facultatif)<input type="text" id="lWhy" maxlength="300"></label>
    <div class="row"><button class="btn pri" id="lSave" disabled>Créer le lien</button><span class="meta" id="lSel"></span></div>`, b => {
    const mini = buildIndex(); let target = null;
    const run = () => {
      const q = $('#lq', b).value.trim();
      const list = (q ? mini.search(q).map(r => S.db.events[r.id]) : liveEvents(S.db).sort((x, y) => lastActivity(x) < lastActivity(y) ? 1 : -1)).filter(x => x && x.id !== e.id).slice(0, 30);
      $('#lRes', b).innerHTML = list.map(x => `<button data-t="${esc(x.id)}" style="${target === x.id ? 'border-color:var(--mod)' : ''}">${sevTag(x.severity)}<span class="t">${esc(x.title)}</span><span class="m">${esc(fmtDay(x.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></button>`).join('');
      $$('[data-t]', b).forEach(x => x.onclick = () => { target = x.dataset.t; $('#lSel', b).textContent = '→ ' + S.db.events[target].title; $('#lSave', b).disabled = false; run(); });
    };
    $('#lq', b).oninput = run; run();
    $('#lSave', b).onclick = () => {
      const [type, rev] = OPTS[+$('#lType', b).value];
      const l = { from: rev ? target : e.id, to: rev ? e.id : target, type, confidence: 'medium', rationale: $('#lWhy', b).value.trim(), origin: 'manuel', added_at: new Date().toISOString(), batch: 'manuel' };
      l.id = linkId(l);
      closeModal(); save({ links: [l] }, 'Lien créé.');
    };
  });
}

// ---------- Import ----------
function openImport() {
  openModal('Importer un lot de Claude', `
    <div class="drop" id="drop"><p>Déposez un ou plusieurs fichiers <b>.json</b> ici, ou</p><input type="file" id="fIn" accept=".json,.txt,.md,application/json,text/plain" multiple></div>
    <label class="f">… ou collez le JSON renvoyé par Claude<textarea id="tIn" placeholder='{ "schema": "liveworld.batch/v1", … }'></textarea></label>
    <div class="row"><button class="btn pri" id="anBtn">Analyser</button><span class="meta">Rien n’est écrit avant votre confirmation.</span></div>
    <div id="anOut"></div>`, b => {
    let files = [];
    $('#fIn', b).onchange = e => { files = [...e.target.files]; analyze(); };
    const dz = $('#drop', b);
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); files = [...e.dataTransfer.files]; analyze(); };
    $('#anBtn', b).onclick = analyze;
    async function analyze() {
      const out = $('#anOut', b); const inputs = [];
      for (const f of files) inputs.push({ name: f.name, text: await readFile(f) });
      if ($('#tIn', b).value.trim()) inputs.push({ name: 'Texte collé', text: $('#tIn', b).value });
      if (!inputs.length) { out.innerHTML = '<p class="meta">Choisissez un fichier ou collez du JSON.</p>'; return; }
      const analyses = [];
      for (const inp of inputs) {
        try { for (const raw of parseInput(inp.text)) analyses.push({ name: inp.name, an: analyzeBatch(raw, S.db) }); }
        catch (err) { analyses.push({ name: inp.name, err: 'JSON invalide : ' + err.message }); }
      }
      out.innerHTML = analyses.map((a, i) => {
        if (a.err) return `<h3>${esc(a.name)}</h3><p class="toast err" style="animation:none">${esc(a.err)}</p>`;
        const an = a.an; if (an.fatal.length) return `<h3>${esc(a.name)}</h3><p class="toast err" style="animation:none">${an.fatal.map(esc).join('<br>')}</p>`;
        const c = k => an.events.filter(x => x.kind === k).length;
        return `<h3>${esc(a.name)} · lot ${esc(an.meta.batch_id)}</h3>
        ${an.alreadyImported ? '<p class="banner">Ce lot a déjà été importé. Le réimporter ne crée pas de doublons (sources et mises à jour sont dédoublonnées).</p>' : ''}
        <div class="stats"><div><strong>${c('new')}</strong><span>nouveaux</span></div><div><strong>${c('update')}</strong><span>mises à jour</span></div><div><strong>${c('dup')}</strong><span>doublons probables</span></div><div><strong>${c('rejected')}</strong><span>rejetés</span></div><div><strong>${an.links.valid.length}</strong><span>liens</span></div><div><strong>${an.markets.length}</strong><span>cotations</span></div><div><strong>${an.briefing ? 1 : 0}</strong><span>briefing</span></div></div>
        ${an.meta.request ? `<p class="meta">Demande : ${esc(an.meta.request)}</p>` : ''}${an.meta.notes ? `<p class="meta">Notes de Claude : ${esc(an.meta.notes)}</p>` : ''}
        <div class="pv">${an.events.map((x, j) => `<div><span class="k ${x.kind}">${{ new: 'Nouveau', update: 'Mise à jour', dup: 'Doublon ?', rejected: 'Rejeté', merge: 'Fusion' }[x.kind]}</span><span>${esc(x.inc?.title || S.db.events[x.inc?.id]?.title || x.inc?.id || '(sans titre)')}</span>
          <span class="d">${x.kind === 'rejected' ? esc(x.reasons.join(' ; ')) : x.kind === 'merge' ? `fusionné dans ${esc(S.db.events[x.inc.merge_into]?.title || x.inc.merge_into)}` : esc(previewDiff(S.db, x))}${x.reasons?.length && x.kind !== 'rejected' ? ' · ' + esc(x.reasons.join(' ; ')) : ''}</span>
          ${x.kind === 'dup' ? `<select data-dec="${i}:${esc(x.inc.id)}"><option value="merge" ${x.decision === 'merge' ? 'selected' : ''}>Fusionner dans « ${esc(x.dupOf.title.slice(0, 60))} »</option><option value="separate" ${x.decision === 'separate' ? 'selected' : ''}>Créer un événement séparé</option></select>` : ''}</div>`).join('')}</div>
        ${an.warnings.length ? `<details><summary>${plural(an.warnings.length, 'avertissement')}</summary><ul class="warns">${an.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}`;
      }).join('') + (analyses.some(a => a.an && !a.an.fatal.length) ? `<div class="row"><button class="btn pri" id="doImport">Importer</button><button class="btn" id="cancelImport">Annuler</button></div>` : '');
      const go = $('#doImport', b); if (!go) return;
      $('#cancelImport', b).onclick = closeModal;
      go.onclick = async () => {
        go.disabled = true; go.textContent = 'Import en cours…';
        const total = { new: 0, updated: 0, merged: 0, rejected: 0, links: 0, markets: 0 }; let firstNew = null;
        for (const [i, a] of analyses.entries()) {
          if (!a.an || a.an.fatal.length) continue;
          const dec = {}; $$(`[data-dec^="${i}:"]`, b).forEach(s => dec[s.dataset.dec.split(':').slice(1).join(':')] = s.value);
          const { changes, counts } = applyBatch(S.db, a.an, dec);
          if (!await save(changes)) return;
          for (const k in total) total[k] += counts[k] || 0;
          firstNew ||= a.an.events.find(x => x.kind === 'new' && x.inc.severity === 'critical')?.inc.id;
        }
        closeModal();
        toast(`Import terminé : <b>${total.new}</b> nouveau(x), <b>${total.updated}</b> mis à jour, ${total.links} lien(s), ${total.markets} cotation(s)${total.rejected ? `, ${total.rejected} rejeté(s)` : ''}.`, 'ok');
        S.D = today(); if (firstNew) select(firstNew, { jump: true }); else renderAll();
      };
    }
  });
}
$('#importBtn').onclick = () => canWrite() && openImport();

// ---------- Export ----------
function openExport() {
  const yrs = [...new Set(liveEvents(S.db).map(e => e.date.slice(0, 4)))].sort().reverse();
  const r = dataRange(S.db);
  openModal('Exporter', `
    <h3>1. Préparer la session Claude</h3>
    <div class="seg"><label><input type="radio" name="pk" value="daily" checked> Veille quotidienne</label><label><input type="radio" name="pk" value="extra"> Session complémentaire</label><label><input type="radio" name="pk" value="deep"> Approfondir un sujet</label></div>
    <label class="f">Précision facultative (sujet à privilégier, ou sujet à approfondir)<input type="text" id="pFocus" placeholder="ex. Moyen-Orient, semi-conducteurs, evt-20261120-…"></label>
    <div class="row"><button class="btn pri" id="prepAll">Télécharger le contexte + copier le prompt</button><button class="btn" id="copyPrompt">Copier le prompt seul</button></div>
    <p class="meta">Le contexte téléchargé couvre les 90 derniers jours en mode compact. Joignez-le à une nouvelle conversation du Projet « LiveWorld », puis collez le prompt.</p>
    <h3>2. Export personnalisé</h3>
    <div class="seg"><label><input type="radio" name="xk" value="context" checked> Contexte pour Claude (.md)</label><label><input type="radio" name="xk" value="summary"> Résumé lisible (.md)</label><label><input type="radio" name="xk" value="backup"> Sauvegarde complète (.json)</label></div>
    <div class="seg" style="margin-top:8px" id="scopeSeg"><label><input type="radio" name="sk" value="recent" checked> 90 derniers jours</label><label><input type="radio" name="sk" value="month"> Un mois</label><label><input type="radio" name="sk" value="year"> Une année</label><label><input type="radio" name="sk" value="range"> Période</label><label><input type="radio" name="sk" value="all"> Tout</label></div>
    <div class="grid2" style="margin-top:8px"><input type="month" id="xMonth" value="${today().slice(0, 7)}" hidden><select id="xYear" hidden>${(yrs.length ? yrs : [today().slice(0, 4)]).map(y => `<option>${y}</option>`).join('')}</select><input type="date" id="xFrom" value="${r.min || today()}" hidden><input type="date" id="xTo" value="${today()}" hidden></div>
    <div class="seg" style="margin-top:8px" id="detSeg"><label><input type="radio" name="dk" value="compact" checked> Compact</label><label><input type="radio" name="dk" value="full"> Détaillé</label></div>
    <div class="row"><button class="btn pri" id="xDl">Télécharger</button><button class="btn" id="xCopy">Copier</button><span class="meta" id="xSize"></span></div>
    <textarea class="out" id="xOut" readonly></textarea>`, b => {
    const val = n => $(`input[name=${n}]:checked`, b).value;
    const scope = () => { const k = val('sk'); return k === 'recent' ? { kind: 'range', from: addDays(today(), -89), to: today() } : k === 'month' ? { kind: 'month', month: $('#xMonth', b).value || today().slice(0, 7) } : k === 'year' ? { kind: 'year', year: $('#xYear', b).value } : k === 'range' ? { kind: 'range', from: $('#xFrom', b).value, to: $('#xTo', b).value } : { kind: 'all' }; };
    const build = () => {
      const k = val('xk'), sk = val('sk');
      $('#xMonth', b).hidden = sk !== 'month'; $('#xYear', b).hidden = sk !== 'year'; $('#xFrom', b).hidden = $('#xTo', b).hidden = sk !== 'range';
      $('#scopeSeg', b).hidden = k === 'backup'; $('#detSeg', b).hidden = k !== 'context';
      const txt = k === 'context' ? contextMd(S.db, scope(), val('dk')) : k === 'summary' ? summaryMd(S.db, scope()) : backupJson(S.db);
      $('#xOut', b).value = txt.length > 60000 ? txt.slice(0, 60000) + '\n…(aperçu tronqué, le fichier est complet)' : txt;
      $('#xSize', b).textContent = `${Math.round(txt.length / 1024)} Ko · ~${fmtNum(Math.round(txt.length / 3.5))} tokens`;
      return { k, txt };
    };
    const fname = k => { const sc = scopeRange(scope()); const tag = val('sk') === 'all' ? 'tout' : val('sk') === 'recent' ? '90j' : (sc.from + '_' + sc.to); return k === 'backup' ? `liveworld-sauvegarde-${today()}.json` : `liveworld-${k === 'context' ? 'contexte' : 'resume'}-${tag}.md`; };
    $$('input,select', b).forEach(i => i.addEventListener('change', build)); build();
    $('#xDl', b).onclick = () => { const { k, txt } = build(); download(fname(k), txt, k === 'backup' ? 'application/json' : 'text/markdown'); };
    $('#xCopy', b).onclick = async () => { const { txt } = build(); toast(await copyText(txt) ? 'Copié.' : 'Copie impossible : utilisez Télécharger.'); };
    const prompt = () => dailyPrompt(S.db, val('pk'), $('#pFocus', b).value);
    $('#copyPrompt', b).onclick = async () => toast(await copyText(prompt()) ? 'Prompt copié.' : 'Copie impossible.');
    $('#prepAll', b).onclick = async () => {
      download(`liveworld-contexte-${today()}.md`, contextMd(S.db, { kind: 'range', from: addDays(today(), -89), to: today() }, 'compact'), 'text/markdown');
      toast(await copyText(prompt()) ? 'Contexte téléchargé et prompt copié.' : 'Contexte téléchargé. Copiez le prompt avec le bouton dédié.', 'ok');
    };
  });
}
$('#exportBtn').onclick = openExport;

// ---------- Journal des imports ----------
$('#bell').onclick = () => {
  const list = Object.values(S.db.batches).sort((a, b) => ts(b.imported_at) - ts(a.imported_at)).slice(0, 40);
  const seen = pref.get('seenBatches', 0); pref.set('seenBatches', Date.now());
  openModal('Journal des imports', list.length ? `<ul class="tl">${list.map(b => `<li class="${ts(b.imported_at) > seen ? 'critical' : ''}"><b>${esc(b.id)}</b>${b.demo ? '<span class="demo">DÉMO</span>' : ''}<br><span class="meta">Produit le ${esc(fmtDT(b.generated_at))} · importé le ${esc(fmtDT(b.imported_at))}</span><br>${b.counts ? `${b.counts.new} nouveau(x) · ${b.counts.updated} mis à jour · ${b.counts.links} lien(s)${b.counts.rejected ? ` · ${b.counts.rejected} rejeté(s)` : ''}` : ''}${b.request ? `<br><span class="meta">${esc(b.request)}</span>` : ''}${b.notes ? `<br><span class="meta">Notes : ${esc(b.notes)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="empty">Aucun import pour le moment.</p>');
  renderHeader();
};

// ---------- Réglages ----------
async function openSettings() {
  const fb = S.store.mode === 'firebase';
  const counts = COLLECTIONS.map(c => `${Object.keys(S.db[c]).length} ${({ events: 'événements', links: 'liens', briefings: 'briefings', markets: 'cotations', batches: 'lots' })[c]}`).join(' · ');
  const local = fb && isAdmin() ? await LocalStore.peekLocal() : null;
  const localN = local ? Object.keys(local.events || {}).length : 0;
  const demoN = Object.values(S.db.events).filter(e => e.demo).length;
  const p = S.store.profile;
  openModal('Réglages', `
    ${fb ? `<h3>Mon compte</h3>
    <p>Connecté en tant que <b>${esc(displayName(p))}</b> · ${esc(ROLES[S.role] || S.role)}</p>
    <div class="row"><button class="btn" id="sPwd">Changer mon mot de passe</button><button class="btn" id="sOut">Se déconnecter</button></div>
    ${isAdmin() ? `<h3>Comptes</h3><p class="meta">Seul un administrateur peut créer des comptes. La page de connexion ne permet que de se connecter.</p><div class="row"><button class="btn pri" id="sUsers">Gérer les comptes</button></div>` : ''}`
    : `<h3>Stockage</h3><p>Mode local : les données restent dans ce navigateur. Configurez Firebase (voir README) pour activer les comptes et la synchronisation.</p>`}
    <h3>Données</h3><p class="meta">${counts}</p>
    ${canWrite() ? `<div class="row"><button class="btn" id="sDemo">Charger la démo</button>${demoN ? `<button class="btn" id="sDemoDel">Retirer les données de démo (${demoN})</button>` : ''}</div>` : '<p class="meta">Votre compte est en lecture seule. Les exports restent disponibles.</p>'}
    ${(fb ? isAdmin() : true) ? `<div class="row"><label class="btn" style="display:inline-flex;align-items:center;gap:8px">Restaurer une sauvegarde<input type="file" id="sRestore" accept=".json" hidden></label><button class="btn danger" id="sWipe">Vider la base</button>${localN ? `<button class="btn" id="sPush">Envoyer la base locale de ce navigateur vers Firebase (${localN} événements)</button>` : ''}</div>` : ''}
    ${canWrite() ? `<h3>Modèles pour Claude</h3>
    <p class="meta">À mettre dans votre Projet Claude « LiveWorld » (voir README).</p>
    <div class="row"><button class="btn" id="sCopyIns">Copier les instructions</button><a class="btn" href="templates/liveworld-batch.schema.json" download>Schéma JSON</a><a class="btn" href="templates/exemple-batch.json" download>Exemple de lot</a><a class="btn" href="templates/PROMPT_QUOTIDIEN.md" target="_blank">Prompts</a></div>` : ''}`, b => {
    const on = (sel, fn) => { const el = $(sel, b); if (el) el.onclick = fn; };
    on('#sOut', async () => { await S.store.signOut(); location.reload(); });
    on('#sPwd', openPasswordChange);
    on('#sUsers', openUsers);
    on('#sPush', () => confirmBox('Envoyer la base locale ?', `Les ${localN} événements de ce navigateur seront fusionnés dans la base partagée (les documents de même identifiant seront remplacés).`, 'Envoyer', async () => {
      const ch = {}; for (const c of COLLECTIONS) ch[c] = Object.values(local[c] || {}); await save(ch, 'Base locale envoyée vers Firebase.'); }, false));
    on('#sDemo', () => fb ? confirmBox('Charger la démo dans la base partagée ?', 'Tous les comptes verront ces 16 événements fictifs (marqués DÉMO) jusqu’à ce que vous les retiriez dans Réglages.', 'Charger', () => loadDemo(), false) : (closeModal(), loadDemo()));
    on('#sDemoDel', () => {
      const ev = Object.values(S.db.events).filter(e => e.demo).map(e => ({ id: e.id, _deleted: true })); const ids = new Set(ev.map(e => e.id));
      save({ events: ev, links: Object.values(S.db.links).filter(l => ids.has(l.from) || ids.has(l.to)).map(l => ({ id: l.id, _deleted: true })), briefings: Object.values(S.db.briefings).filter(x => x.demo).map(x => ({ id: x.id, _deleted: true })), batches: Object.values(S.db.batches).filter(x => x.demo).map(x => ({ id: x.id, _deleted: true })), markets: Object.values(S.db.markets).filter(m => S.db.batches[m.batch]?.demo).map(m => ({ id: m.id, _deleted: true })) }, 'Données de démo retirées.');
      S.sel = null; closeModal();
    });
    const rs = $('#sRestore', b); if (rs) rs.onchange = async ev => {
      try {
        const j = JSON.parse(await readFile(ev.target.files[0]));
        if (j.schema !== BACKUP_SCHEMA || !j.db) throw new Error('ce fichier n’est pas une sauvegarde LiveWorld');
        confirmBox('Restaurer la sauvegarde ?', `Sauvegarde du ${esc(fmtDT(j.exported_at))} : ${Object.keys(j.db.events || {}).length} événements. <b>La base actuelle sera entièrement remplacée${fb ? ' pour tous les comptes' : ''}.</b>`, 'Restaurer', async () => {
          const db = emptyDb(); for (const c of COLLECTIONS) db[c] = j.db[c] || {};
          await S.store.replaceAll(db); S.db = S.store.db; S.miniDirty = true; S.sel = null; toast('Sauvegarde restaurée.', 'ok'); renderAll();
        });
      } catch (err) { toast('Restauration impossible : ' + esc(err.message), 'err'); }
    };
    on('#sWipe', () => openModal('Vider la base', `<p>Toutes les données seront supprimées${fb ? ' de la base partagée, pour tous les comptes' : ' de ce navigateur'}. Pensez à <b>exporter une sauvegarde</b> avant.</p><label class="f">Tapez SUPPRIMER pour confirmer<input type="text" id="wTxt" autocomplete="off"></label><div class="row"><button class="btn danger" id="wOk">Vider définitivement</button></div>`, m => {
      $('#wOk', m).onclick = async () => { if ($('#wTxt', m).value.trim() !== 'SUPPRIMER') return toast('Confirmation incorrecte.', 'err'); await S.store.replaceAll(emptyDb()); S.db = S.store.db; S.sel = null; S.miniDirty = true; closeModal(); toast('Base vidée.', 'ok'); renderAll(); };
    }));
    on('#sCopyIns', async () => { try { const t = await (await fetch('templates/INSTRUCTIONS_CLAUDE.md')).text(); toast(await copyText(t) ? 'Instructions copiées.' : 'Copie impossible.'); } catch { toast('Fichier introuvable.', 'err'); } });
  });
}
$('#settingsBtn').onclick = openSettings;

const authError = err => ({
  'auth/invalid-credential': 'identifiant ou mot de passe incorrect.', 'auth/wrong-password': 'mot de passe incorrect.', 'auth/user-not-found': 'identifiant inconnu.',
  'auth/too-many-requests': 'trop de tentatives, réessayez dans quelques minutes.', 'auth/email-already-in-use': 'cet identifiant existe déjà.',
  'auth/weak-password': 'mot de passe trop faible (8 caractères minimum).', 'auth/operation-not-allowed': 'la connexion par e-mail/mot de passe n’est pas activée dans Firebase.',
  'auth/network-request-failed': 'connexion réseau impossible.', 'permission-denied': 'action refusée par les règles Firestore (droits insuffisants ou règles non publiées).',
}[err?.code] || err?.message || String(err));

function openPasswordChange() {
  openModal('Changer mon mot de passe', `<form id="pf"><label class="f">Mot de passe actuel<input type="password" id="pCur" autocomplete="current-password" required></label>
    <label class="f">Nouveau mot de passe (8 caractères minimum)<input type="password" id="pNew" autocomplete="new-password" minlength="8" required></label>
    <label class="f">Confirmer<input type="password" id="pNew2" autocomplete="new-password" required></label>
    <div class="row"><button class="btn pri" type="submit">Enregistrer</button></div><p class="meta" id="pErr"></p></form>`, b => {
    $('#pf', b).onsubmit = async ev => {
      ev.preventDefault(); const n = $('#pNew', b).value;
      if (n.length < 8) return $('#pErr', b).textContent = '8 caractères minimum.';
      if (n !== $('#pNew2', b).value) return $('#pErr', b).textContent = 'Les deux mots de passe ne correspondent pas.';
      $('#pErr', b).textContent = 'Enregistrement…';
      try { await S.store.changePassword($('#pCur', b).value, n); closeModal(); toast('Mot de passe modifié.', 'ok'); }
      catch (err) { $('#pErr', b).textContent = 'Échec : ' + authError(err); }
    };
  });
}

// ---------- Gestion des comptes (Admin) ----------
async function openUsers() {
  openModal('Comptes', '<p class="meta">Chargement…</p>');
  let users = [];
  try { users = await S.store.listUsers(); } catch (err) { $('#mBody').innerHTML = `<p class="toast err" style="animation:none">Lecture des comptes impossible : ${esc(authError(err))}</p>`; return; }
  const me = S.store.user.uid;
  const roleSel = (u) => `<select data-role="${esc(u.uid)}" ${u.uid === me || u.username === 'admin' ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  openModal('Comptes', `
    <h3>Créer un compte</h3>
    <form id="uf" autocomplete="off">
      <div class="grid2"><label class="f">Identifiant<input type="text" id="uName" placeholder="ex. marie" autocapitalize="none" spellcheck="false" required></label>
      <label class="f">Rôle<select id="uRole">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === 'reader' ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label class="f">Mot de passe provisoire (8 caractères minimum)<div class="row" style="margin:0;flex-wrap:nowrap"><input type="text" id="uPwd" minlength="8" required><button type="button" class="btn" id="uGen">Générer</button></div></label>
      <div class="row"><button class="btn pri" type="submit">Créer le compte</button><span class="meta" id="uMsg"></span></div>
    </form>
    <p class="meta">Communiquez l’identifiant et le mot de passe à la personne ; elle pourra changer son mot de passe dans Réglages. Lecteur : consultation et exports · Éditeur : imports, liens, suppressions · Administrateur : tout, y compris les comptes.</p>
    <h3>Comptes existants (${users.length})</h3>
    <div class="pv">${users.map(u => `<div><span class="k ${u.disabled ? 'rejected' : u.role === 'admin' ? 'merge' : u.role === 'editor' ? 'update' : 'new'}">${u.disabled ? 'Désactivé' : esc(ROLES[u.role] || u.role)}</span>
      <span><b>${esc(displayName(u))}</b>${u.uid === me ? ' <span class="meta">(vous)</span>' : ''}</span>
      <span class="d">Créé le ${esc(fmtDT(u.created_at))}${u.created_by && u.created_by !== 'auto' ? ' par ' + esc(u.created_by) : ''} · dernière connexion : ${u.last_login_at ? esc(fmtDT(u.last_login_at)) : 'jamais'}</span>
      ${u.uid === me || u.username === 'admin' ? '' : `<span class="d row" style="margin-top:6px">${roleSel(u)}<button class="btn" data-toggle="${esc(u.uid)}">${u.disabled ? 'Réactiver' : 'Désactiver'}</button><button class="btn danger" data-delprof="${esc(u.uid)}">Supprimer</button></span>`}</div>`).join('')}</div>
    <p class="meta" style="margin-top:12px">Mot de passe oublié par un utilisateur : supprimez son compte ici <b>et</b> dans la console Firebase (Authentication → Utilisateurs), puis recréez-le avec le même identifiant.</p>`, b => {
    const pwd = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint32Array(12)); return [...r].map(x => a[x % a.length]).join(''); };
    $('#uGen', b).onclick = () => { $('#uPwd', b).value = pwd(); };
    $('#uf', b).onsubmit = async ev => {
      ev.preventDefault();
      const name = $('#uName', b).value.trim().toLowerCase(), pw = $('#uPwd', b).value, role = $('#uRole', b).value, msg = $('#uMsg', b);
      if (!USERNAME_RE.test(name)) return msg.textContent = 'Identifiant : 2 à 30 caractères (minuscules, chiffres, . _ -).';
      if (pw.length < 8) return msg.textContent = 'Mot de passe : 8 caractères minimum.';
      msg.textContent = 'Création…';
      try { await S.store.createUser(name, pw, role); toast(`Compte <b>${esc(name)}</b> créé (${esc(ROLES[role])}). Mot de passe : <code>${esc(pw)}</code>`, 'ok'); openUsers(); }
      catch (err) { msg.textContent = 'Échec : ' + authError(err); }
    };
    $$('[data-role]', b).forEach(s => s.onchange = async () => { try { await S.store.updateUser(s.dataset.role, { role: s.value }); toast('Rôle modifié.', 'ok'); } catch (err) { toast('Échec : ' + esc(authError(err)), 'err'); openUsers(); } });
    $$('[data-toggle]', b).forEach(x => x.onclick = async () => { const u = users.find(y => y.uid === x.dataset.toggle); try { await S.store.updateUser(u.uid, { disabled: !u.disabled }); toast(u.disabled ? 'Compte réactivé.' : 'Compte désactivé : il n’a plus accès aux données.', 'ok'); openUsers(); } catch (err) { toast('Échec : ' + esc(authError(err)), 'err'); } });
    $$('[data-delprof]', b).forEach(x => x.onclick = () => { const u = users.find(y => y.uid === x.dataset.delprof); confirmBox(`Supprimer le compte « ${esc(displayName(u))} » ?`, 'Il perd immédiatement tout accès. Pour libérer l’identifiant, supprimez aussi l’utilisateur dans la console Firebase (Authentication → Utilisateurs).', 'Supprimer', async () => { try { await S.store.deleteProfile(u.uid); toast('Compte supprimé.', 'ok'); } catch (err) { toast('Échec : ' + esc(authError(err)), 'err'); } openUsers(); }); });
  });
}

// ---------- Démo : 3 lots fictifs, dates décalées pour finir aujourd'hui ----------
async function loadDemo() {
  if (!canWrite()) return;
  closeModal();
  try {
    const files = ['data/demo-1.json', 'data/demo-2.json', 'templates/exemple-batch.json'];
    const batches = await Promise.all(files.map(f => fetch(f).then(r => r.json())));
    const shift = diffDays(today(), dayOf(batches[2].generated_at));
    const sh = d => addDays(d, shift);
    const walk = v => {
      if (typeof v === 'string') {
        let m = v.match(/^(\d{4}-\d{2}-\d{2})(.*)$/); if (m) return sh(m[1]) + m[2];
        m = v.match(/^evt-(\d{4})(\d{2})(\d{2})-(.*)$/); if (m) return 'evt-' + sh(`${m[1]}-${m[2]}-${m[3]}`).replace(/-/g, '') + '-' + m[4];
        return v;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    let total = 0;
    for (const raw of batches.map(walk)) {
      raw._demo = true; raw.batch_id = 'demo-' + raw.batch_id;
      const an = analyzeBatch(raw, S.db); const { changes, counts } = applyBatch(S.db, an);
      await S.store.save(changes); S.db = S.store.db; total += counts.new;
    }
    S.miniDirty = true; S.D = today(); S.W = 7;
    toast(`Démo chargée : ${total} événements fictifs (marqués DÉMO). Retirez-les dans Réglages.`, 'ok');
    const first = Object.values(S.db.events).find(e => e.demo && e.blocks?.length > 3);
    if (first) select(first.id, { jump: true }); else renderAll();
  } catch (e) { console.error(e); toast('Chargement de la démo impossible : ' + esc(e.message), 'err'); }
}

// ---------- Connexion Firebase (aucune création de compte ici) ----------
function loginScreen(store, message = '') {
  return new Promise(resolve => {
    modal.dataset.locked = '1'; $('#mClose').hidden = true;
    openModal('Connexion à LiveWorld', `${message ? `<p class="banner">${message}</p>` : ''}
      <form id="lf"><label class="f">Identifiant<input type="text" id="lUser" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="f">Mot de passe<input type="password" id="lPwd" autocomplete="current-password" required></label>
      <div class="row"><button class="btn pri" type="submit">Se connecter</button></div><p class="meta" id="lErr"></p>
      <p class="meta">Pas de compte ? Demandez-en un à l’administrateur.</p></form>`, b => {
      setTimeout(() => $('#lUser', b).focus(), 50);
      $('#lf', b).onsubmit = async ev => {
        ev.preventDefault(); $('#lErr', b).textContent = 'Connexion…';
        try { await store.signIn($('#lUser', b).value, $('#lPwd', b).value); delete modal.dataset.locked; $('#mClose').hidden = false; closeModal(); resolve(store); }
        catch (err) { $('#lErr', b).textContent = 'Échec : ' + authError(err); }
      };
    });
  });
}
function blockedScreen(store, text) {
  modal.dataset.locked = '1'; $('#mClose').hidden = true;
  openModal('Accès refusé', `<p>${text}</p><div class="row"><button class="btn" id="bOut">Se déconnecter</button></div>`, b => { $('#bOut', b).onclick = async () => { await store.signOut(); location.reload(); }; });
}

// ---------- Démarrage ----------
async function boot() {
  window.__lwStarted = true;
  let cfg = null;
  try { cfg = (await import('./firebase-config.js?t=' + Date.now())).firebaseConfig; } catch {}
  map = new WorldMap($('#map'), $('#mapwrap'), $('#tip'), id => select(id));
  fetch('data/countries-110m.json').then(r => r.json()).then(t => map.setWorld(t)).catch(() => toast('Fond de carte introuvable.', 'err'));
  renderEx(); setInterval(renderEx, 30000);
  window.__lwBooted = true; // l'interface est en place : les erreurs suivantes s'affichent en notifications
  if (cfg && cfg.apiKey) {
    // Mode comptes : pas d'accès sans connexion
    const fbs = new FirebaseStore(cfg);
    try { await fbs.init(u => { if (!u) location.reload(); }); }
    catch (e) { console.error(e); $('#pane').innerHTML = `<p class="empty">Firebase injoignable : ${esc(e.message)}</p>`; return; }
    if (!fbs.user) await loginScreen(fbs);
    let profile = null;
    try { profile = await fbs.loadProfile(); } catch (e) { console.error(e); }
    if (!profile) return blockedScreen(fbs, `Le compte <b>${esc(fbs.usernameOf(fbs.user.email))}</b> n’est pas autorisé sur ce site. Demandez à l’administrateur de vous créer un accès.`);
    if (profile.disabled) return blockedScreen(fbs, 'Ce compte a été désactivé par l’administrateur.');
    S.store = fbs; S.role = profile.role;
  } else {
    S.store = new LocalStore(); S.role = 'local';
  }
  try { S.db = await S.store.load(); }
  catch (e) { console.error(e); toast('Lecture des données impossible : ' + esc(authError(e)), 'err'); }
  renderAll();
  if (S.store.mode === 'firebase') toast(`Connecté : <b>${esc(displayName(S.store.profile))}</b> · ${esc(ROLES[S.role])}`);
  refreshLive(); setInterval(() => { if (S.D === today()) refreshLive(); }, 5 * 60e3);
  // Changement de jour pendant que la page reste ouverte
  let lastToday = today(); setInterval(() => { if (today() !== lastToday) { if (S.D === lastToday) S.D = today(); lastToday = today(); renderAll(); } }, 60e3);
}
boot().catch(e => { console.error(e); window.__lwBooted ? toast('Erreur au démarrage : ' + esc(e.message || e), 'err') : window.__lwFail?.(e); });
