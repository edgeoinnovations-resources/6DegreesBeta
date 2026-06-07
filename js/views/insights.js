// View 7 — Insights dashboard. Aggregate only (no individual call-outs).
// Headline: average SEPARATION (mean BFS hop count) + network diameter — the literal
// "six degrees" number for this community. Plus degree distribution, tenure by region,
// curriculum mix, most-connected schools, top corridors, and cumulative growth (year slider).
import { el } from '../widgets.js';
import {
  DEGREES, degreeColor, regionOf, regionColor, REGION_COLORS,
  separationStats, migrationMoves, parseYear, PRIMARY, ACCENT,
} from '../degrees.js';

export const view = {
  id: 'insights', num: 7, title: 'Insights',
  render(root, ctx) {
    const { data, idx, adj } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Insights dashboard' }),
      el('p', { html: 'The community in aggregate. The headline is the real "six degrees" number — the mean number of hops between any two reachable people, computed with BFS over the colleagueship graph.' }),
    ]));

    const sep = separationStats(adj);

    // ── Stat cards ──
    const stats = el('div.stat-grid');
    const card = (num, lbl, accent) => el('div.stat-card', {}, [
      el('div', { class: accent ? 'num accent' : 'num', text: num }), el('div.lbl', { html: lbl }),
    ]);
    stats.append(
      card(sep.avgSeparation.toFixed(2), 'Average separation<br>(mean BFS hops between reachable people)', true),
      card(String(sep.diameter), 'Network diameter<br>(longest shortest-path)'),
      card(String(data.teachers.length), 'Teachers'),
      card(String(data.schools.length), 'Schools'),
      card(data.colleagueships.length.toLocaleString(), 'Colleagueships'),
      card(sep.components === 1 ? 'Single' : String(sep.components), 'Connected component' + (sep.components === 1 ? '' : 's')),
    );
    root.appendChild(stats);

    const grid = el('div.dash-grid');
    root.appendChild(grid);

    // ── 1. Degree distribution ──
    const degCounts = DEGREES.map((d) => ({ key: `Deg ${d}`, value: data.colleagueships.filter((c) => c.DEGREE === d).length, color: degreeColor(d) }));
    grid.appendChild(chartCard('Relationship degree distribution', 'Strongest link per pair, bucketed 1–6.',
      barChart(degCounts, { format: (v) => v.toLocaleString() })));

    // ── 2. Average tenure by region ──
    const tenureByRegion = avgTenureByRegion(data, idx);
    grid.appendChild(chartCard('Average tenure by region', 'Mean years per completed posting.',
      barChart(tenureByRegion, { format: (v) => v.toFixed(1) + ' yr' })));

    // ── 3. Curriculum mix by region (stacked) ──
    grid.appendChild(chartCard('Curriculum mix by region', 'Share of schools by curriculum within each region.',
      curriculumStacked(data)));

    // ── 4. Most-connected schools ──
    const topSchools = mostConnectedSchools(idx).slice(0, 8)
      .map((s) => ({ key: trunc(s.name, 26), value: s.members, color: regionColor(s.country) }));
    grid.appendChild(chartCard('Most-connected schools', 'Distinct teachers who passed through.',
      barChart(topSchools, { format: (v) => `${v}` })));

    // ── 5. Biggest migration corridors ──
    const corridors = topCorridors(data, idx).slice(0, 8)
      .map((c) => ({ key: `${trunc(c.from, 12)} → ${trunc(c.to, 12)}`, value: c.count, color: PRIMARY }));
    grid.appendChild(chartCard('Biggest migration corridors', 'Top country → country flows (consecutive postings).',
      barChart(corridors, { format: (v) => `${v}` })));

    // ── 6. Cumulative connection growth (year slider) ──
    grid.appendChild(growthCard(data));
  },
};

function chartCard(title, sub, node) {
  return el('div.chart-card.card', {}, [
    el('h4', { text: title }),
    el('p.muted', { style: 'margin:-6px 0 10px;font-size:12px;', text: sub }),
    node,
  ]);
}

