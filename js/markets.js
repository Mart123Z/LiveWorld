// Marchés : statut des places (calcul local), cotations importées, quelques cours en direct gratuits
import { EXCHANGES, ASSETS } from './config.js?v=202611261032';

export function exStatus(x, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: x.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).map(o => [o.type, o.value]));
  const ymd = `${p.year}-${p.month}-${p.day}`, m = +p.hour * 60 + +p.minute, hh = `${p.hour}:${p.minute}`;
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return { c: '', t: 'Fermé', h: `week-end · ${hh}` };
  if (x.hol.includes(ymd)) return { c: '', t: 'Férié', h: hh };
  const close = x.half[ymd], ses = x.s.map(r => [r[0], close ? Math.min(r[1], close) : r[1]]).filter(r => r[0] < r[1]);
  if (ses.some(r => m >= r[0] && m < r[1])) return { c: 'open', t: 'Ouvert', h: hh + (close ? ' · séance courte' : '') };
  if (m >= x.pre[0] && m < x.pre[1]) return { c: 'pre', t: 'Pré-ouverture', h: hh };
  if (ses.length > 1 && m >= ses[0][1] && m < ses[1][0]) return { c: 'pause', t: 'Pause', h: hh };
  return { c: '', t: 'Fermé', h: hh };
}
export const exchangesStatus = () => EXCHANGES.map(x => ({ n: x.n, ...exStatus(x) }));

export function quotesAt(db, D) {
  const out = {};
  for (const m of Object.values(db.markets)) {
    if (m.date > D) continue;
    if (!out[m.asset] || out[m.asset].date < m.date) out[m.asset] = m;
  }
  return ASSETS.map(a => ({ ...a, q: out[a.k] || null }));
}

// Cours en direct sans clé (CORS autorisé) — utilisés uniquement pour la date du jour
let liveCache = { at: 0, data: {} };
export async function liveQuotes() {
  if (Date.now() - liveCache.at < 5 * 60e3) return liveCache.data;
  const data = {};
  const get = async (u, ms = 6000) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { const r = await fetch(u, { signal: c.signal }); if (!r.ok) throw 0; return await r.json(); } finally { clearTimeout(t); } };
  await Promise.allSettled([
    get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true').then(j => { if (j?.bitcoin?.usd) data.BTC = { close: j.bitcoin.usd, change_pct: j.bitcoin.usd_24h_change, live: 'CoinGecko' }; }),
    get('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD').catch(() => get('https://api.frankfurter.app/latest?from=EUR&to=USD')).then(j => { if (j?.rates?.USD) data.EURUSD = { close: j.rates.USD, change_pct: null, live: 'BCE (' + j.date + ')' }; }),
  ]);
  liveCache = { at: Date.now(), data };
  return data;
}
