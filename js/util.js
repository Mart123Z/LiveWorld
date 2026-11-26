// Utilitaires : échappement, Markdown sûr, dates, fichiers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = u => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u.trim())) ? u.trim() : null;
export const extLink = (url, text) => { const u = safeUrl(url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(text ?? u)}</a>` : esc(text ?? ''); };

// Markdown minimal et sûr : paragraphes, listes « - », **gras**, *italique*, [lien](https://…)
export function md(src) {
  const inline = t => esc(t)
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, a, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${a}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  const out = []; let list = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-•*]\s+(.*)$/) || line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (li) { if (!list) { list = []; } list.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}
export const mdText = s => String(s ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#>`]/g, '');

// ---------- Dates (jour local du navigateur) ----------
const pad = n => String(n).padStart(2, '0');
export const dayStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  const d = new Date(s); return isNaN(d) ? null : d;
}
export const dayOf = s => { const d = parseDate(s); return d ? dayStr(d) : null; };
export const today = () => dayStr(new Date());
export const addDays = (day, n) => { const d = parseDate(day); d.setDate(d.getDate() + n); return dayStr(d); };
export const diffDays = (a, b) => Math.round((parseDate(a) - parseDate(b)) / 864e5);
export const fmtDay = (day, o = { weekday: 'short', day: 'numeric', month: 'short' }) => { const d = parseDate(day); return d ? d.toLocaleDateString('fr-FR', o) : ''; };
export const fmtLong = day => fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDT = s => { const d = parseDate(s); if (!d) return ''; const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) + (dateOnly ? '' : ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })); };
export const ts = s => { const d = parseDate(s); return d ? d.getTime() : 0; };

// ---------- Texte ----------
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOP = new Set('les des une un le la de du et en au aux sur pour par dans avec sans contre face apres avant entre vers son ses leur leurs plus moins nouvelle nouveau nouvel the and for with from'.split(' '));
export const tokens = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)));
export const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
export function hash(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
export const normUrl = u => { try { const x = new URL(u); [...x.searchParams.keys()].filter(k => /^utm_|^fbclid$|^gclid$/.test(k)).forEach(k => x.searchParams.delete(k)); x.hash = ''; return x.toString().replace(/\/$/, ''); } catch { return String(u || ''); } };
export const docId = s => String(s).replace(/[\/\s]+/g, '_').slice(0, 300);

// ---------- Fichiers & presse-papiers ----------
export function download(name, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok; }
}
export const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
export const fmtNum = (v, dp = 0) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const plural = (n, s, p) => `${n} ${n > 1 ? (p || s + 's') : s}`;
