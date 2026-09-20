// Explore — Build your own matrix. Cell = how many people were at BOTH schools (any time).
//
// Dee (12 Sep 2026): "Could the matrix be set up to search schools to add to each axis
// rather than all of them?"  Paul: "Ooo…this is a cool idea. Yup. We can add that. A
// build your own matrix function."
//
// That is now the only sane way to render this. The demo geography is 620 schools, and a
// full square would be 384,400 cells — enough to hang the browser. So you pick the
// schools on each axis, rows and columns independently, and the view starts from a
// useful default rather than everything.
import { el } from '../widgets.js';
import { PRIMARY, regionOf } from '../degrees.js';

const MAX_PER_AXIS = 40;

export const view = {
  id: 'matrix', num: 3, title: 'Matrix',
  render(root, ctx) {
    const { data, idx, tooltip, state } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Build your own matrix' }),
      el('p', { html: 'Each cell = how many people were at <em>both</em> schools, at any time. Pick the schools on each axis — searching for the handful you care about beats staring at all 620.' }),
    ]));

    const teachersOf = (sid) => idx.teachersBySchool.get(sid) || new Set();
    const shared = (a, b) => {
      const A = teachersOf(a), B = teachersOf(b);
      const small = A.size < B.size ? A : B, big = A.size < B.size ? B : A;
      const out = [];
      for (const t of small) if (big.has(t)) out.push(t);
      return out;
    };

    // ── Default axes ─────────────────────────────────────────────────────────
    // Start with the focused person's own schools, then pad with the schools that share
    // the most people with them — so the opening view is about you, not about nothing.
    const myPostings = idx.postingsByTeacher.get(state.me) || [];
    const mySchoolIds = [...new Set(myPostings.map((p) => p.SCHOOL_ID))];

    const scored = data.schools
      .map((s) => ({ s, n: mySchoolIds.reduce((acc, m) => acc + (m === s.SCHOOL_ID ? 0 : shared(m, s.SCHOOL_ID).length), 0) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((x) => x.s.SCHOOL_ID);

    const busiest = data.schools.slice()
      .sort((a, b) => teachersOf(b.SCHOOL_ID).size - teachersOf(a.SCHOOL_ID).size)
      .map((s) => s.SCHOOL_ID);

    const seedAxis = (want) => {
      const out = [];
      for (const id of [...mySchoolIds, ...scored, ...busiest]) {
        if (out.length >= want) break;
        if (!out.includes(id)) out.push(id);
      }
      return out;
    };

    let rows = seedAxis(10);
    let cols = seedAxis(10);

    // ── Axis editors ─────────────────────────────────────────────────────────
    const byId = (id) => idx.schoolById.get(id) || {};
    const label = (id) => { const s = byId(id); return `${s.SCHOOL_NAME || id}${s.CITY ? ` · ${s.CITY}` : ''}`; };

    function axisEditor(title, getList, setList) {
      const box = el('div.axis-box');
      const chips = el('div.chips');
      const input = el('input', { type: 'search', placeholder: 'Add a school…', autocomplete: 'off' });
      const results = el('div.results');
      results.style.display = 'none';

      const redrawChips = () => {
        chips.innerHTML = '';
        const list = getList();
        if (!list.length) chips.appendChild(el('span.muted', { style: 'font-size:12px;', text: 'No schools on this axis yet.' }));
        list.forEach((id) => {
          const chip = el('span.chip', {}, [el('span', { text: label(id) })]);
          const x = el('button', { type: 'button', text: '×', title: 'Remove' });
          x.addEventListener('click', () => { setList(getList().filter((y) => y !== id)); redrawChips(); draw(); });
          chip.appendChild(x);
          chips.appendChild(chip);
        });
      };

      const closeResults = () => { results.style.display = 'none'; };
      const renderResults = () => {
        const q = input.value.trim().toLowerCase();
        const list = getList();
        const matches = data.schools
          .filter((s) => !list.includes(s.SCHOOL_ID))
          .filter((s) => !q || `${s.SCHOOL_NAME} ${s.CITY} ${s.COUNTRY}`.toLowerCase().includes(q))
          .slice(0, 40);
        results.innerHTML = '';
        matches.forEach((s) => {
          const row = el('div', { html: `${s.SCHOOL_NAME} <small>· ${s.CITY}, ${s.COUNTRY} · ${teachersOf(s.SCHOOL_ID).size} people</small>` });
          row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const cur = getList();
            if (cur.length >= MAX_PER_AXIS) { input.value = ''; closeResults(); return; }
            setList([...cur, s.SCHOOL_ID]);
            input.value = '';
            closeResults();
            redrawChips();
            draw();
          });
          results.appendChild(row);
        });
        results.style.display = matches.length ? 'block' : 'none';
      };

      input.addEventListener('focus', renderResults);
      input.addEventListener('input', renderResults);
      input.addEventListener('blur', () => setTimeout(closeResults, 120));

      const head = el('div.axis-head', {}, [el('strong', { text: title })]);
      const clear = el('button.btn.ghost', { type: 'button', text: 'Clear' });
      clear.addEventListener('click', () => { setList([]); redrawChips(); draw(); });
      const mine = el('button.btn.ghost', { type: 'button', text: 'My schools' });
      mine.addEventListener('click', () => { setList(mySchoolIds.slice(0, MAX_PER_AXIS)); redrawChips(); draw(); });
      head.append(mine, clear);

      const ta = el('div.typeahead');
      ta.append(input, results);
      box.append(head, ta, chips);
      redrawChips();
      return box;
    }

    const editors = el('div.axis-grid');
    editors.append(
      axisEditor('Rows', () => rows, (v) => { rows = v; }),
      axisEditor('Columns', () => cols, (v) => { cols = v; }),
    );
    root.appendChild(editors);

    const wrap = el('div.viz-wrap', { style: 'overflow:auto;' });
    root.appendChild(wrap);

    // ── Draw ─────────────────────────────────────────────────────────────────
    function draw() {
      wrap.innerHTML = '';
      if (!rows.length || !cols.length) {
        wrap.appendChild(el('div.card', { text: 'Add at least one school to each axis.' }));
        return;
      }
      const R = rows.map(byId), C = cols.map(byId);
      const cell = 22, pad = 230, top = 180;
      const W = pad + C.length * cell + 30, H = top + R.length * cell + 30;
      const svg = d3.create('svg').attr('width', W).attr('height', H);

      let max = 1;
      const M = R.map((r) => C.map((c) => {
        const v = r.SCHOOL_ID === c.SCHOOL_ID ? teachersOf(r.SCHOOL_ID).size : shared(r.SCHOOL_ID, c.SCHOOL_ID).length;
        if (r.SCHOOL_ID !== c.SCHOOL_ID && v > max) max = v;
        return v;
      }));
      const color = d3.scaleSequential(d3.interpolate('#eef6f8', PRIMARY)).domain([0, max]);
      const g = svg.append('g');

      g.append('g').selectAll('text').data(C).join('text')
        .attr('transform', (d, j) => `translate(${pad + j * cell + cell / 2}, ${top - 8}) rotate(-55)`)
        .attr('font-size', 10).attr('fill', '#42525a')
        .text((d) => trunc(`${d.SCHOOL_NAME} · ${d.CITY}`, 30));

      g.append('g').selectAll('text').data(R).join('text')
        .attr('x', pad - 8).attr('y', (d, i) => top + i * cell + cell / 2 + 3).attr('text-anchor', 'end')
        .attr('font-size', 10).attr('fill', '#42525a')
        .text((d) => trunc(`${d.SCHOOL_NAME} · ${d.CITY}`, 36));

      const cells = g.append('g');
      R.forEach((r, i) => C.forEach((c, j) => {
        const v = M[i][j];
        const self = r.SCHOOL_ID === c.SCHOOL_ID;
        cells.append('rect')
          .attr('x', pad + j * cell).attr('y', top + i * cell)
          .attr('width', cell - 2).attr('height', cell - 2).attr('rx', 2)
          .attr('fill', self ? '#dfeef1' : (v === 0 ? '#fafcfc' : color(v)))
          .attr('stroke', '#fff')
          .style('cursor', v ? 'pointer' : 'default')
          .on('mousemove', (ev) => {
            if (self) {
              tooltip.show(`<strong>${r.SCHOOL_NAME}</strong><br>${v} people in total`, ev.clientX, ev.clientY);
            } else if (v) {
              const ids = shared(r.SCHOOL_ID, c.SCHOOL_ID);
              const names = ids.slice(0, 8).map((t) => (idx.teacherById.get(t) || {}).FULL_NAME || t);
              tooltip.show(`<strong>${v} shared</strong> · ${trunc(r.SCHOOL_NAME, 26)} ↔ ${trunc(c.SCHOOL_NAME, 26)}<br><em>${names.join(', ')}${ids.length > 8 ? '…' : ''}</em>`, ev.clientX, ev.clientY);
            } else {
              tooltip.show(`No shared people<br><small>${trunc(r.SCHOOL_NAME, 26)} ↔ ${trunc(c.SCHOOL_NAME, 26)}</small>`, ev.clientX, ev.clientY);
            }
          })
          .on('mouseleave', () => tooltip.hide());

        if (v && !self) {
          cells.append('text')
            .attr('x', pad + j * cell + (cell - 2) / 2).attr('y', top + i * cell + (cell - 2) / 2 + 3)
            .attr('text-anchor', 'middle').attr('font-size', 9)
            .attr('fill', v > max * 0.55 ? '#fff' : '#42525a')
            .style('pointer-events', 'none').text(v);
        }
      }));

      wrap.appendChild(svg.node());
      wrap.appendChild(el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#6a7a82;' }, [
        el('span', { text: '0 shared' }),
        el('span', { style: `display:inline-block;width:160px;height:12px;border-radius:3px;background:linear-gradient(90deg,#eef6f8,${PRIMARY});` }),
        el('span', { text: `${max} shared` }),
        el('span', { style: 'margin-left:10px;', text: `${rows.length} × ${cols.length} schools` }),
      ]));
    }

    draw();
  },
};

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