// horizontal bar chart
function barChart(rows, { format = (v) => v } = {}) {
  const W = 320, rowH = 26, H = rows.length * rowH + 10, labelW = 120;
  const max = d3.max(rows, (r) => r.value) || 1;
  const x = d3.scaleLinear().domain([0, max]).range([0, W - labelW - 50]);
  const svg = d3.create('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).style('max-width', `${W}px`);
  const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH + 6})`);
  g.append('text').attr('x', labelW - 6).attr('y', rowH / 2).attr('text-anchor', 'end')
    .attr('font-size', 11).attr('fill', '#42525a').text((d) => d.key);
  g.append('rect').attr('x', labelW).attr('y', 3).attr('height', rowH - 12).attr('rx', 3)
    .attr('width', (d) => Math.max(1, x(d.value))).attr('fill', (d) => d.color || PRIMARY);
  g.append('text').attr('x', (d) => labelW + x(d.value) + 5).attr('y', rowH / 2).attr('dy', '0.1em')
    .attr('font-size', 11).attr('fill', '#6a7a82').text((d) => format(d.value));
  return svg.node();
}

// curriculum stacked bars by region
function curriculumStacked(data) {
  const regions = {};
  for (const s of data.schools) {
    const r = regionOf(s.COUNTRY); const c = s.CURRICULUM_TYPE || 'Other';
    regions[r] = regions[r] || {};
    regions[r][c] = (regions[r][c] || 0) + 1;
  }
  const curricula = [...new Set(data.schools.map((s) => s.CURRICULUM_TYPE || 'Other'))];
  const palette = d3.scaleOrdinal().domain(curricula)
    .range(['#17A2B8', '#FF6B35', '#6f5cc4', '#2ca02c', '#e6a817', '#d6457f', '#0b6b78', '#999']);
  const regionNames = Object.keys(regions);
  const W = 320, rowH = 30, H = regionNames.length * rowH + 30;
  const svg = d3.create('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).style('max-width', `${W}px`);
  const labelW = 90, barW = W - labelW - 10;
  regionNames.forEach((r, i) => {
    const total = d3.sum(Object.values(regions[r]));
    const x = d3.scaleLinear().domain([0, total]).range([0, barW]);
    let acc = 0;
    const g = svg.append('g').attr('transform', `translate(0,${i * rowH + 6})`);
    g.append('text').attr('x', labelW - 6).attr('y', rowH / 2).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', '#42525a').text(r);
    curricula.forEach((c) => {
      const v = regions[r][c] || 0; if (!v) return;
      g.append('rect').attr('x', labelW + x(acc)).attr('y', 3).attr('width', x(v)).attr('height', rowH - 12).attr('fill', palette(c))
        .append('title').text(`${c}: ${v}`);
      acc += v;
    });
  });
  const wrap = el('div', {}, [svg.node()]);
  const leg = el('div.legend', { style: 'margin-top:8px;' });
  curricula.forEach((c) => leg.appendChild(el('span.item', {}, [el('span.swatch', { style: `background:${palette(c)}` }), c])));
  wrap.appendChild(leg);
  return wrap;
}

// cumulative growth with year slider
function growthCard(data) {
  const years = [];
  for (const c of data.colleagueships) {
    const y = parseYear((c.OVERLAP_YEARS || '').slice(0, 4));
    if (y) years.push(y);
  }
  years.sort((a, b) => a - b);
  const minY = years[0] || 2005, maxY = years[years.length - 1] || 2026;
  const buckets = new Map();
  for (let y = minY; y <= maxY; y++) buckets.set(y, 0);
  for (const y of years) buckets.set(y, (buckets.get(y) || 0) + 1);
  let acc = 0;
  const cum = [...buckets.keys()].sort((a, b) => a - b).map((y) => { acc += buckets.get(y); return { year: y, value: acc }; });

  const W = 340, H = 180, m = { l: 40, r: 10, t: 10, b: 24 };
  const x = d3.scaleLinear().domain([minY, maxY]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, acc || 1]).range([H - m.b, m.t]);
  const svg = d3.create('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).style('max-width', `${W}px`);
  svg.append('path').datum(cum).attr('fill', PRIMARY).attr('fill-opacity', 0.12)
    .attr('d', d3.area().x((d) => x(d.year)).y0(y(0)).y1((d) => y(d.value)));
  svg.append('path').datum(cum).attr('fill', 'none').attr('stroke', PRIMARY).attr('stroke-width', 2)
    .attr('d', d3.line().x((d) => x(d.year)).y((d) => y(d.value)));
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format('d')));
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4));
  const nowLine = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', ACCENT).attr('stroke-width', 1.5);
  const nowDot = svg.append('circle').attr('r', 4).attr('fill', ACCENT);
  const readout = el('div.muted', { style: 'font-size:12px;margin-top:6px;' });

  const setYear = (yr) => {
    const pt = cum.reduce((p, c) => (c.year <= yr ? c : p), cum[0]);
    nowLine.attr('x1', x(yr)).attr('x2', x(yr));
    nowDot.attr('cx', x(yr)).attr('cy', y(pt.value));
    readout.innerHTML = `By <strong>${yr}</strong>: ${pt.value.toLocaleString()} colleagueships formed`;
  };
  const slider = el('input', { type: 'range', min: minY, max: maxY, value: maxY, step: 1, style: 'width:100%;' });
  slider.addEventListener('input', () => setYear(+slider.value));
  setYear(maxY);

  return chartCard('Connection growth over time', 'Cumulative colleagueships by year — drag to scrub.',
    el('div', {}, [svg.node(), slider, readout]));
}

// aggregate helpers
function avgTenureByRegion(data, idx) {
  const byRegion = {};
  for (const a of data.assignments) {
    const start = parseYear(a.START_DATE), end = parseYear(a.END_DATE);
    if (start == null || end == null) continue;
    const s = idx.schoolById.get(a.SCHOOL_ID); if (!s) continue;
    const r = regionOf(s.COUNTRY);
    (byRegion[r] = byRegion[r] || []).push(Math.max(0, end - start));
  }
  return Object.entries(byRegion).map(([r, arr]) => ({ key: r, value: d3.mean(arr), color: REGION_COLORS[r] || PRIMARY }))
    .sort((a, b) => b.value - a.value);
}
function mostConnectedSchools(idx) {
  const out = [];
  for (const [sid, set] of idx.teachersBySchool) {
    const s = idx.schoolById.get(sid); if (!s) continue;
    out.push({ id: sid, name: s.SCHOOL_NAME, country: s.COUNTRY, members: set.size });
  }
  return out.sort((a, b) => b.members - a.members);
}
function topCorridors(data, idx) {
  const moves = migrationMoves(data, idx, 'COUNTRY');
  const flow = new Map();
  for (const m of moves) {
    const k = `${m.from.COUNTRY}|${m.to.COUNTRY}`;
    flow.set(k, (flow.get(k) || 0) + 1);
  }
  return [...flow.entries()].map(([k, v]) => { const [from, to] = k.split('|'); return { from, to, count: v }; })
    .sort((a, b) => b.count - a.count);
}
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
