// View 1 — Ego graph. Concentric rings centered on a chosen teacher (default T001).
// Ring radius = relationship degree (1 closest … 6 outermost). Node color = degree,
// node size = that person's total connection count. Hover = why connected. mutual = orange badge.
import { el, teacherTypeahead } from '../widgets.js';
import { DEGREE_META, DEGREES, degreeColor, degreeLabel, ACCENT, teacherName } from '../degrees.js';

export const view = {
  id: 'ego', num: 1, title: 'Ego graph',
  render(root, ctx) {
    const { data, idx, adj, counts, tooltip, state } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Ego graph' }),
      el('p', { html: 'Concentric rings around one teacher. Ring = relationship degree (1 closest … 6 outermost), color = degree, node size = total connections. Hover a node for <em>why</em> the link exists; click any node to re-center. The orange badge marks a <strong>mutually verified</strong> link.' }),
    ]));

    const controls = el('div.controls');
    const picker = el('div.control-group', {}, [el('label', { text: 'Center on' })]);
    picker.appendChild(teacherTypeahead(data.teachers, idx, (id) => { state.egoTeacher = id; draw(); ctx.refreshHeader(); },
      { value: state.egoTeacher }));
    controls.appendChild(picker);
    controls.appendChild(legend());
    root.appendChild(controls);

    const wrap = el('div.viz-wrap');
    const svg = d3.create('svg').attr('width', '100%').attr('height', 620).style('display', 'block');
    wrap.appendChild(svg.node());
    root.appendChild(wrap);

    function draw() {
      svg.selectAll('*').remove();
      const ego = state.egoTeacher;
      const W = wrap.clientWidth || 900;
      const H = 620;
      const cx = W / 2, cy = H / 2;
      const maxR = Math.min(W, H) / 2 - 60;
      const ringR = (d) => (maxR * d) / 6;

      const g = svg.attr('viewBox', `0 0 ${W} ${H}`).append('g');

      // Concentric guide rings + labels.
      const rings = g.append('g');
      DEGREES.forEach((d) => {
        rings.append('circle').attr('cx', cx).attr('cy', cy).attr('r', ringR(d))
          .attr('fill', 'none').attr('stroke', DEGREE_META[d].color).attr('stroke-opacity', 0.35)
          .attr('stroke-dasharray', '3 4');
        rings.append('text').attr('x', cx).attr('y', cy - ringR(d) - 4)
          .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', DEGREE_META[d].color)
          .text(`degree ${d}`);
      });

      // Neighbors of ego, keep the strongest (lowest-degree) link per person.
      const best = new Map();
      for (const e of adj.get(ego) || []) {
        const cur = best.get(e.other);
        if (!cur || e.degree < cur.degree) best.set(e.other, e);
      }
      const neighbors = [...best.entries()].map(([other, e]) => ({ id: other, ...e }));

      // Lay each neighbor on its degree ring; spread angularly within the degree group.
      const byDeg = d3.group(neighbors, (n) => n.degree);
      const placed = [];
      for (const d of DEGREES) {
        const grp = byDeg.get(d) || [];
        const r = ringR(d);
        grp.forEach((n, i) => {
          const ang = (2 * Math.PI * i) / Math.max(grp.length, 1) - Math.PI / 2 + (d * 0.18);
          placed.push({ ...n, x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
        });
      }

      // Edges ego → neighbor.
      g.append('g').selectAll('line').data(placed).join('line')
        .attr('x1', cx).attr('y1', cy).attr('x2', (d) => d.x).attr('y2', (d) => d.y)
        .attr('stroke', (d) => degreeColor(d.degree)).attr('stroke-opacity', 0.5).attr('stroke-width', 1.4);

      const rScale = d3.scaleSqrt()
        .domain([1, d3.max([...counts.values()]) || 1]).range([5, 18]);

      // Neighbor nodes.
      const node = g.append('g').selectAll('g.node').data(placed).join('g')
        .attr('class', 'node').attr('transform', (d) => `translate(${d.x},${d.y})`)
        .style('cursor', 'pointer')
        .on('mousemove', (ev, d) => {
          const t = idx.teacherById.get(d.id);
          const badge = d.verified === 'mutual' ? '<span class="badge-mutual">mutual ✓</span>' : '';
          tooltip.show(
            `<strong>${t.FULL_NAME}</strong>${badge}<br>${t.SPECIALIZATION} · ${t.NATIONALITY}<br>` +
            `<span style="color:${degreeColor(d.degree)}">●</span> Degree ${d.degree} — ${degreeLabel(d.degree)}<br>` +
            `<em>${d.label}${d.overlap ? ` · ${d.overlap}` : ''}</em> · ${d.verified}`,
            ev.clientX, ev.clientY);
        })
        .on('mouseleave', () => tooltip.hide())
        .on('click', (ev, d) => { state.egoTeacher = d.id; draw(); ctx.refreshHeader(); });

      node.append('circle')
        .attr('r', (d) => rScale(counts.get(d.id) || 1))
        .attr('fill', (d) => degreeColor(d.degree))
        .attr('stroke', (d) => (d.verified === 'mutual' ? ACCENT : '#fff'))
        .attr('stroke-width', (d) => (d.verified === 'mutual' ? 2.5 : 1.2));

      node.filter((d) => d.verified === 'mutual').append('circle')
        .attr('r', (d) => rScale(counts.get(d.id) || 1) + 4).attr('fill', 'none')
        .attr('stroke', ACCENT).attr('stroke-width', 1).attr('stroke-opacity', 0.6);

      node.append('text').attr('y', (d) => -rScale(counts.get(d.id) || 1) - 5)
        .attr('text-anchor', 'middle').attr('font-size', 9.5).attr('fill', '#42525a')
        .text((d) => teacherName(idx, d.id).split(' ')[0]);

      // Ego in the center.
      const egoT = idx.teacherById.get(ego);
      const center = g.append('g').attr('transform', `translate(${cx},${cy})`);
      center.append('circle').attr('r', 26).attr('fill', ACCENT).attr('stroke', '#fff').attr('stroke-width', 3);
      center.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('fill', '#fff').attr('font-size', 11).attr('font-weight', 700)
        .text(egoT ? egoT.FIRST_NAME : ego);
      center.append('text').attr('text-anchor', 'middle').attr('y', 42)
        .attr('font-size', 12).attr('font-weight', 600).attr('fill', '#1f2a30')
        .text(egoT ? egoT.FULL_NAME : ego);

      // Count summary under the picker.
      const summary = DEGREES.map((d) => `${(byDeg.get(d) || []).length}×deg${d}`).join('  ·  ');
      let s = root.querySelector('.ego-summary');
      if (!s) { s = el('p.muted.ego-summary', { style: 'margin:8px 2px 0;font-size:12px;' }); root.appendChild(s); }
      s.textContent = `${neighbors.length} direct connections — ${summary}`;
    }

    draw();
  },
};

function legend() {
  const wrap = el('div.legend');
  DEGREES.forEach((d) => wrap.appendChild(el('span.item', {}, [
    el('span.swatch', { style: `background:${DEGREE_META[d].color}` }),
    el('span', { text: `${d} · ${DEGREE_META[d].short}` }),
  ])));
  return wrap;
}
