// View 2 — Force-directed network. All people as nodes, colleagueship edges colored by degree.
// Degree 1–6 filter checkboxes add/remove edge classes. Node size toggle (connections ↔ experience).
// Color mode toggle (degree-of-strongest-link ↔ region). Drag, zoom/pan, click → side panel.
import { el } from '../widgets.js';
import {
  DEGREE_META, DEGREES, degreeColor, degreeLabel, regionOf, regionColor, REGION_COLORS,
  ACCENT, teacherName,
} from '../degrees.js';

export const view = {
  id: 'network', num: 2, title: 'Network',
  _sim: null,
  render(root, ctx) {
    const { data, idx, adj, counts, tooltip, state } = ctx;
    const self = this;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Force-directed network' }),
      el('p', { html: 'The whole community at once. Edges are colored by relationship degree; use the checkboxes to show/hide each degree class. Drag nodes, scroll to zoom, click a node for their postings.' }),
    ]));

    // ── Controls ──
    const controls = el('div.controls');
    const activeDeg = new Set(DEGREES);
    const checks = el('div.checkrow');
    DEGREES.forEach((d) => {
      const cb = el('input', { type: 'checkbox', checked: 'checked' });
      cb.addEventListener('change', () => { cb.checked ? activeDeg.add(d) : activeDeg.delete(d); applyFilter(); });
      checks.appendChild(el('label', {}, [cb, el('span.swatch', { style: `background:${DEGREE_META[d].color}` }), `${d}`]));
    });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Show degrees' }), checks]));

    let sizeMode = 'connections';
    const sizeSel = el('select', {}, [el('option', { value: 'connections', text: 'connection count' }), el('option', { value: 'experience', text: 'years experience' })]);
    sizeSel.addEventListener('change', () => { sizeMode = sizeSel.value; resize(); });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Node size' }), sizeSel]));

    let colorMode = 'degree';
    const colorSel = el('select', {}, [el('option', { value: 'degree', text: 'strongest link degree' }), el('option', { value: 'region', text: 'home region' })]);
    colorSel.addEventListener('change', () => { colorMode = colorSel.value; recolor(); legendBox.replaceWith(legendBox = buildLegend()); });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Color by' }), colorSel]));

    let legendBox = buildLegend();
    controls.appendChild(legendBox);
    root.appendChild(controls);

    // ── SVG canvas ──
    const wrap = el('div.viz-wrap', { style: 'position:relative;' });
    const W = wrap.clientWidth || (root.clientWidth - 50) || 900, H = 640;
    const svg = d3.create('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    wrap.appendChild(svg.node());
    root.appendChild(wrap);

    // side panel
    const panel = el('div.side-panel');
    wrap.appendChild(panel);

    const zoomG = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.2, 6]).on('zoom', (ev) => zoomG.attr('transform', ev.transform)));

    // ── Build graph (strongest link per pair drives node color in degree mode) ──
    const nodes = data.teachers.map((t) => ({
      id: t.TEACHER_ID, t, minDeg: 7, region: regionOf(homeCountry(t, idx)),
    }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const linkMap = new Map();
    for (const c of data.colleagueships) {
      const key = c.TEACHER_A_ID < c.TEACHER_B_ID ? `${c.TEACHER_A_ID}|${c.TEACHER_B_ID}` : `${c.TEACHER_B_ID}|${c.TEACHER_A_ID}`;
      const ex = linkMap.get(key);
      if (!ex || c.DEGREE < ex.degree) linkMap.set(key, { source: c.TEACHER_A_ID, target: c.TEACHER_B_ID, degree: c.DEGREE, label: c.SHARED_CONTEXT_LABEL, verified: c.VERIFIED });
    }
    const links = [...linkMap.values()];
    for (const l of links) {
      const a = nodeById.get(l.source), b = nodeById.get(l.target);
      if (a) a.minDeg = Math.min(a.minDeg, l.degree);
      if (b) b.minDeg = Math.min(b.minDeg, l.degree);
    }

    const link = zoomG.append('g').attr('stroke-opacity', 0.45).selectAll('line').data(links).join('line')
      .attr('stroke', (d) => degreeColor(d.degree)).attr('stroke-width', (d) => 2.2 - d.degree * 0.22)
      .attr('data-deg', (d) => d.degree);

    const node = zoomG.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('stroke', '#fff').attr('stroke-width', 1).style('cursor', 'pointer')
      .on('mousemove', (ev, d) => {
        tooltip.show(`<strong>${d.t.FULL_NAME}</strong><br>${d.t.SPECIALIZATION} · ${d.t.NATIONALITY}<br>` +
          `${counts.get(d.id) || 0} connections · ${d.t.YEARS_EXPERIENCE} yrs`, ev.clientX, ev.clientY);
      })
      .on('mouseleave', () => tooltip.hide())
      .on('click', (ev, d) => openPanel(d));

    node.call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => 30 + l.degree * 14).strength(0.25))
      .force('charge', d3.forceManyBody().strength(-26))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius((d) => sizeOf(d) + 2))
      .on('tick', ticked);
    self._sim = sim;

    function ticked() {
      link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
    }
    function sizeOf(d) {
      return sizeMode === 'experience'
        ? 3 + Math.sqrt(d.t.YEARS_EXPERIENCE || 1) * 1.7
        : 3 + Math.sqrt(counts.get(d.id) || 1) * 1.5;
    }
    function resize() { node.attr('r', sizeOf); sim.force('collide').radius((d) => sizeOf(d) + 2); sim.alpha(0.3).restart(); }
    function recolor() {
      node.attr('fill', (d) => colorMode === 'region' ? regionColor(homeCountry(d.t, idx)) : degreeColor(d.minDeg === 7 ? 6 : d.minDeg));
    }
    function applyFilter() {
      link.attr('display', (d) => activeDeg.has(d.degree) ? null : 'none');
    }

    function openPanel(d) {
      const postings = (idx.postingsByTeacher.get(d.id) || []);
      panel.innerHTML = '';
      panel.append(
        el('button.close', { text: '×', onclick: () => panel.classList.remove('open') }),
        el('h3', { text: d.t.FULL_NAME }),
        el('div.sub', { text: `${d.t.SPECIALIZATION} · ${d.t.NATIONALITY} · ${d.t.YEARS_EXPERIENCE} yrs · ${counts.get(d.id) || 0} connections` }),
        el('div', {}, [el('button.btn.ghost', { text: 'Open in ego graph →', onclick: () => ctx.navigateTo('ego', { teacher: d.id }) })]),
        el('h4', { text: 'Postings', style: 'margin:14px 0 4px;font-size:13px;' }),
        el('ul', {}, postings.map((p) => {
          const s = idx.schoolById.get(p.SCHOOL_ID) || {};
          return el('li', { html: `<strong>${p.POSITION_TITLE}</strong> — ${s.SCHOOL_NAME || p.SCHOOL_ID}` +
            `<small>${s.CITY || ''}, ${s.COUNTRY || ''} · ${(p.START_DATE || '').slice(0,4)}–${(p.END_DATE || '').slice(0,4) || 'present'} · ${p.SUBJECTS_TAUGHT || ''}</small>` });
        })),
      );
      panel.classList.add('open');
    }

    resize(); recolor(); applyFilter();

    // If we arrived focused on someone, gently pulse them.
    if (state.params.teacher) {
      const target = nodeById.get(state.params.teacher);
      if (target) node.filter((d) => d === target).attr('stroke', ACCENT).attr('stroke-width', 3);
    }

    this.teardown = () => { if (self._sim) self._sim.stop(); };

    function buildLegend() {
      const wrap = el('div.legend');
      if (colorMode === 'region') {
        Object.entries(REGION_COLORS).forEach(([r, c]) => wrap.appendChild(el('span.item', {}, [el('span.swatch', { style: `background:${c}` }), r])));
      } else {
        DEGREES.forEach((d) => wrap.appendChild(el('span.item', {}, [el('span.swatch', { style: `background:${DEGREE_META[d].color}` }), `deg ${d}`])));
      }
      return wrap;
    }
  },
};

// A teacher's "home country" = country of their current (or most recent) posting.
function homeCountry(t, idx) {
  const postings = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
  if (!postings.length) return null;
  const current = postings.find((p) => p.IS_CURRENT_POSITION === 'Yes') || postings[postings.length - 1];
  return (idx.schoolById.get(current.SCHOOL_ID) || {}).COUNTRY || null;
}
