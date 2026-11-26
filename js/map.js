// Carte du monde (d3 + world-atlas, aucune tuile externe)
import { SEV, SEV_COLOR, SEV_RANK, THEME_LABEL } from './config.js?v=202611261032';
import { esc } from './util.js?v=202611261032';

export class WorldMap {
  constructor(svgEl, wrapEl, tipEl, onSelect) {
    const d3 = window.d3;
    this.el = svgEl; this.wrap = wrapEl; this.tip = tipEl; this.onSelect = onSelect;
    this.svg = d3.select(svgEl); this.g = this.svg.append('g');
    this.gLand = this.g.append('g'); this.gArc = this.g.append('g'); this.gPts = this.g.append('g'); this.gMk = this.g.append('g');
    this.k = 1; this.world = null; this.data = { events: [], ghosts: [], arcs: [], points: [], sel: null };
    this.proj = d3.geoNaturalEarth1(); this.path = d3.geoPath(this.proj);
    this.zoom = d3.zoom().scaleExtent([1, 14]).on('zoom', ev => { this.g.attr('transform', ev.transform); this.k = ev.transform.k; this.rescale(); });
    // Sur mobile : un doigt fait défiler la page, deux doigts déplacent/zooment la carte
    this.zoom.filter(ev => (ev.type === 'touchstart' ? ev.touches.length > 1 : (!ev.ctrlKey || ev.type === 'wheel') && !ev.button));
    this.svg.call(this.zoom).on('dblclick.zoom', null);
    new ResizeObserver(() => this.layout()).observe(svgEl);
  }
  zoomBy(f) { this.svg.transition().duration(250).call(this.zoom.scaleBy, f); }
  reset() { this.svg.transition().duration(250).call(this.zoom.transform, window.d3.zoomIdentity); }
  focus(lng, lat) {
    const [x, y] = this.proj([lng, lat]); const W = this.el.clientWidth, H = this.el.clientHeight; const k = Math.max(this.k, 2.2);
    this.svg.transition().duration(500).call(this.zoom.transform, window.d3.zoomIdentity.translate(W / 2 - k * x, H / 2 - k * y).scale(k));
  }
  setWorld(topo) { this.world = window.topojson.feature(topo, topo.objects.countries); this.layout(); }
  layout() {
    const d3 = window.d3, W = this.el.clientWidth, H = this.el.clientHeight; if (!W || !H) return;
    this.svg.attr('viewBox', `0 0 ${W} ${H}`);
    this.proj = d3.geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' }); this.path = d3.geoPath(this.proj);
    this.gLand.html('');
    this.gLand.append('path').attr('class', 'sphere').attr('d', this.path({ type: 'Sphere' }));
    this.gLand.append('path').attr('class', 'grat').attr('d', this.path(d3.geoGraticule10()));
    if (this.world) this.gLand.append('path').attr('class', 'land').attr('d', this.path(this.world));
    this.draw();
  }
  pos(e) { return this.proj([e.location.lng, e.location.lat]); }
  rescale() {
    const k = this.k;
    this.gMk.selectAll('.mk').attr('transform', d => `translate(${this.pos(d.e)}) scale(${1 / k})`);
    this.gPts.selectAll('.pt').attr('transform', d => `translate(${this.proj([d.lng, d.lat])}) scale(${1 / k})`);
    this.gArc.selectAll('path').attr('stroke-width', 1.4 / k);
  }
  render(data) { this.data = data; this.draw(); }
  draw() {
    const { events, ghosts, arcs, points, sel } = this.data;
    const all = [...events.map(v => ({ ...v, ghost: false })), ...ghosts.map(v => ({ ...v, ghost: true }))].filter(v => v.e.location);
    // Arcs de causalité
    this.gArc.selectAll('*').remove();
    for (const [a, b, causal] of arcs) if (a.location && b.location)
      this.gArc.append('path').attr('class', causal ? 'arc' : 'arc rel').attr('stroke-width', 1.4 / this.k).attr('d', this.path({ type: 'LineString', coordinates: [[a.location.lng, a.location.lat], [b.location.lng, b.location.lat]] }));
    // Points secondaires
    const pts = this.gPts.selectAll('.pt').data(points, d => d.name + d.lat + d.lng);
    pts.exit().remove();
    pts.enter().append('path').attr('class', 'pt').attr('d', 'M0,-5L5,0L0,5L-5,0Z')
      .on('mouseenter', (ev, d) => this.showTip(ev, `<b>${esc(d.name)}</b>${d.note ? `<br><span class="meta">${esc(d.note)}</span>` : ''}`))
      .on('mousemove', ev => this.moveTip(ev)).on('mouseleave', () => this.hideTip());
    // Repères
    const sel_ = this.gMk.selectAll('.mk').data(all, d => d.id);
    sel_.exit().remove();
    const en = sel_.enter().append('g').attr('class', 'mk').attr('tabindex', 0).attr('role', 'button');
    en.append('circle').attr('class', 'halo'); en.append('circle').attr('class', 'ring').attr('r', 11); en.append('circle').attr('class', 'core');
    en.on('click', (ev, d) => this.onSelect(d.id)).on('keydown', (ev, d) => { if (ev.key === 'Enter') this.onSelect(d.id); })
      .on('mouseenter', (ev, d) => this.showTip(ev, `<b>${esc(d.e.title)}</b><br><span class="meta">${esc(d.e.location.name)} · ${SEV[d.sev]}${d.ghost ? ' · hors fenêtre' : ''}</span><br><span class="meta">${(d.e.themes || []).map(t => esc(THEME_LABEL[t])).join(' · ')}</span>`))
      .on('mousemove', ev => this.moveTip(ev)).on('mouseleave', () => this.hideTip());
    const m = en.merge(sel_).sort((a, b) => (a.ghost - b.ghost) || SEV_RANK[a.sev] - SEV_RANK[b.sev] || (a.id === sel) - (b.id === sel));
    m.attr('class', d => `mk ${d.sev}${d.ghost ? ' ghost' : ''}${sel === d.id ? ' sel' : ''}`).attr('aria-label', d => d.e.title);
    m.select('.core').attr('r', d => d.sev === 'critical' ? 7 : d.sev === 'high' ? 6 : 5).attr('fill', d => d.ghost ? 'transparent' : SEV_COLOR[d.sev]).attr('stroke', d => d.ghost ? SEV_COLOR[d.sev] : '#0b0e12').attr('stroke-width', d => d.ghost ? 2 : 1.5);
    m.select('.halo').attr('stroke', d => SEV_COLOR[d.sev]).attr('r', 6);
    m.select('.ring').attr('stroke', d => sel === d.id ? '#fff' : 'none').attr('fill', 'none');
    this.rescale();
  }
  showTip(ev, html) { this.tip.innerHTML = html; this.tip.style.display = 'block'; this.moveTip(ev); }
  moveTip(ev) { const r = this.wrap.getBoundingClientRect(); this.tip.style.left = Math.min(ev.clientX - r.left + 14, r.width - 270) + 'px'; this.tip.style.top = (ev.clientY - r.top + 14) + 'px'; }
  hideTip() { this.tip.style.display = 'none'; }
}
