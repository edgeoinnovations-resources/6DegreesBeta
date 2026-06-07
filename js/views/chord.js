// View 4 — Chord diagram. Country ↔ country (toggle: school ↔ school) migration flows derived
// from consecutive postings where posting N+1 crosses into a different country/school than N.
// Ribbon thickness = number of moves. Answers "where do teachers go next."
import { el } from '../widgets.js';
import { migrationMoves, regionColor, PRIMARY } from '../degrees.js';

export const view = {
  id: 'chord', num: 4, title: 'Chord',
  render(root, ctx) {
    const { data, idx, tooltip } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Migration chord diagram' }),
      el('p', { html: 'Where teachers move <em>next</em>. Each ribbon is a flow between two places, built from consecutive postings that cross a boundary; thickness = number of moves. Toggle country-level or school-level.' }),
    ]));

    let mode = 'COUNTRY';
    const controls = el('div.controls');
    const sel = el('select', {}, [
      el('option', { value: 'COUNTRY', text: 'country ↔ country' }),
      el('option', { value: 'SCHOOL_ID', text: 'school ↔ school' }),
    ]);
    sel.addEventListener('change', () => { mode = sel.value; draw(); });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Flows between' }), sel]));
    const note = el('div.control-group', {}, [el('span.muted', { text: '' })]);
    controls.appendChild(note);
    root.appendChild(controls);

    const wrap = el('div.viz-wrap', { style: 'display:flex;justify-content:center;' });
    root.appendChild(wrap);

    function draw() {
      wrap.innerHTML = '';
      const moves = migrationMoves(data, idx, mode === 'SCHOOL_ID' ? 'SCHOOL_ID' : 'COUNTRY');

      // Label + color per node depending on mode.
      const keyOf = (s) => mode === 'SCHOOL_ID' ? s.SCHOOL_ID : s.COUNTRY;
      const labelOf = (s) => mode === 'SCHOOL_ID' ? s.SCHOOL_NAME : s.COUNTRY;
      const colorOf = (s) => regionColor(s.COUNTRY);

      // Aggregate flows; keep only the busiest nodes for school mode (readability).
      const flow = new Map(); // "from|to" -> count
      const weight = new Map();
      const meta = new Map();
      for (const m of moves) {
        const a = keyOf(m.from), b = keyOf(m.to);
        if (a === b) continue;
        meta.set(a, m.from); meta.set(b, m.to);
        flow.set(`${a}|${b}`, (flow.get(`${a}|${b}`) || 0) + 1);
        weight.set(a, (weight.get(a) || 0) + 1);
        weight.set(b, (weight.get(b) || 0) + 1);
      }
      let names = [...weight.keys()].sort((x, y) => weight.get(y) - weight.get(x));
      if (mode === 'SCHOOL_ID') names = names.slice(0, 18); // top schools only
      const keep = new Set(names);
      const index = new Map(names.map((n, i) => [n, i]));
      const N = names.length;
      const matrix = Array.from({ length: N }, () => new Array(N).fill(0));
      for (const [k, v] of flow) {
        const [a, b] = k.split('|');
        if (!keep.has(a) || !keep.has(b)) continue;
        matrix[index.get(a)][index.get(b)] += v;
      }

      note.firstChild.textContent = `${moves.length} cross-${mode === 'SCHOOL_ID' ? 'school' : 'country'} moves · ${N} nodes`;

      const size = 640, outer = size / 2 - 110, inner = outer - 12;
      const svg = d3.create('svg').attr('width', size).attr('height', size).attr('viewBox', `0 0 ${size} ${size}`);
      const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);

      const chord = d3.chordDirected().padAngle(0.04).sortSubgroups(d3.descending)(matrix);
      const arc = d3.arc().innerRadius(inner).outerRadius(outer);
      const ribbon = d3.ribbonArrow().radius(inner - 1);
      const nodeColor = (i) => colorOf(meta.get(names[i]) || {});

      // Groups (arcs).
      const grp = g.append('g').selectAll('g').data(chord.groups).join('g');
      grp.append('path').attr('d', arc).attr('fill', (d) => nodeColor(d.index)).attr('stroke', '#fff')
        .on('mousemove', (ev, d) => tooltip.show(`<strong>${labelOf(meta.get(names[d.index]))}</strong><br>${d.value} moves in/out`, ev.clientX, ev.clientY))
        .on('mouseleave', () => tooltip.hide());
      grp.append('text').each((d) => { d.ang = (d.startAngle + d.endAngle) / 2; })
        .attr('dy', '0.32em')
        .attr('transform', (d) => `rotate(${(d.ang * 180) / Math.PI - 90}) translate(${outer + 6}) ${d.ang > Math.PI ? 'rotate(180)' : ''}`)
        .attr('text-anchor', (d) => (d.ang > Math.PI ? 'end' : null))
        .attr('font-size', 10).attr('fill', '#42525a')
        .text((d) => trunc(labelOf(meta.get(names[d.index])), 22));

      // Ribbons.
      g.append('g').attr('fill-opacity', 0.72).selectAll('path').data(chord).join('path')
        .attr('d', ribbon).attr('fill', (d) => nodeColor(d.source.index)).attr('stroke', '#fff').attr('stroke-width', 0.4)
        .on('mousemove', (ev, d) => tooltip.show(
          `<strong>${trunc(labelOf(meta.get(names[d.source.index])), 24)} → ${trunc(labelOf(meta.get(names[d.target.index])), 24)}</strong><br>${d.source.value} teacher move${d.source.value > 1 ? 's' : ''}`,
          ev.clientX, ev.clientY))
        .on('mouseleave', () => tooltip.hide());

      wrap.appendChild(svg.node());
    }
    draw();
  },
};

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
