// Rendu des blocs libres produits par Claude (aucun HTML brut n'est accepté)
import { esc, md, extLink, safeUrl, fmtDay } from './util.js?v=202611260959';
import { CONF } from './config.js?v=202611260959';

const PROB = { low: 'Probabilité faible', medium: 'Probabilité moyenne', high: 'Probabilité élevée' };
const TREND = { up: '▲', down: '▼', flat: '▬' };
const cell = v => typeof v === 'number' ? `<td class="num">${esc(v.toLocaleString('fr-FR'))}</td>` : `<td>${esc(v)}</td>`;
const srcLine = u => safeUrl(u) ? `<p class="bsrc">Source : ${extLink(u, new URL(u).hostname.replace(/^www\./, ''))}</p>` : '';
let mermaidId = 0;

function chartSvg(b) {
  const labels = (b.labels || []).map(String), series = (b.series || []).filter(s => Array.isArray(s.values)).slice(0, 5);
  const vals = series.flatMap(s => s.values.filter(v => typeof v === 'number'));
  if (!labels.length || !vals.length) return '<p class="meta">Graphique illisible.</p>';
  const W = 440, H = 230, P = { l: 44, r: 10, t: 12, b: 34 };
  let min = Math.min(...vals), max = Math.max(...vals);
  if (b.chart === 'bar') min = Math.min(0, min);
  if (min === max) { max += 1; min -= 1; }
  const pad = (max - min) * 0.08; if (b.chart !== 'bar' || min < 0) min -= pad; max += pad;
  const x = i => P.l + (labels.length === 1 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (labels.length - 1));
  const y = v => P.t + (H - P.t - P.b) * (1 - (v - min) / (max - min));
  const COLS = ['#2ec5d3', '#ff8a1f', '#f5c542', '#3ddc84', '#c792ea'];
  const ticks = 4, grid = [];
  for (let i = 0; i <= ticks; i++) { const v = min + (max - min) * i / ticks; grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="cg"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ct">${esc(Number(v.toPrecision(3)).toLocaleString('fr-FR'))}</text>`); }
  const step = Math.ceil(labels.length / 7);
  const bx = i => P.l + i * (W - P.l - P.r) / labels.length + 2;
  const bw = (W - P.l - P.r) / labels.length - 4;
  const xl = labels.map((l, i) => i % step ? '' : `<text x="${b.chart === 'bar' ? bx(i) + bw / 2 : x(i)}" y="${H - 12}" text-anchor="middle" class="ct">${esc(l.slice(0, 10))}</text>`);
  let marks = '';
  if (b.chart === 'bar') {
    const sw = bw / series.length;
    series.forEach((s, k) => s.values.forEach((v, i) => { if (typeof v !== 'number') return; const y0 = y(Math.max(0, min)), y1 = y(v); marks += `<rect x="${bx(i) + k * sw}" y="${Math.min(y0, y1)}" width="${Math.max(1, sw - 1)}" height="${Math.abs(y1 - y0)}" fill="${COLS[k]}" rx="1.5"><title>${esc(s.name || '')} ${esc(labels[i])} : ${esc(v)}</title></rect>`; }));
  } else {
    series.forEach((s, k) => {
      const pts = s.values.map((v, i) => typeof v === 'number' ? [x(i), y(v)] : null).filter(Boolean);
      marks += `<polyline fill="none" stroke="${COLS[k]}" stroke-width="2" points="${pts.map(p => p.join(',')).join(' ')}"/>` + pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${COLS[k]}"><title>${esc(s.name || '')} ${esc(labels[i])} : ${esc(s.values[i])}</title></circle>`).join('');
    });
  }
  const legend = series.length > 1 || series[0]?.name ? `<div class="legend-row">${series.map((s, k) => `<span><i style="background:${COLS[k]}"></i>${esc(s.name || '')}</span>`).join('')}</div>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(b.title || 'Graphique')}">${grid.join('')}${marks}${xl.join('')}</svg>${legend}`;
}

export function renderBlock(b) {
  const h = b.title ? `<h4>${esc(b.title)}</h4>` : '';
  switch (b.type) {
    case 'text': return `<div class="blk btext">${h}${md(b.md)}</div>`;
    case 'callout': return `<div class="blk callout ${['info', 'warning', 'critical', 'positive'].includes(b.tone) ? b.tone : 'info'}">${h}${md(b.md)}</div>`;
    case 'key_figures': return `<div class="blk">${h}<div class="kf">${(b.items || []).slice(0, 8).map(i => `<div><span class="kl">${esc(i.label)}</span><strong>${esc(i.value)}${i.unit ? `<small> ${esc(i.unit)}</small>` : ''}</strong>${i.delta || i.trend ? `<span class="kd ${esc(i.trend || '')}">${TREND[i.trend] || ''} ${esc(i.delta || '')}</span>` : ''}${safeUrl(i.source_url) ? `<a class="ks" href="${esc(i.source_url)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</div>`).join('')}</div></div>`;
    case 'table': return `<div class="blk">${h}<div class="scroll"><table class="tbl"><thead><tr>${(b.columns || []).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${(b.rows || []).slice(0, 40).map(r => `<tr>${(Array.isArray(r) ? r : []).map(cell).join('')}</tr>`).join('')}</tbody></table></div>${b.note ? `<p class="meta">${esc(b.note)}</p>` : ''}${srcLine(b.source_url)}</div>`;
    case 'chart': return `<div class="blk">${h}${chartSvg(b)}${b.unit ? `<p class="meta">Unité : ${esc(b.unit)}</p>` : ''}${srcLine(b.source_url)}</div>`;
    case 'timeline': return `<div class="blk">${h}<ul class="tl small">${(b.items || []).map(i => `<li><span class="meta">${esc(/^\d{4}-\d{2}-\d{2}$/.test(i.date) ? fmtDay(i.date, { day: 'numeric', month: 'short', year: 'numeric' }) : i.date)}</span> <b>${esc(i.label)}</b>${i.text ? `<br>${esc(i.text)}` : ''}</li>`).join('')}</ul></div>`;
    case 'diagram': return `<div class="blk">${h}<div class="mermaid-box" data-id="m${++mermaidId}"><pre class="mermaid-src">${esc(b.mermaid)}</pre></div></div>`;
    case 'scenarios': return `<div class="blk">${h || '<h4>Scénarios</h4>'}<div class="scen">${(b.items || []).map(s => `<div><b>${esc(s.name)}</b> <span class="prob ${esc(s.probability)}">${esc(PROB[s.probability] || s.probability || '')}</span><p>${esc(s.description || '')}</p>${s.signals?.length ? `<p class="meta">Signaux : ${s.signals.map(esc).join(' · ')}</p>` : ''}</div>`).join('')}</div></div>`;
    case 'links': return `<div class="blk">${h || '<h4>Pour aller plus loin</h4>'}<ul class="lnks">${(b.items || []).filter(i => safeUrl(i.url)).map(i => `<li>${extLink(i.url, i.title || i.url)}${i.outlet ? ` <span class="meta">· ${esc(i.outlet)}</span>` : ''}${i.why ? `<br><span class="meta">${esc(i.why)}</span>` : ''}</li>`).join('')}</ul></div>`;
    case 'image': { const u = safeUrl(b.url); if (!u) return ''; return `<figure class="blk img"><img src="${esc(u)}" alt="${esc(b.alt || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('figure').classList.add('broken')"><figcaption>${esc(b.caption || '')} <span class="meta">${esc(b.credit || '')}${b.license ? ' · ' + esc(b.license) : ''}${safeUrl(b.source_url) ? ' · ' + extLink(b.source_url, 'source') : ''}</span><span class="imgfail"> Image indisponible : ${extLink(u, 'ouvrir le lien')}</span></figcaption></figure>`; }
    case 'quote': return `<blockquote class="blk quote">« ${esc(String(b.text || '').split(/\s+/).slice(0, 30).join(' '))} »<footer>— ${esc(b.author || '')}${b.role ? `, ${esc(b.role)}` : ''} ${safeUrl(b.source_url) ? extLink(b.source_url, 'source') : ''}</footer></blockquote>`;
    case 'map_points': return `<div class="blk">${h || '<h4>Lieux sur la carte</h4>'}<ul class="lnks">${(b.points || []).map(p => `<li>◆ ${esc(p.name)}${p.note ? ` <span class="meta">· ${esc(p.note)}</span>` : ''}</li>`).join('')}</ul></div>`;
    default: return `<div class="blk"><p class="meta">Bloc « ${esc(b.type)} » non pris en charge.</p></div>`;
  }
}
export const renderBlocks = blocks => (blocks || []).map(renderBlock).join('');
export const mapPoints = blocks => (blocks || []).filter(b => b.type === 'map_points').flatMap(b => (b.points || []).filter(p => typeof p.lat === 'number' && typeof p.lng === 'number'));

// Mermaid : chargé à la demande, mode strict
let mermaidReady = null;
function loadMermaid() {
  if (mermaidReady) return mermaidReady;
  mermaidReady = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/mermaid.min.js?v=202611260959';
    s.onload = () => { window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', flowchart: { useMaxWidth: false }, timeline: { useMaxWidth: false }, mindmap: { useMaxWidth: false }, fontFamily: 'Inter, system-ui, sans-serif', themeVariables: { background: '#12171d', primaryColor: '#1a2027', primaryTextColor: '#e6ebf0', lineColor: '#8a96a3', primaryBorderColor: '#2ec5d3' } }); res(window.mermaid); };
    s.onerror = rej; document.head.appendChild(s);
  });
  return mermaidReady;
}
export async function hydrate(root) {
  const boxes = [...root.querySelectorAll('.mermaid-box:not([data-done])')];
  if (!boxes.length) return;
  let m; try { m = await loadMermaid(); } catch { return; }
  for (const box of boxes) {
    box.dataset.done = '1';
    const code = box.querySelector('.mermaid-src').textContent;
    try { const { svg } = await m.render('mmd-' + box.dataset.id + '-' + Date.now(), code); box.innerHTML = svg; }
    catch { box.insertAdjacentHTML('beforeend', '<p class="meta">Diagramme non affichable (syntaxe Mermaid invalide).</p>'); }
  }
}
export { CONF };
