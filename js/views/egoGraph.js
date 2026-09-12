// View 1 — Connections. Concentric rings centred on one person; ring = relationship degree.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS LOOKS THE WAY IT DOES
//
// The first version spaced rings evenly by degree number (ringR = maxR * d / 6). But
// connections are not evenly spread across degrees — they pile into 1 and 2. Measured on
// the densest person in the demo (97 connections):
//
//   degree 1: 26 people on a 262px ring that needed 649px   -> 2.5x oversubscribed
//   degree 2: 50 people on a 524px ring that needed 1361px   -> 2.6x oversubscribed
//   degree 3:  4 people on a 785px ring                      -> 13% used
//   degree 5:  2 people on a 1309px ring                     -> 4% used
//
// So the inner rings collapsed into a solid donut of overlapping circles while the outer
// rings sat empty. Rings are now sized by WHAT THEY MUST HOLD: each ring gets the radius
// its own population needs, and a ring too crowded for one circle is split into
// concentric BANDS inside its own zone, which keeps "ring = degree" true.
//
// The old layout was also capped at maxR = min(W, H)/2 - 60 with the height hard-coded to
// 620, so it drew a 250px-radius graph no matter how wide the window was — hence the vast
// empty space either side. The canvas is now square-ish and the leftover width becomes a
// list rail, which is the thing Dee actually said she liked ("I like the list versions").
// ─────────────────────────────────────────────────────────────────────────────
import { el, teacherTypeahead } from '../widgets.js';
import {
  DEGREE_META, DEGREES, degreeColor, degreeLabel, regionOf, ACCENT, teacherName, confirmBadge,
} from '../degrees.js';

const NODE_R = [6, 12];        // gentle range: size no longer fights the layout
const RING_PAD = 30;           // clear space between ring zones -- must fit a label line
const NODE_GAP = 5;            // minimum arc between neighbouring nodes
const LABEL_GAP_DEG = 40;      // angular gap at 12 o'clock for the ring label
                               // (a label like "degree 2 \u00b7 50" is ~90px wide, which
                               //  subtends well over 26\u00b0 on the inner rings)
const BAND_LIMIT = 3;          // more bands than this and the ring gets capped instead
const MIN_RADIAL_TO_LABEL = 26; // px between neighbouring rings needed to show a name
// Whether a name can be shown depends on its ACTUAL rendered width, not a guess: a fixed
// threshold let long names ("Christian", "Francesca") print straight over the nodes on
// the next ring round. Measured per element once the text is set.
function labelFits(el, d) {
  let w = 0;
  try { w = el.getComputedTextLength(); } catch { w = 0; }
  return d.clearance >= MIN_RADIAL_TO_LABEL && w + 8 <= d.arcPerNode;
}
const CANVAS_MAX = 760;
const LABEL_MARGIN = 54;   // room outside the outer ring for the name labels
const CANVAS_MIN = 460;

