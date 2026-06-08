// View 2 — Force-directed network. All people as nodes, colleagueship edges colored by degree.
// Degree 1–6 filter checkboxes add/remove edge classes. Node size toggle (connections ↔ experience).
// Color mode toggle (degree-of-strongest-link ↔ region).
//
// TWO layouts share one set of controls:
//   • 2D (D3 force) — drag nodes, zoom/pan, click → side panel.
//   • 3D (ForceGraph3D / Three.js) — drag to SPIN the cluster, scroll to FLY in/out,
//     an "auto-orbit" button to fly around it, and click a node to fly the camera to it.
// A "Spread" slider loosens the forces in either mode so the web isn't clustered tight.
import { el } from '../widgets.js';
import {
  DEGREE_META, DEGREES, degreeColor, regionOf, regionColor, REGION_COLORS, ACCENT,
} from '../degrees.js';

export const view = {
  id: 'network', num: 2, title: 'Network',
  _sim: null, _g3d: null, _orbit: null,
  render(root, ctx) {
    const { data, idx, counts, tooltip, state } = ctx;
    const self = this;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Force-directed network' }),
      el('p', { html: 'The whole community at once. Edges colored by relationship degree — the checkboxes show/hide each degree class. Use <strong>Spread</strong> to space the web out, and switch to <strong>3D</strong> to drag-spin the cluster, scroll to fly in/out, or auto-orbit around it.' }),
    ]));

    // ── Shared state ──
    let mode = '2d';
    let sizeMode = 'connections';
    let colorMode = 'degree';
    let spread = 4;                    // 1 (tight) … 10 (very spread)
    const activeDeg = new Set(DEGREES);

    // ── Build graph data ONCE (raw, engine-agnostic) ──
    const nodes = data.teachers.map((t) => ({ id: t.TEACHER_ID, t, minDeg: 7, region: regionOf(homeCountry(t, idx)) }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const linkMap = new Map();
    for (const c of data.colleagueships) {
      const key = c.TEACHER_A_ID < c.TEACHER_B_ID ? `${c.TEACHER_A_ID}|${c.TEACHER_B_ID}` : `${c.TEACHER_B_ID}|${c.TEACHER_A_ID}`;
      const ex = linkMap.get(key);
      if (!ex || c.DEGREE < ex.degree) linkMap.set(key, { a: c.TEACHER_A_ID, b: c.TEACHER_B_ID, degree: c.DEGREE, label: c.SHARED_CONTEXT_LABEL, verified: c.VERIFIED });
    }
    const rawLinks = [...linkMap.values()];
    for (const l of rawLinks) {
      const a = nodeById.get(l.a), b = nodeById.get(l.b);
      if (a) a.minDeg = Math.min(a.minDeg, l.degree);
      if (b) b.minDeg = Math.min(b.minDeg, l.degree);
    }

    // shared accessors
    const nodeColorOf = (n) => colorMode === 'region' ? regionColor(homeCountry(n.t, idx)) : degreeColor(n.minDeg === 7 ? 6 : n.minDeg);
    const sizeVal = (n) => sizeMode === 'experience' ? (n.t.YEARS_EXPERIENCE || 1) : (counts.get(n.id) || 1);
    const chargeStrength = () => -(spread * 30);
    const linkDist = (l) => spread * 20 + (l.degree || 1) * 12;

    // ── Controls ──
    const controls = el('div.controls');

    // mode toggle
    const modeSel = el('select', {}, [el('option', { value: '2d', text: '2D (flat)' }), el('option', { value: '3d', text: '3D (spin & fly)' })]);
    modeSel.addEventListener('change', () => setMode(modeSel.value));
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Layout' }), modeSel]));

    // spread slider
    const spreadSlider = el('input', { type: 'range', min: 1, max: 10, step: 1, value: spread, style: 'width:120px;' });
    const spreadVal = el('span.pill', { text: `${spread}` });
    spreadSlider.addEventListener('input', () => { spread = +spreadSlider.value; spreadVal.textContent = `${spread}`; applySpread(); });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Spread' }), spreadSlider, spreadVal]));

    // degree filter checkboxes
    const checks = el('div.checkrow');
    DEGREES.forEach((d) => {
      const cb = el('input', { type: 'checkbox', checked: 'checked' });
      cb.addEventListener('change', () => { cb.checked ? activeDeg.add(d) : activeDeg.delete(d); applyFilter(); });
      checks.appendChild(el('label', {}, [cb, el('span.swatch', { style: `background:${DEGREE_META[d].color}` }), `${d}`]));
    });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Show degrees' }), checks]));

    // node size
    const sizeSel = el('select', {}, [el('option', { value: 'connections', text: 'connection count' }), el('option', { value: 'experience', text: 'years experience' })]);
    sizeSel.addEventListener('change', () => { sizeMode = sizeSel.value; applySize(); });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Node size' }), sizeSel]));

    // color
    const colorSel = el('select', {}, [el('option', { value: 'degree', text: 'strongest link degree' }), el('option', { value: 'region', text: 'home region' })]);
    colorSel.addEventListener('change', () => { colorMode = colorSel.value; applyColor(); legendBox.replaceWith(legendBox = buildLegend()); });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Color by' }), colorSel]));

    // 3D-only: auto-orbit button (hidden in 2D)
    const orbitBtn = el('button.btn.accent', { text: '▶ Auto-orbit', style: 'display:none;', onclick: toggleOrbit });
    controls.appendChild(orbitBtn);

    let legendBox = buildLegend();
    controls.appendChild(legendBox);
    root.appendChild(controls);

    // ── Canvas wrap (holds both the 2D svg and the 3D container) ──
    const wrap = el('div.viz-wrap', { style: 'position:relative;' });
    const H = 640;
    const box2d = el('div', { style: 'position:relative;' });
    const box3d = el('div', { style: `position:relative;height:${H}px;display:none;background:#10242b;border-radius:8px;overflow:hidden;` });
    wrap.append(box2d, box3d);
    const panel = el('div.side-panel');
    wrap.appendChild(panel);
    root.appendChild(wrap);
    const hint = el('p.muted', { style: 'font-size:11.5px;margin:8px 2px 0;' });
    root.appendChild(hint);

    // ══════════════════════════════════════════════════════════════════════
    // 2D layout (D3)
    // ══════════════════════════════════════════════════════════════════════
    const W = wrap.clientWidth || (root.clientWidth - 50) || 900;
    const svg = d3.create('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    box2d.appendChild(svg.node());
    const zoomG = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.15, 6]).on('zoom', (ev) => zoomG.attr('transform', ev.transform)));

    const links2d = rawLinks.map((l) => ({ source: l.a, target: l.b, degree: l.degree, label: l.label, verified: l.verified }));
    const link2d = zoomG.append('g').attr('stroke-opacity', 0.45).selectAll('line').data(links2d).join('line')
      .attr('stroke', (d) => degreeColor(d.degree)).attr('stroke-width', (d) => 2.2 - d.degree * 0.22);

    const node2d = zoomG.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('stroke', '#fff').attr('stroke-width', 1).style('cursor', 'pointer')
      .on('mousemove', (ev, d) => tooltip.show(
        `<strong>${d.t.FULL_NAME}</strong><br>${d.t.SPECIALIZATION} · ${d.t.NATIONALITY}<br>${counts.get(d.id) || 0} connections · ${d.t.YEARS_EXPERIENCE} yrs`, ev.clientX, ev.clientY))
      .on('mouseleave', () => tooltip.hide())
      .on('click', (ev, d) => openPanel(d));

    node2d.call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    const radius2d = (d) => 3 + Math.sqrt(sizeVal(d)) * (sizeMode === 'experience' ? 1.7 : 1.5);
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links2d).id((d) => d.id).distance(linkDist).strength(0.22))
      .force('charge', d3.forceManyBody().strength(chargeStrength()))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius((d) => radius2d(d) + 2))
      .on('tick', () => {
        link2d.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
        node2d.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
      });
    self._sim = sim;
    node2d.attr('r', radius2d).attr('fill', nodeColorOf);
    if (state.params.teacher) {
      const tn = nodeById.get(state.params.teacher);
      if (tn) node2d.filter((d) => d === tn).attr('stroke', ACCENT).attr('stroke-width', 3);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 3D layout (ForceGraph3D) — built lazily on first switch to 3D
    // ══════════════════════════════════════════════════════════════════════
    let g3d = null, links3d = null;
    function init3D() {
      if (g3d || typeof ForceGraph3D === 'undefined') return;
      links3d = rawLinks.map((l) => ({ source: l.a, target: l.b, degree: l.degree, label: l.label, verified: l.verified }));
      const w = wrap.clientWidth || 900;
      g3d = ForceGraph3D()(box3d)
        .width(w).height(H)
        .backgroundColor('#10242b')
        .graphData({ nodes, links: links3d })
        .nodeId('id')
        .nodeLabel((n) => `<div style="font:12px -apple-system,sans-serif;padding:2px 4px;color:#fff;">
            <b>${n.t.FULL_NAME}</b><br>${n.t.SPECIALIZATION} · ${n.t.NATIONALITY}<br>${counts.get(n.id) || 0} connections</div>`)
        .nodeVal((n) => Math.max(1, sizeVal(n)))
        .nodeColor(nodeColorOf)
        .nodeOpacity(0.92)
        .nodeResolution(10)
        .linkColor((l) => degreeColor(l.degree))
        .linkWidth(0.6)
        .linkOpacity(0.4)
        .linkVisibility((l) => activeDeg.has(l.degree))
        .onNodeClick((n) => { flyToNode(n); openPanel(n); })
        .warmupTicks(40).cooldownTicks(120);
      // looser forces for legibility
      g3d.d3Force('charge').strength(chargeStrength());
      g3d.d3Force('link').distance(linkDist);
      self._g3d = g3d;
    }

    function flyToNode(n) {
      if (!g3d || n.x == null) return;
      const dist = 140;
      const r = 1 + dist / Math.hypot(n.x, n.y, n.z || 0.001);
      g3d.cameraPosition({ x: n.x * r, y: n.y * r, z: (n.z || 0) * r }, n, 1200);
    }

    function toggleOrbit() {
      if (self._orbit) { clearInterval(self._orbit); self._orbit = null; orbitBtn.textContent = '▶ Auto-orbit'; orbitBtn.classList.add('accent'); return; }
      if (!g3d) return;
      orbitBtn.textContent = '⏸ Stop orbit'; orbitBtn.classList.remove('accent');
      let angle = 0; const dist = 260 + spread * 60;
      self._orbit = setInterval(() => {
        g3d.cameraPosition({ x: dist * Math.sin(angle), z: dist * Math.cos(angle) }, { x: 0, y: 0, z: 0 }, 0);
        angle += Math.PI / 600;
      }, 30);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Shared dispatch
    // ══════════════════════════════════════════════════════════════════════
    function setMode(m) {
      mode = m;
      if (m === '3d') {
        init3D();
        box2d.style.display = 'none'; box3d.style.display = 'block'; orbitBtn.style.display = '';
        if (g3d) { g3d.resumeAnimation(); g3d.width(wrap.clientWidth || 900); }
        hint.innerHTML = g3d
          ? '<strong>Drag</strong> to spin · <strong>scroll</strong> to fly in/out · <strong>right-drag</strong> to pan · click a node to fly to it · <strong>Auto-orbit</strong> circles the cluster.'
          : '3D engine failed to load from CDN — staying in 2D.';
        if (!g3d) { mode = '2d'; modeSel.value = '2d'; box2d.style.display = ''; box3d.style.display = 'none'; orbitBtn.style.display = 'none'; }
      } else {
        box2d.style.display = ''; box3d.style.display = 'none'; orbitBtn.style.display = 'none';
        if (self._orbit) toggleOrbit();
        if (g3d) g3d.pauseAnimation();
        hint.innerHTML = '<strong>Drag</strong> a node to pull the web · <strong>scroll</strong> to zoom · click a node for their postings.';
      }
    }

    function applySpread() {
      sim.force('charge').strength(chargeStrength());
      sim.force('link').distance(linkDist);
      sim.alpha(0.6).restart();
      if (g3d) { g3d.d3Force('charge').strength(chargeStrength()); g3d.d3Force('link').distance(linkDist); g3d.d3ReheatSimulation(); }
    }
    function applyFilter() {
      link2d.attr('display', (d) => activeDeg.has(d.degree) ? null : 'none');
      if (g3d) g3d.linkVisibility((l) => activeDeg.has(l.degree));
    }
    function applySize() {
      node2d.attr('r', radius2d); sim.force('collide').radius((d) => radius2d(d) + 2); sim.alpha(0.3).restart();
      if (g3d) g3d.nodeVal((n) => Math.max(1, sizeVal(n)));
    }
    function applyColor() {
      node2d.attr('fill', nodeColorOf);
      if (g3d) g3d.nodeColor(nodeColorOf);
    }

    setMode('2d');

    // ── Side panel (shared) ──
    function openPanel(d) {
      const postings = idx.postingsByTeacher.get(d.id) || [];
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
            `<small>${s.CITY || ''}, ${s.COUNTRY || ''} · ${(p.START_DATE || '').slice(0, 4)}–${(p.END_DATE || '').slice(0, 4) || 'present'} · ${p.SUBJECTS_TAUGHT || ''}</small>` });
        })),
      );
      panel.classList.add('open');
    }

    // ── Teardown ──
    this.teardown = () => {
      if (self._orbit) { clearInterval(self._orbit); self._orbit = null; }
      if (self._sim) self._sim.stop();
      if (self._g3d) { try { self._g3d.pauseAnimation(); self._g3d._destructor && self._g3d._destructor(); } catch {} self._g3d = null; }
    };

    function buildLegend() {
      const w = el('div.legend');
      if (colorMode === 'region') {
        Object.entries(REGION_COLORS).forEach(([r, c]) => w.appendChild(el('span.item', {}, [el('span.swatch', { style: `background:${c}` }), r])));
      } else {
        DEGREES.forEach((d) => w.appendChild(el('span.item', {}, [el('span.swatch', { style: `background:${DEGREE_META[d].color}` }), `deg ${d}`])));
      }
      return w;
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
