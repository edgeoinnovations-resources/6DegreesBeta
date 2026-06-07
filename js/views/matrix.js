// View 3 — Adjacency matrix. Schools × schools heatmap; cell intensity = number of teachers
// who taught at BOTH schools. Rows/cols ordered by country cluster (or by shared-teacher count)
// so dense blocks surface. Hover a cell → the shared teachers. The readable answer to the hairball.
import { el } from '../widgets.js';
import { PRIMARY, regionOf } from '../degrees.js';

export const view = {
  id: 'matrix', num: 3, title: 'Matrix',
  render(root, ctx) {
    const { data, idx, tooltip } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'School × school adjacency matrix' }),
      el('p', { html: 'Each cell = how many teachers taught at <em>both</em> schools (any time). Darker = more shared people. Order by country to reveal regional clusters as dense blocks — the legible alternative to a hairball.' }),
    ]));

    // Build school → set of teachers, then pairwise shared counts.
    const schools = data.schools.slice();
    const teachersOf = (sid) => idx.teachersBySchool.get(sid) || new Set();
    const sharedCount = (a, b) => {
      const A = teachersOf(a), B = teachersOf(b);
      let n = 0; const small = A.size < B.size ? A : B; const big = A.size < B.size ? B : A;
      for (const t of small) if (big.has(t)) n++;
      return n;
    };
    const sharedTeachers = (a, b) => {
      const A = teachersOf(a), B = teachersOf(b), out = [];
      for (const t of A) if (B.has(t)) out.push(t);
      return out;
    };

    let order = 'country';
    const controls = el('div.controls');
    const sel = el('select', {}, [
      el('option', { value: 'country', text: 'country cluster' }),
      el('option', { value: 'shared', text: 'most-shared first' }),
      el('option', { value: 'name', text: 'alphabetical' }),
    ]);
    sel.addEventListener('change', () => { order = sel.value; draw(); });
    controls.appendChild(el('div.control-group', {}, [el('label', { text: 'Order rows/cols by' }), sel]));
    root.appendChild(controls);

    const wrap = el('div.viz-wrap', { style: 'overflow:auto;' });
    root.appendChild(wrap);

    function ordered() {
      const list = schools.slice();
      if (order === 'country') {
        list.sort((a, b) => (regionOf(a.COUNTRY)).localeCompare(regionOf(b.COUNTRY))
          || a.COUNTRY.localeCompare(b.COUNTRY) || a.CITY.localeCompare(b.CITY));
      } else if (order === 'name') {
        list.sort((a, b) => a.SCHOOL_NAME.localeCompare(b.SCHOOL_NAME));
      } else {
        const total = new Map(list.map((s) => [s.SCHOOL_ID, 0]));
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const c = sharedCount(list[i].SCHOOL_ID, list[j].SCHOOL_ID);
          total.set(list[i].SCHOOL_ID, total.get(list[i].SCHOOL_ID) + c);
          total.set(list[j].SCHOOL_ID, total.get(list[j].SCHOOL_ID) + c);
        }
        list.sort((a, b) => total.get(b.SCHOOL_ID) - total.get(a.SCHOOL_ID));
      }
      return list;
    }

    function draw() {
      wrap.innerHTML = '';
      const list = ordered();
      const n = list.length;
      const cell = 15, pad = 170, top = 170;
      const W = pad + n * cell + 20, H = top + n * cell + 20;
      const svg = d3.create('svg').attr('width', W).attr('height', H);

      // Precompute matrix + max.
      let max = 1;
      const M = [];
      for (let i = 0; i < n; i++) {
        M[i] = [];
        for (let j = 0; j < n; j++) {
          const v = i === j ? teachersOf(list[i].SCHOOL_ID).size : sharedCount(list[i].SCHOOL_ID, list[j].SCHOOL_ID);
          M[i][j] = v; if (i !== j && v > max) max = v;
        }
      }
      const color = d3.scaleSequential(d3.interpolate('#eef6f8', PRIMARY)).domain([0, max]);

      const g = svg.append('g');
      // Column labels (rotated).
      g.append('g').selectAll('text').data(list).join('text')
        .attr('transform', (d, j) => `translate(${pad + j * cell + cell / 2}, ${top - 6}) rotate(-60)`)
        .attr('font-size', 9).attr('fill', '#42525a').text((d) => trunc(d.SCHOOL_NAME, 22));
      // Row labels.
      g.append('g').selectAll('text').data(list).join('text')
        .attr('x', pad - 6).attr('y', (d, i) => top + i * cell + cell / 2 + 3).attr('text-anchor', 'end')
        .attr('font-size', 9).attr('fill', '#42525a').text((d) => trunc(`${d.SCHOOL_NAME} · ${d.CITY}`, 26));

      const rows = g.append('g');
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const v = M[i][j];
          rows.append('rect')
            .attr('x', pad + j * cell).attr('y', top + i * cell).attr('width', cell - 1).attr('height', cell - 1)
            .attr('fill', i === j ? '#dfeef1' : (v === 0 ? '#fafcfc' : color(v)))
            .attr('stroke', '#fff').style('cursor', v ? 'pointer' : 'default')
            .on('mousemove', (ev) => {
              if (i === j) {
                tooltip.show(`<strong>${list[i].SCHOOL_NAME}</strong><br>${v} teachers total`, ev.clientX, ev.clientY);
              } else if (v) {
                const ids = sharedTeachers(list[i].SCHOOL_ID, list[j].SCHOOL_ID);
                const names = ids.slice(0, 8).map((t) => (idx.teacherById.get(t) || {}).FULL_NAME || t);
                tooltip.show(`<strong>${v} shared</strong> · ${trunc(list[i].SCHOOL_NAME, 24)} ↔ ${trunc(list[j].SCHOOL_NAME, 24)}<br><em>${names.join(', ')}${ids.length > 8 ? '…' : ''}</em>`, ev.clientX, ev.clientY);
              } else tooltip.hide();
            })
            .on('mouseleave', () => tooltip.hide());
        }
      }
      wrap.appendChild(svg.node());

      // gradient legend
      const leg = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#6a7a82;' }, [
        el('span', { text: '0 shared' }),
        el('span', { style: `display:inline-block;width:160px;height:12px;border-radius:3px;background:linear-gradient(90deg,#eef6f8,${PRIMARY});` }),
        el('span', { text: `${max} shared` }),
      ]);
      wrap.appendChild(leg);
    }
    draw();
  },
};

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
