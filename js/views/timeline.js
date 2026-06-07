// View 6 — Timeline (Gantt). One row per teacher, horizontal bars per posting (x = year).
// Color by school or region. A year slider scrubs a vertical "now" line. When the two
// COMPARED teachers were in the same school / city / country at the same time, that span is
// highlighted — you watch a relationship degree forming. Defaults to T001 vs T002 (same-school overlap).
import { el, teacherTypeahead } from '../widgets.js';
import { regionOf, regionColor, parseYear, postingYears, ACCENT, PRIMARY } from '../degrees.js';

const NOW = 2026;

export const view = {
  id: 'timeline', num: 6, title: 'Timeline',
  render(root, ctx) {
    const { data, idx, tooltip, state } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Career timeline (Gantt)' }),
      el('p', { html: 'Every teacher\'s postings on one time axis. Pick two people to compare — where they shared a <em>school, city, or country at the same time</em>, the overlap is highlighted: that is a relationship degree forming. Drag the year slider to scrub the "now" line.' }),
    ]));

    let colorBy = 'region';
    let A = state.params.compareA || 'T001';
    let B = state.params.compareB || 'T002';

    const controls = el('div.controls');
    const aBox = el('div.control-group', {}, [el('label', { text: 'Compare A' })]);
    aBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { A = id; redraw(); }, { value: A }));
    const bBox = el('div.control-group', {}, [el('label', { text: 'vs B' })]);
    bBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { B = id; redraw(); }, { value: B }));
    const colorSel = el('select', {}, [el('option', { value: 'region', text: 'region' }), el('option', { value: 'school', text: 'school' })]);
    colorSel.addEventListener('change', () => { colorBy = colorSel.value; redraw(); });
    controls.append(aBox, bBox, el('div.control-group', {}, [el('label', { text: 'Color by' }), colorSel]));
    root.appendChild(controls);

    const overlapNote = el('div.card', { style: 'margin-bottom:12px;' });
    root.appendChild(overlapNote);

    // Year axis domain.
    let minY = NOW;
    for (const a of data.assignments) { const s = parseYear(a.START_DATE); if (s && s < minY) minY = s; }
    minY = Math.min(minY, 2000);

    // year slider
    const sliderWrap = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:8px;' });
    const slider = el('input', { type: 'range', min: minY, max: NOW, value: NOW, step: 1, style: 'flex:1;' });
    const yearLbl = el('span.pill', { text: String(NOW) });
    sliderWrap.append(el('span.muted', { text: 'Year' }), slider, yearLbl);
    root.appendChild(sliderWrap);

    const wrap = el('div.viz-wrap', { style: 'overflow:auto;max-height:62vh;' });
    root.appendChild(wrap);

    const schoolColor = d3.scaleOrdinal(d3.schemeTableau10.concat(d3.schemeSet3));

    function colorFor(school) {
      return colorBy === 'school' ? schoolColor(school.SCHOOL_ID) : regionColor(school.COUNTRY);
    }

    // Order: compared pair first, then everyone else by first posting year.
    function rows() {
      const teachers = data.teachers.slice();
      const firstYear = (t) => {
        const ps = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
        return ps.length ? parseYear(ps[0].START_DATE) || NOW : NOW;
      };
      teachers.sort((x, y) => firstYear(x) - firstYear(y));
      const pinned = [A, B].filter(Boolean);
      const rest = teachers.filter((t) => !pinned.includes(t.TEACHER_ID));
      return [...pinned.map((id) => idx.teacherById.get(id)).filter(Boolean), ...rest];
    }

    let xScale, nowLine, nowText;
    function redraw() {
      wrap.innerHTML = '';
      const list = rows();
      const rowH = 16, labelW = 150, top = 26, W = 980;
      const H = top + list.length * rowH + 10;
      const x = d3.scaleLinear().domain([minY, NOW]).range([labelW, W - 20]);
      xScale = x;
      const svg = d3.create('svg').attr('width', W).attr('height', H);

      // axis
      const axis = svg.append('g').attr('transform', `translate(0,${top - 6})`);
      axis.call(d3.axisTop(x).ticks(10).tickFormat(d3.format('d')));
      // year gridlines
      svg.append('g').selectAll('line').data(x.ticks(10)).join('line')
        .attr('x1', (d) => x(d)).attr('x2', (d) => x(d)).attr('y1', top).attr('y2', H - 8)
        .attr('stroke', '#eef2f4');

      list.forEach((t, i) => {
        const y = top + i * rowH;
        const isPair = t.TEACHER_ID === A || t.TEACHER_ID === B;
        const g = svg.append('g').attr('transform', `translate(0,${y})`);
        g.append('text').attr('x', labelW - 6).attr('y', rowH - 4).attr('text-anchor', 'end')
          .attr('font-size', isPair ? 11 : 9.5).attr('font-weight', isPair ? 700 : 400)
          .attr('fill', t.TEACHER_ID === A ? PRIMARY : (t.TEACHER_ID === B ? '#a8400f' : '#6a7a82'))
          .text(trunc(t.FULL_NAME, 22));
        if (isPair) g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH)
          .attr('fill', t.TEACHER_ID === A ? PRIMARY : ACCENT).attr('fill-opacity', 0.06);

        const postings = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
        postings.forEach((p) => {
          const { start, end } = postingYears(p, NOW);
          if (start == null) return;
          const s = idx.schoolById.get(p.SCHOOL_ID) || {};
          g.append('rect').attr('x', x(start)).attr('y', 3).attr('width', Math.max(2, x(end) - x(start))).attr('height', rowH - 6).attr('rx', 2)
            .attr('fill', colorFor(s)).attr('stroke', isPair ? '#fff' : 'none').attr('stroke-width', 0.5)
            .style('cursor', 'pointer')
            .on('mousemove', (ev) => tooltip.show(
              `<strong>${t.FULL_NAME}</strong><br>${p.POSITION_TITLE} — ${s.SCHOOL_NAME}<br>${s.CITY}, ${s.COUNTRY} · ${start}–${end >= NOW ? 'present' : end}`,
              ev.clientX, ev.clientY))
            .on('mouseleave', () => tooltip.hide());
        });
      });

      // Overlap highlight band between A and B.
      const ov = computeOverlaps(A, B, idx);
      const aRow = list.findIndex((t) => t.TEACHER_ID === A);
      const bRow = list.findIndex((t) => t.TEACHER_ID === B);
      ov.spans.forEach((sp) => {
        const yTop = top + Math.min(aRow, bRow) * rowH;
        const yBot = top + (Math.max(aRow, bRow) + 1) * rowH;
        svg.append('rect').attr('x', x(sp.from)).attr('width', Math.max(3, x(sp.to) - x(sp.from)))
          .attr('y', yTop).attr('height', yBot - yTop)
          .attr('fill', ACCENT).attr('fill-opacity', 0.14).attr('stroke', ACCENT).attr('stroke-dasharray', '3 3').attr('stroke-opacity', 0.6);
        svg.append('text').attr('x', x(sp.from) + 3).attr('y', yTop - 2).attr('font-size', 9).attr('fill', '#a8400f')
          .text(`${sp.level} ${sp.from}–${sp.to}`);
      });

      // now-line
      nowLine = svg.append('line').attr('y1', top).attr('y2', H - 8).attr('stroke', '#1f2a30').attr('stroke-width', 1).attr('stroke-opacity', 0.5);
      nowText = svg.append('text').attr('y', top - 14).attr('font-size', 10).attr('fill', '#1f2a30').attr('text-anchor', 'middle');
      wrap.appendChild(svg.node());
      setNow(+slider.value);

      // overlap summary card
      const tA = idx.teacherById.get(A), tB = idx.teacherById.get(B);
      overlapNote.innerHTML = '';
      overlapNote.append(el('strong', { text: `${tA ? tA.FULL_NAME : A} ↔ ${tB ? tB.FULL_NAME : B}: ` }));
      if (!ov.spans.length) overlapNote.append(el('span.muted', { text: 'no same-time co-location found between these two.' }));
      else overlapNote.append(el('span', { html: ov.spans.map((s) => `<span class="pill" style="background:#fff1ea;color:#a8400f;">${s.level} · ${s.label} · ${s.from}–${s.to}</span>`).join(' ') }));
    }

    function setNow(yr) {
      yearLbl.textContent = String(yr);
      if (nowLine) { nowLine.attr('x1', xScale(yr)).attr('x2', xScale(yr)); nowText.attr('x', xScale(yr)).text(yr); }
    }
    slider.addEventListener('input', () => setNow(+slider.value));

    redraw();
  },
};