export const view = {
  id: 'ego', num: 1, title: 'Connections',

  render(root, ctx) {
    const { data, idx, adj, counts, tooltip, state } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Your connections' }),
      el('p', { html: 'Concentric rings around one person. Ring = relationship degree (1 closest … 6 outermost), colour = degree. Hover for <em>why</em> the link exists; click anyone to re-centre on them.' }),
    ]));

    const controls = el('div.controls');
    const picker = el('div.control-group', {}, [el('label', { text: 'Center on' })]);
    picker.appendChild(teacherTypeahead(data.teachers, idx,
      (id) => recentre(id), { value: state.egoTeacher }));
    controls.appendChild(picker);

    let showAll = false;
    const showAllWrap = el('div.control-group');
    const showAllCb = el('input', { type: 'checkbox' });
    showAllCb.addEventListener('change', () => { showAll = showAllCb.checked; draw(true); });
    showAllWrap.appendChild(el('label', {}, [showAllCb, ' Show every person on crowded rings']));
    controls.appendChild(showAllWrap);
    controls.appendChild(legend());
    root.appendChild(controls);

    // ── Layout: square-ish canvas + list rail in the width that used to go to waste ──
    const layout = el('div.ego-layout');
    const canvas = el('div.ego-canvas');
    const rail = el('aside.ego-rail');
    layout.append(canvas, rail);
    root.appendChild(layout);

    const svg = d3.create('svg').style('display', 'block').style('margin', '0 auto');
    canvas.appendChild(svg.node());

    // Persistent groups, so redraws are transitions rather than teardowns.
    const gZones = svg.append('g');
    const gRings = svg.append('g');
    const gSpokes = svg.append('g').attr('fill', 'none');
    const gNodes = svg.append('g');
    const gCenter = svg.append('g');

    let destroyed = false;
    this.teardown = () => { destroyed = true; };

    function recentre(id) {
      state.egoTeacher = id;
      draw(true);
      ctx.refreshHeader();
    }

    // ── Ring sizing ──────────────────────────────────────────────────────────
    // Walk degrees outward. Each ring gets the radius its own population needs; if one
    // circle cannot hold it, split into concentric bands within that degree's zone.
    function planRings(byDeg, rOf, maxR, pad) {
      const usable = 1 - LABEL_GAP_DEG / 360;
      const plan = [];
      let cursor = 50;                       // outside the ego glow (r=46), not inside it

      for (const d of DEGREES) {
        const people = byDeg.get(d) || [];
        if (!people.length) { plan.push({ degree: d, bands: [], people: [], hidden: 0 }); continue; }

        const maxNodeR = Math.max(...people.map(rOf));
        const need = people.reduce((a, p) => a + 2 * rOf(p) + NODE_GAP, 0);
        const bandStep = 2 * maxNodeR + NODE_GAP + 4;

        // How many bands, starting at the smallest radius this ring may occupy?
        let bands = [];
        let hidden = 0;
        for (let k = 1; k <= BAND_LIMIT; k++) {
          bands = [];
          let cap = 0;
          for (let b = 0; b < k; b++) {
            const r = cursor + maxNodeR + pad + b * bandStep;
            bands.push(r);
            cap += 2 * Math.PI * r * usable;
          }
          if (cap >= need) break;
        }
        // Still short after BAND_LIMIT bands: push the bands outward if there is room
        // inside maxR. Never beyond it -- the plan has to be valid exactly as drawn.
        let capacity = bands.reduce((a, r) => a + 2 * Math.PI * r * usable, 0);
        if (capacity < need) {
          const wanted = need / (2 * Math.PI * usable) / bands.length;
          const room = maxR - maxNodeR - (bands.length - 1) * bandStep;
          const base = Math.min(wanted, Math.max(bands[0], room));
          bands = bands.map((_, b) => base + b * bandStep);
          capacity = bands.reduce((a, r) => a + 2 * Math.PI * r * usable, 0);
        }
        plan.push({ degree: d, bands, people, capacity, need, maxNodeR, hidden });
        cursor = bands[bands.length - 1] + maxNodeR;
      }
      return plan;
    }

    // ── Draw ─────────────────────────────────────────────────────────────────
    function draw(animate) {
      if (destroyed) return;
      const ego = state.egoTeacher;
      const egoT = idx.teacherById.get(ego);

      // strongest (lowest-degree) link per person
      const best = new Map();
      for (const e of adj.get(ego) || []) {
        const cur = best.get(e.other);
        if (!cur || e.degree < cur.degree) best.set(e.other, e);
      }
      const neighbours = [...best.entries()].map(([other, e]) => ({ id: other, ...e }));

      // Angular position carries meaning: group each ring by region, then country, so
      // geography clusters instead of being scattered by insertion order.
      const sortKey = (n) => {
        const t = idx.teacherById.get(n.id) || {};
        const ps = idx.postingsByTeacher.get(n.id) || [];
        const s = ps.length ? idx.schoolById.get(ps[ps.length - 1].SCHOOL_ID) : null;
        const country = s ? s.COUNTRY : 'zz';
        return `${regionOf(country)}|${country}|${t.FULL_NAME || n.id}`;
      };
      const byDeg = new Map();
      for (const n of neighbours) {
        if (!byDeg.has(n.degree)) byDeg.set(n.degree, []);
        byDeg.get(n.degree).push(n);
      }
      for (const list of byDeg.values()) list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

      const rScale = d3.scaleSqrt()
        .domain([1, d3.max([...counts.values()]) || 1]).range(NODE_R);
      const rOf = (n) => rScale(counts.get(n.id) || 1);

      // Plan against the width we actually have, so the viewBox can be 1:1 with the
      // container and nothing gets scaled down.
      const availW = canvas.clientWidth || 640;
      const box = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, availW));
      const maxR = box / 2 - LABEL_MARGIN;

      // Optional cap on crowded rings (suggestion 19). Most-connected shown first.
      const capped = new Map();
      let hiddenTotal = 0;
      for (const [d, list] of byDeg) {
        const limit = showAll ? Infinity : 34;
        if (list.length > limit) {
          const keep = list.slice().sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0)).slice(0, limit);
          const keepSet = new Set(keep.map((k) => k.id));
          capped.set(d, list.filter((n) => keepSet.has(n.id)));
          hiddenTotal += list.length - limit;
        } else capped.set(d, list);
      }

      // Fit by SHRINKING THE NODES until the plan fits inside maxR — never by scaling
      // the finished plan, because ring capacity was computed from these very radii and
      // scaling afterwards silently invalidates it (nodes then overlap and fall inside
      // their own ring).
      let plan, outer, rFinal = rOf, padUsed = RING_PAD;
      const attempts = [[1, 28], [1, 24], [0.95, 21], [0.88, 18], [0.8, 16], [0.7, 15], [0.6, 14]];
      for (const [shrink, pad] of attempts) {
        rFinal = (n) => rOf(n) * shrink;
        padUsed = pad;
        plan = planRings(capped, rFinal, maxR, pad);
        outer = plan.reduce((m, p) => Math.max(m,
          p.bands.length ? p.bands[p.bands.length - 1] + (p.maxNodeR || 0) : 0), 60);
        if (outer <= maxR) break;
      }

      // Height follows the content rather than a hard-coded 620px; width is the
      // container's own width so one SVG unit is one screen pixel.
      // Square, and only as big as the content needs, then centred by CSS — otherwise the
      // bordered panel stretches to the full column width and the graph floats in a sea
      // of empty space (which is what the very first version did).
      const H = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, (outer + LABEL_MARGIN * 0.6) * 2));
      const W = H;
      const cx = W / 2, cy = H / 2;
      svg.attr('viewBox', `0 0 ${W} ${H}`).attr('height', H).attr('width', W);

      // place nodes across the bands of their degree
      const placed = [];
      const gapRad = (LABEL_GAP_DEG * Math.PI) / 180;
      // every band radius in the whole picture, to measure radial breathing room
      const allBands = plan.flatMap((p) => p.bands).sort((a, b) => a - b);
      const clearanceAt = (r) => {
        let gap = Infinity;
        for (const o of allBands) if (Math.abs(o - r) > 0.5) gap = Math.min(gap, Math.abs(o - r));
        return gap;
      };
      for (const p of plan) {
        if (!p.bands.length) continue;
        const perBand = Math.ceil(p.people.length / p.bands.length);
        p.bands.forEach((rawR, b) => {
          const slice = p.people.slice(b * perBand, (b + 1) * perBand);
          if (!slice.length) return;
          const r = rawR;
          const span = 2 * Math.PI - gapRad;
          // Offset each ring (and each band) angularly, so nodes on neighbouring rings
          // don't line up on the same spoke and collide label-to-label.
          const stagger = (p.degree * 0.37 + b * 0.19) % 1;
          slice.forEach((n, i) => {
            const frac = slice.length === 1
              ? 0.5
              : ((i + stagger) % slice.length) / slice.length;
            const ang = -Math.PI / 2 + gapRad / 2 + span * frac;
            placed.push({
              ...n, band: b, ang,
              r: rFinal(n),
              x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang),
              ringR: r,
              arcPerNode: (2 * Math.PI * r * (1 - LABEL_GAP_DEG / 360)) / slice.length,
              clearance: clearanceAt(rawR),
            });
          });
        });
      }

      const T = (sel) => (animate ? sel.transition().duration(650).ease(d3.easeCubicOut) : sel);

      // ── Ring zones: faint alternating bands so rings read as regions ────────
      const zones = plan.filter((p) => p.bands.length).map((p) => ({
        degree: p.degree,
        inner: p.bands[0] - (p.maxNodeR || 0) - padUsed / 2,
        outer: p.bands[p.bands.length - 1] + (p.maxNodeR || 0) + padUsed / 2,
      }));
      const zoneSel = gZones.selectAll('circle.zone').data(zones, (d) => d.degree);
      zoneSel.exit().remove();
      T(zoneSel.enter().append('circle').attr('class', 'zone')
        .attr('cx', cx).attr('cy', cy).attr('r', (d) => d.outer)
        .attr('fill', (d) => degreeColor(d.degree)).attr('fill-opacity', 0)
        .merge(zoneSel)
        .attr('cx', cx).attr('cy', cy))
        .attr('r', (d) => d.outer)
        .attr('fill', (d) => degreeColor(d.degree))
        .attr('fill-opacity', (d) => (d.degree % 2 ? 0.07 : 0.03));
      gZones.selectAll('circle.zone').attr('pointer-events', 'none')
        .sort((a, b) => b.outer - a.outer);           // largest first so inner zones show

      // ── Ring guides: only for degrees that actually have people ─────────────
      const ringData = zones.map((z) => ({ degree: z.degree, r: z.outer }));
      const ringSel = gRings.selectAll('circle.ring').data(ringData, (d) => d.degree);
      ringSel.exit().remove();
      T(ringSel.enter().append('circle').attr('class', 'ring')
        .attr('fill', 'none').attr('stroke-dasharray', '3 5').attr('stroke-opacity', 0.5)
        .attr('cx', cx).attr('cy', cy).attr('r', (d) => d.r)
        .merge(ringSel).attr('cx', cx).attr('cy', cy))
        .attr('r', (d) => d.r).attr('stroke', (d) => degreeColor(d.degree));

      // ── Spokes: gentle curves, faint by default, lit on hover ──────────────
      const spokePath = (d) => {
        const mx = (cx + d.x) / 2, my = (cy + d.y) / 2;
        const nx = -(d.y - cy), ny = d.x - cx;          // perpendicular
        const len = Math.hypot(nx, ny) || 1;
        const bow = d.ringR * 0.12;
        return `M${cx},${cy}Q${mx + (nx / len) * bow},${my + (ny / len) * bow} ${d.x},${d.y}`;
      };
      const spSel = gSpokes.selectAll('path.spoke').data(placed, (d) => d.id);
      spSel.exit().transition().duration(300).style('opacity', 0).remove();
      const spEnter = spSel.enter().append('path').attr('class', 'spoke')
        .attr('stroke-width', 1.2).style('opacity', 0)
        // start collapsed at the centre so the spoke grows out with its node instead of
        // snapping to a position where there is not yet a node
        .attr('d', `M${cx},${cy}Q${cx},${cy} ${cx},${cy}`);
      T(spEnter.merge(spSel))
        .attr('d', spokePath)
        .attr('stroke', (d) => degreeColor(d.degree))
        .style('opacity', 0.22);

      // ── Nodes ───────────────────────────────────────────────────────────────
      const nSel = gNodes.selectAll('g.ego-node').data(placed, (d) => d.id);
      nSel.exit().transition().duration(300).style('opacity', 0).remove();

      const nEnter = nSel.enter().append('g').attr('class', 'ego-node')
        .attr('transform', `translate(${cx},${cy})`)   // fly out from the centre
        .style('opacity', 0).style('cursor', 'pointer');
      nEnter.append('circle').attr('class', 'halo')
        .attr('fill', 'none').attr('stroke', '#fff').attr('stroke-width', 3);
      nEnter.append('circle').attr('class', 'dot');
      nEnter.append('text').attr('class', 'nm')
        .attr('text-anchor', 'middle').attr('font-size', 9.5).attr('fill', '#42525a');

      const nAll = nEnter.merge(nSel);

      nAll.select('circle.halo').attr('r', (d) => d.r + 1.5);
      nAll.select('circle.dot')
        .attr('r', (d) => d.r)
        .attr('fill', (d) => degreeColor(d.degree))
        // A light outline so degree 5/6 (#bfe6ed, #e2f3f7) stay visible against white.
        .attr('stroke', 'rgba(31,42,48,0.22)').attr('stroke-width', 1);

      // Labels sit OUTWARD along the spoke and rotate with it, which fans them out
      // instead of stacking them horizontally above each node.
      nAll.select('text.nm')
        .attr('x', (d) => Math.cos(d.ang) * (d.r + 7))
        .attr('y', (d) => Math.sin(d.ang) * (d.r + 7))
        .attr('text-anchor', (d) => (Math.cos(d.ang) < -0.15 ? 'end' : (Math.cos(d.ang) > 0.15 ? 'start' : 'middle')))
        .attr('dy', (d) => (Math.abs(Math.cos(d.ang)) <= 0.15 ? (Math.sin(d.ang) > 0 ? '0.9em' : '-0.25em') : '0.32em'))
        .text((d) => teacherName(idx, d.id).split(' ')[0])
        // Only label where there is room both along the ring and between rings; the rest
        // reveal on hover. Measured after the text is set, so it reflects the real width.
        .each(function (d) { this.style.display = labelFits(this, d) ? '' : 'none'; });

      // NOTE: build the transition explicitly here. T() returns a plain selection when
      // animate is false, and .delay() exists only on transitions -- calling it on a
      // selection throws and aborts the rest of draw(), which parked every node on top
      // of the ego. The resize handler calls draw(false), so this fired in normal use.
      const nodeMove = animate
        ? nAll.transition().duration(650).ease(d3.easeCubicOut)
            .delay((d) => d.degree * 55)                 // staggered entrance, inner first
        : nAll;
      nodeMove.style('opacity', 1).attr('transform', (d) => `translate(${d.x},${d.y})`);

      // hover: dim everything else, reveal this name, light its spoke
      nAll.on('mousemove', (ev, d) => {
        const t = idx.teacherById.get(d.id) || {};
        tooltip.show(
          `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)}<br>` +
          `${[t.SPECIALIZATION, t.NATIONALITY].filter(Boolean).join(' · ')}<br>` +
          `<span style="color:${degreeColor(d.degree)}">●</span> Degree ${d.degree} — ${degreeLabel(d.degree)}<br>` +
          `<em>${d.label || ''}${d.overlap ? ` · ${d.overlap}` : ''}</em>`,
          ev.clientX, ev.clientY);
        gNodes.selectAll('g.ego-node').style('opacity', (o) => (o.id === d.id ? 1 : 0.22));
        gSpokes.selectAll('path.spoke').style('opacity', (o) => (o.id === d.id ? 0.95 : 0.05))
          .attr('stroke-width', (o) => (o.id === d.id ? 2.2 : 1.2));
        d3.select(ev.currentTarget).select('text.nm').style('display', null).attr('font-weight', 700);
        railHighlight(d.id);
      })
        .on('mouseleave', (ev) => {
          tooltip.hide();
          gNodes.selectAll('g.ego-node').style('opacity', 1);
          gSpokes.selectAll('path.spoke').style('opacity', 0.22).attr('stroke-width', 1.2);
          d3.select(ev.currentTarget).select('text.nm')
            .attr('font-weight', null)
            .each(function (d) { this.style.display = labelFits(this, d) ? '' : 'none'; });
          railHighlight(null);
        })
        .on('click', (ev, d) => recentre(d.id));

      // ── Ego at the centre: unmistakable, with a soft halo ───────────────────
      gCenter.attr('transform', `translate(${cx},${cy})`);
      if (gCenter.select('circle.glow').empty()) {
        gCenter.append('circle').attr('class', 'glow').attr('r', 46)
          .attr('fill', ACCENT).attr('fill-opacity', 0.12);
        gCenter.append('circle').attr('class', 'rim').attr('r', 36)
          .attr('fill', 'none').attr('stroke', ACCENT).attr('stroke-opacity', 0.35).attr('stroke-width', 1.5);
        gCenter.append('circle').attr('class', 'core').attr('r', 30)
          .attr('fill', ACCENT).attr('stroke', '#fff').attr('stroke-width', 3);
        gCenter.append('text').attr('class', 'lab').attr('text-anchor', 'middle').attr('dy', '0.35em')
          .attr('fill', '#fff').attr('font-size', 12).attr('font-weight', 700);
      }
      gCenter.select('text.lab').text(egoT ? egoT.FIRST_NAME : ego);
      gCenter.style('cursor', 'default');

      // ── The rail: every person, grouped by degree, however crowded the rings ─
      buildRail(byDeg, neighbours.length, hiddenTotal);
      showAllWrap.style.display = hiddenTotal || showAll ? '' : 'none';
    }

    // ── Side rail ─────────────────────────────────────────────────────────────
    const railRows = new Map();
    function buildRail(byDeg, total, hiddenTotal) {
      rail.innerHTML = '';
      railRows.clear();
      rail.appendChild(el('div.rail-head', {}, [
        el('strong', { text: `${total} connection${total === 1 ? '' : 's'}` }),
        hiddenTotal ? el('span.muted', { style: 'font-size:11.5px;', text: `${hiddenTotal} not drawn` }) : null,
      ]));

      for (const d of DEGREES) {
        const list = byDeg.get(d) || [];
        if (!list.length) continue;
        const sec = el('div.rail-sec');
        sec.appendChild(el('div.rail-sec-head', {}, [
          el('span.swatch', { style: `background:${degreeColor(d)}` }),
          el('span', { text: `Degree ${d}` }),
          el('span.muted', { text: String(list.length) }),
        ]));
        sec.appendChild(el('div.muted.rail-sec-sub', { text: DEGREE_META[d].short }));
        const ul = el('ul');
        list.forEach((n) => {
          const t = idx.teacherById.get(n.id) || {};
          const li = el('li', { html: `${t.FULL_NAME || n.id}<small>${n.label || ''}${n.overlap ? ` · ${n.overlap}` : ''}</small>` });
          li.addEventListener('click', () => recentre(n.id));
          li.addEventListener('mouseenter', () => {
            gNodes.selectAll('g.ego-node').style('opacity', (o) => (o.id === n.id ? 1 : 0.22));
            gSpokes.selectAll('path.spoke').style('opacity', (o) => (o.id === n.id ? 0.95 : 0.05));
          });
          li.addEventListener('mouseleave', () => {
            gNodes.selectAll('g.ego-node').style('opacity', 1);
            gSpokes.selectAll('path.spoke').style('opacity', 0.22);
          });
          railRows.set(n.id, li);
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        rail.appendChild(sec);
      }
    }

    function railHighlight(id) {
      railRows.forEach((li, key) => li.classList.toggle('hot', key === id));
      if (id && railRows.has(id)) {
        const li = railRows.get(id);
        const box = li.getBoundingClientRect(), rb = rail.getBoundingClientRect();
        if (box.top < rb.top || box.bottom > rb.bottom) li.scrollIntoView({ block: 'nearest' });
      }
    }

    draw(true);
    // Re-fit when the window changes width (the rail/canvas split moves).
    let rt = null;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => draw(false), 180); };
    window.addEventListener('resize', onResize);
    const prevTeardown = this.teardown;
    this.teardown = () => { window.removeEventListener('resize', onResize); prevTeardown(); };
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