// Same-time co-location between two teachers, strongest level per overlapping span.
function computeOverlaps(A, B, idx) {
  const pa = idx.postingsByTeacher.get(A) || [];
  const pb = idx.postingsByTeacher.get(B) || [];
  const spans = [];
  for (const x of pa) {
    const sx = idx.schoolById.get(x.SCHOOL_ID); if (!sx) continue;
    const yx = postingYears(x, NOW);
    for (const y of pb) {
      const sy = idx.schoolById.get(y.SCHOOL_ID); if (!sy) continue;
      const yy = postingYears(y, NOW);
      const from = Math.max(yx.start, yy.start), to = Math.min(yx.end, yy.end);
      if (from == null || to == null || to < from) continue;
      let level = null, label = null;
      if (sx.SCHOOL_ID === sy.SCHOOL_ID) { level = 'Degree 1 (same school)'; label = sx.SCHOOL_NAME; }
      else if (sx.CITY === sy.CITY && sx.COUNTRY === sy.COUNTRY) { level = 'Degree 3 (same city)'; label = `${sx.CITY}`; }
      else if (sx.COUNTRY === sy.COUNTRY) { level = 'Degree 5 (same country)'; label = sx.COUNTRY; }
      if (level) spans.push({ from, to, level, label });
    }
  }
  // keep strongest per overlapping year range (dedupe roughly by from-to-level)
  const seen = new Set();
  const uniq = spans.filter((s) => { const k = `${s.from}-${s.to}-${s.level}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { spans: uniq };
}

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
