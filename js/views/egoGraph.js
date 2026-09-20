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
import { el, append } from '../widgets.js';
import { openPersonCard } from '../personCard.js';
import { communityCounter } from '../communityCounter.js';
import { openFocusPicker } from '../focusPicker.js';
import { supabase, logError } from '../supabaseClient.js';
import { pairKey } from '../loadData.js';
import {
  DEGREE_META, DEGREES, degreeColor, degreeLabel, regionOf, ACCENT, teacherName, confirmBadge,
} from '../degrees.js';

// Ring 0 holds mutually confirmed connections, drawn in the accent colour.
const RINGS = [0, ...DEGREES];
const ringColor = (d) => (d ? degreeColor(d) : ACCENT);

const NODE_R = [6, 12];        // gentle range: size no longer fights the layout
const RING_PAD = 30;           // clear space between ring zones -- must fit a label line
const NODE_GAP = 5;            // minimum arc between neighbouring nodes
// No angular gap. The rings briefly carried "degree N · count" captions at 12 o'clock
// and this reserved room for them; the captions were removed as unnecessary, so the
// full circle now goes to nodes -- about 12% more room per ring.
const LABEL_GAP_DEG = 0;
const BAND_LIMIT = 3;          // more bands than this and the ring gets capped instead
const MIN_RADIAL_TO_LABEL = 24; // px of radial clearance before a name may be shown
const LABEL_ARC_MARGIN = 26;    // px of arc a name needs beyond its own width
// Whether a name can be shown. Three tests, each earning its place:
//
//  • MEASURED width, not a fixed threshold — a guess let long names ("Christian",
//    "Francesca") print straight over their neighbours.
//  • A generous arc margin. Names are drawn just outside their node as a wide horizontal
//    box, so they reach into whatever is angularly near them on the neighbouring ring.
//    With six rings in a few hundred pixels, ring spacing is ~26-38px and no radial
//    threshold separates "fits" from "collides" — tuning it either admits the collisions
//    or suppresses every label. A wider arc requirement is what actually thins them out.
//  • Only the outermost band of a degree. A no-op while each degree needs just one band,
//    but it matters for a dense ego where degree 1 or 2 splits into several.
//
// Everything unlabelled shows its name on hover, and the rail always lists everyone.
function labelFits(el, d) {
  if (!d.isOuterBand) return false;
  let w = 0;
  try { w = el.getComputedTextLength(); } catch { w = 0; }
  return d.clearance >= MIN_RADIAL_TO_LABEL && w + LABEL_ARC_MARGIN <= d.arcPerNode;
}
const CANVAS_MAX = 760;
const LABEL_MARGIN = 64;   // room outside the outer ring for the name labels
const CANVAS_MIN = 460;

export const view = {
  id: 'ego', num: 1, title: 'Connections',

  render(root, ctx) {
    const { data, idx, adj, counts, tooltip, state } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Your connections' }),
      el('p', { html: 'Concentric rings around one person. Ring = relationship degree (1 closest … 6 outermost), colour = degree. You are always at the centre. Hover for <em>why</em> a link exists; click anyone to see their details.' }),
    ]));

    root.appendChild(communityCounter());

    // WHOSE connections are on screen. Deliberately a variable in this view and
    // NOT ctx.state: the group asked that it reset the moment you navigate away,
    // and it is also kept out of the URL so a refresh or the back button cannot
    // quietly restore somebody else's graph. It used to live in ctx.state, where
    // it silently re-pointed the Map and Who knows whom at whoever you had last
    // clicked.
    let focusId = ctx.me;
    let focusName = null;
    let focusRows = null;      // their connections, fetched when it is not you

    // Three separate reminders, because Paul asked for more than one: "Many of
    // these users will be older and may need MORE ways to remind them about what
    // they're looking at." A banner here, the name on the centre node, and the
    // readout in the page header.
    const banner = el('div.focus-banner');
    banner.hidden = true;
    root.appendChild(banner);

    function paintBanner() {
      if (focusId === ctx.me) { banner.hidden = true; return; }
      banner.hidden = false;
      banner.innerHTML = '';
      const back = el('button.btn.accent', { type: 'button', text: '← Back to my connections' });
      back.addEventListener('click', () => setFocus(null, null));
      const change = el('button.btn.ghost', { type: 'button', text: 'Look at someone else' });
      change.addEventListener('click', () => openFocusPicker(ctx, focusId, setFocus));
      append(banner,
        el('span.focus-eye', { text: '👁', 'aria-hidden': 'true' }),
        el('span.focus-text', {
          html: `You are looking at <strong>${focusName || 'someone else'}</strong>’s connections, not your own.`,
        }),
        el('span.focus-acts', {}, [back, change]),
      );
    }

    async function setFocus(id, name) {
      focusId = id || ctx.me;
      focusName = id ? name : null;
      focusRows = null;
      paintBanner();
      if (ctx.refreshHeader) ctx.refreshHeader(focusId, focusName);
      if (focusId !== ctx.me) {
        const { data, error } = await supabase.rpc('connections_of', { p_person: focusId });
        if (error) {
          logError({ action: 'load someone else\'s connections', code: error.code, message: error.message });
          focusId = ctx.me; focusName = null; paintBanner();
        } else {
          focusRows = data || [];
        }
      }
      draw(true);
    }
    ctx.openFocusPicker = () => openFocusPicker(ctx, focusId, setFocus);

    // No "Center on" picker. You are the centre of your own graph, always —
    // Melissa: "I should always remain at the center of my ego-graph"; Dee:
    // "it's always tied to the user who is logged in."
    const controls = el('div.controls');

    let showAll = false;
    const showAllWrap = el('div.control-group');
    // autocomplete=off, or Chrome restores this control's previous state AFTER the
    // script has set it — see contrastToggle below for what that cost.
    const showAllCb = el('input', { type: 'checkbox', autocomplete: 'off' });
    showAllCb.addEventListener('change', () => { showAll = showAllCb.checked; draw(true); });
    showAllWrap.appendChild(el('label', {}, [showAllCb, ' Show every person on crowded rings']));
    controls.appendChild(showAllWrap);
    controls.appendChild(contrastToggle(() => draw(false)));
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

    // Clicking someone opens their details. It does NOT move the graph.
    function showPerson(id) {
      // When you are looking at somebody else's graph the card shows BOTH
      // relationships — theirs to this person, and yours.
      openPersonCard(ctx, id, [], { viaId: focusId, viaName: focusName });
    }

    // ── Ring sizing ──────────────────────────────────────────────────────────
    // Walk degrees outward. Each ring gets the radius its own population needs; if one
    // circle cannot hold it, split into concentric bands within that degree's zone.
    function planRings(byDeg, rOf, maxR, pad) {
      const usable = 1 - LABEL_GAP_DEG / 360;
      const plan = [];
      let cursor = 50;                       // outside the ego glow (r=46), not inside it

      for (const d of RINGS) {
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
    // A name and a size for anyone on screen, whether they came from your own
    // graph or from a fetch of somebody else's. Both live out here rather than
    // inside draw(): buildRail() needs them too, and when they were local the
    // rail threw ReferenceError and listed nobody under its heading.
    const nameOf = (n) => n._name || (idx.teacherById.get(n.id) || {}).FULL_NAME || n.id;
    const countOf = (n) => (n._count ?? counts.get(n.id) ?? 0);

    function draw(animate) {
      if (destroyed) return;
      // Declared up front: the ring guides read it well before the nodes do, and
      // `const` in a temporal dead zone throws rather than reading as undefined.
      const hc = highContrast();
      // Whoever is focused. Yourself unless somebody was chosen, and that choice
      // lives only for as long as you stay on this page.
      const ego = focusId;
      const egoT = focusId === ctx.me
        ? idx.teacherById.get(ego)
        : { FULL_NAME: focusName, FIRST_NAME: (focusName || '').split(' ')[0] };

      let neighbours;
      if (focusRows) {
        // Somebody else's, fetched from the database — this page holds only your
        // own neighbourhood, so theirs has to be asked for.
        neighbours = focusRows.map((r) => ({
          id: r.other_id,
          degree: r.degree,
          type: r.context_type,
          label: r.context_label,
          time: r.time_relation,
          overlap: r.overlap_years,
          acknowledged: !!r.acknowledged,
          verified: r.acknowledged ? 'mutual' : 'unverified',
          _name: r.display_name,
          _count: Number(r.their_degree_count) || 0,
          _home: r.home_country || null,
        }));
      } else {
        const best = new Map();
        for (const e of adj.get(ego) || []) {
          const cur = best.get(e.other);
          if (!cur || e.degree < cur.degree) best.set(e.other, e);
        }
        neighbours = [...best.entries()].map(([other, e]) => ({ id: other, ...e }));
      }

      // Angular position carries meaning: group each ring by region, then country, so
      // geography clusters instead of being scattered by insertion order.

      const sortKey = (n) => {
        const ps = idx.postingsByTeacher.get(n.id) || [];
        const s = ps.length ? idx.schoolById.get(ps[ps.length - 1].SCHOOL_ID) : null;
        const country = n._home || (s ? s.COUNTRY : 'zz');
        return `${regionOf(country)}|${country}|${nameOf(n)}`;
      };
      // A confirmed connection NEVER moves anyone. Dee, 17 Sep 2026, seeing Linda
      // at degree 3 with a confirmed social tag: "I wonder if we could have the 3rd
      // Degree 'outlined' to show that Linda is 3 degrees from me BUT there is a
      // social or professional connection?" So the degree places you and the
      // outline marks you — which is also the only reading consistent with degrees
      // coming from place and time alone.
      //
      // Ring 0 is therefore NOT "confirmed people". It is only for someone with no
      // shared country at all — the conference case — who has no degree and so has
      // nowhere else to live.
      const byDeg = new Map();
      for (const n of neighbours) {
        const ring = n.degree ?? 0;      // 0 only when there is no shared place at all
        if (!byDeg.has(ring)) byDeg.set(ring, []);
        byDeg.get(ring).push(n);
      }
      for (const list of byDeg.values()) list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

      const rScale = d3.scaleSqrt()
        .domain([1, d3.max([...counts.values()]) || 1]).range(NODE_R);
      const rOf = (n) => rScale(countOf(n) || 1);

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
              isOuterBand: b === p.bands.length - 1,
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
        .attr('fill', (d) => ringColor(d.degree)).attr('fill-opacity', 0)
        .merge(zoneSel)
        .attr('cx', cx).attr('cy', cy))
        .attr('r', (d) => d.outer)
        .attr('fill', (d) => ringColor(d.degree))
        .attr('fill-opacity', (d) => (d.degree % 2 ? 0.07 : 0.03));
      gZones.selectAll('circle.zone').attr('pointer-events', 'none')
        .sort((a, b) => b.outer - a.outer);           // largest first so inner zones show

      // ── Ring guides: only for degrees that actually have people ─────────────
      const ringData = zones.map((z) => ({ degree: z.degree, r: z.outer }));
      const ringSel = gRings.selectAll('circle.ring').data(ringData, (d) => d.degree);
      ringSel.exit().remove();
      T(ringSel.enter().append('circle').attr('class', 'ring')
        .attr('fill', 'none').attr('stroke-dasharray', hc ? '6 3' : '3 5')
        .attr('stroke-opacity', hc ? 0.95 : 0.5)
        .attr('cx', cx).attr('cy', cy).attr('r', (d) => d.r)
        .merge(ringSel).attr('cx', cx).attr('cy', cy))
        .attr('r', (d) => d.r).attr('stroke', (d) => ringColor(d.degree));

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
        .attr('stroke', (d) => ringColor(d.degree))
        .style('opacity', 0.22);

      // ── Nodes ───────────────────────────────────────────────────────────────
      const nSel = gNodes.selectAll('g.ego-node').data(placed, (d) => d.id);
      nSel.exit().transition().duration(300).style('opacity', 0).remove();

      const nEnter = nSel.enter().append('g').attr('class', 'ego-node')
        .attr('transform', `translate(${cx},${cy})`)   // fly out from the centre
        .style('opacity', 0).style('cursor', 'pointer');
      nEnter.append('circle').attr('class', 'halo')
        .attr('fill', 'none').attr('stroke', '#fff').attr('stroke-width', 3);
      // Dee's outline. Drawn OUTSIDE the white halo so it reads as a ring around the
      // person rather than a thicker edge on the dot, and it survives on every degree
      // colour including the palest.
      nEnter.append('circle').attr('class', 'confirmed-outline').attr('fill', 'none');
      nEnter.append('circle').attr('class', 'dot');
      nEnter.append('text').attr('class', 'nm')
        .attr('text-anchor', 'middle').attr('font-size', 9.5).attr('fill', '#42525a');

      const nAll = nEnter.merge(nSel);

      nAll.select('circle.halo').attr('r', (d) => d.r + 1.5);
      nAll.select('circle.confirmed-outline')
        .attr('r', (d) => d.r + 4.5)
        .attr('stroke', ACCENT)
        .attr('stroke-width', hc ? 2.4 : 1.8)
        .attr('stroke-opacity', (d) => (d.acknowledged ? (hc ? 1 : 0.9) : 0))
        // Dashed in high contrast too, so it is distinguishable without relying on
        // the accent colour alone.
        .attr('stroke-dasharray', hc ? '3 2' : null)
        .style('pointer-events', 'none');
      nAll.select('circle.dot')
        .attr('r', (d) => d.r)
        .attr('fill', (d) => ringColor(d.degree))
        // A light outline so degree 5/6 (#bfe6ed, #e2f3f7) stay visible against white.
        .attr('stroke', hc ? 'rgba(31,42,48,0.75)' : 'rgba(31,42,48,0.22)')
        .attr('stroke-width', hc ? 1.6 : 1);

      // The number carries the degree when colour cannot.
      nAll.selectAll('text.dnum').remove();
      if (hc) {
        nAll.append('text').attr('class', 'dnum')
          .attr('text-anchor', 'middle').attr('dy', '0.34em')
          .attr('font-size', (d) => Math.max(8, d.r * 1.15))
          .attr('font-weight', 700)
          .attr('fill', (d) => (d.degree && d.degree <= 3 ? '#fff' : '#21323a'))
          .style('pointer-events', 'none')
          .text((d) => (d.degree ? String(d.degree) : '✓'));
      }

      // Labels sit OUTWARD along the spoke and rotate with it, which fans them out
      // instead of stacking them horizontally above each node.
      nAll.select('text.nm')
        .attr('x', (d) => Math.cos(d.ang) * (d.r + 7))
        .attr('y', (d) => Math.sin(d.ang) * (d.r + 7))
        .attr('text-anchor', (d) => (Math.cos(d.ang) < -0.15 ? 'end' : (Math.cos(d.ang) > 0.15 ? 'start' : 'middle')))
        .attr('dy', (d) => (Math.abs(Math.cos(d.ang)) <= 0.15 ? (Math.sin(d.ang) > 0 ? '0.9em' : '-0.25em') : '0.32em'))
        .text((d) => nameOf(d).split(' ')[0])
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
          `<strong>${nameOf(d)}</strong>${confirmBadge(t)}<br>` +
          (t.GIVEN_NAME && t.PREFERRED_NAME && t.GIVEN_NAME !== t.PREFERRED_NAME
            ? `<small class="muted">${t.GIVEN_NAME} ${t.LAST_NAME}</small><br>` : '') +
          (d.degree
            ? `<span style="color:${ringColor(d.degree)}">●</span> Degree ${d.degree} — ${degreeLabel(d.degree)}<br>`
            : `<span style="color:${ACCENT}">●</span> No shared school, city or country<br>`) +
          // The degree and the confirmation are two separate facts about the same
          // pair, so show both rather than letting one replace the other.
          (d.acknowledged
            ? `<span style="color:${ACCENT}">◎</span> <strong>Confirmed connection</strong> — you both said you know each other<br>`
            : '') +
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
        .on('click', (ev, d) => showPerson(d.id));

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
      gCenter.style('cursor', 'pointer')
        .on('click', () => showPerson(ego))
        .on('mousemove', (ev) => tooltip.show(
          `<strong>${egoT ? egoT.FULL_NAME : 'You'}</strong><br><small>Click for your details</small>`,
          ev.clientX, ev.clientY))
        .on('mouseleave', () => tooltip.hide());

      // ── The rail: every person, grouped by degree, however crowded the rings ─
      buildRail(byDeg, neighbours.length, hiddenTotal, ego);
      showAllWrap.style.display = hiddenTotal || showAll ? '' : 'none';
    }

    // ── Side rail ─────────────────────────────────────────────────────────────
    const railRows = new Map();
    function buildRail(byDeg, total, hiddenTotal, ego) {
      rail.innerHTML = '';
      railRows.clear();
      rail.appendChild(el('div.rail-head', {}, [
        el('strong', {
          text: focusId === ctx.me
            ? `${total} connection${total === 1 ? '' : 's'}`
            : `${focusName || 'They'} — ${total} connection${total === 1 ? '' : 's'}`,
        }),
        hiddenTotal ? el('span.muted', { style: 'font-size:11.5px;', text: `${hiddenTotal} not drawn` }) : null,
      ]));

      for (const d of RINGS) {
        const list = byDeg.get(d) || [];
        if (!list.length) continue;
        const sec = el('div.rail-sec');
        sec.appendChild(el('div.rail-sec-head', {}, [
          el('span.swatch', { style: `background:${ringColor(d)}` }),
          el('span', { text: d ? `Degree ${d}` : 'No shared place' }),
          el('span.muted', { text: String(list.length) }),
        ]));
        sec.appendChild(el('div.muted.rail-sec-sub', {
          text: d ? DEGREE_META[d].short
                  : 'Confirmed, but you have never shared a school, city or country',
        }));
        const ul = el('ul');
        list.forEach((n) => {
          const t = idx.teacherById.get(n.id) || {};
          const shownName = nameOf(n);
          const ring = n.acknowledged
            ? `<span class="confirmed-mark" title="Confirmed connection">◎</span>`
            : '';
          // Linda, 13 Sep 2026: "Robb and I only show 1 1st degree connection, but
          // we have almost all of the schools the same." The rail still shows the
          // headline context, but says how much more sits behind it — otherwise
          // there is no reason to open the card and find out.
          // Only when the whole graph happens to be loaded. On the ordinary
          // per-user load this is silent rather than wrong — the card fetches the
          // real list when you open it.
          const all = (data.sharedByPair && data.sharedByPair.get(pairKey(ego, n.id))) || [];
          const more = all.length > 1 ? ` · +${all.length - 1} more` : '';
          const li = el('li', { html: `${shownName}${ring}<small>${n.label || ''}${n.overlap ? ` · ${n.overlap}` : ''}${more}</small>` });
          li.addEventListener('click', () => showPerson(n.id));
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
  wrap.appendChild(el('span.item', {}, [
    el('span.swatch.ring-swatch', { style: `border-color:${ACCENT}` }),
    el('span', { text: 'Confirmed connection — outlined, on its own degree' }),
  ]));
  DEGREES.forEach((d) => wrap.appendChild(el('span.item', {}, [
    el('span.swatch', { style: `background:${DEGREE_META[d].color}` }),
    el('span', { text: `${d} · ${DEGREE_META[d].short}` }),
  ])));
  return wrap;
}

// Melissa, 13 Sep 2026: "Do we know any color blind folks? Can they see the
// gradient color differences? The dashed lines might need to be more pronounced"
// — and "It's really pretty though. I don't want that to change."
//
// So it is a toggle, not a redesign. The palette is a single-hue ramp that varies
// mostly in LIGHTNESS, which is already the colour-blind-friendly way to do it;
// the real problem is that degrees 5 and 6 (#bfe6ed, #e2f3f7) are nearly white
// for everybody. High-contrast mode prints the degree number inside every node
// and strengthens the rings, so colour stops being the only carrier of meaning.
const HC_KEY = 'sixdeg.highContrast';
export const highContrast = () => { try { return localStorage.getItem(HC_KEY) === '1'; } catch { return false; } };
function setHighContrast(on) {
  try { localStorage.setItem(HC_KEY, on ? '1' : '0'); } catch {}
  document.body.classList.toggle('high-contrast', on);
}

function contrastToggle(onChange) {
  // Chrome restores a checkbox's previous state on reload, and it does so AFTER
  // scripts have run. That silently unticked this box while localStorage still
  // said the setting was on, so the graph drew every degree number and the
  // control underneath it said "off" — found on Paul's own screen, 18 Sep 2026.
  // The control has to agree with the setting, or turning it off takes two
  // clicks and nobody can tell what state they are in.
  const cb = el('input', { type: 'checkbox', autocomplete: 'off' });
  const sync = () => {
    const on = highContrast();
    cb.checked = on;
    cb.defaultChecked = on;              // the attribute, so a restore restores THIS
    document.body.classList.toggle('high-contrast', on);
  };
  sync();
  cb.addEventListener('change', () => { setHighContrast(cb.checked); onChange(); });
  const wrap = el('div.control-group', {}, [
    el('label', { title: 'Show the degree number on every node and strengthen the rings' },
      [cb, ' Easier to tell apart']),
  ]);
  // Belt and braces: re-read the setting once the element is actually in the
  // document, after any restoration has had its go.
  requestAnimationFrame(sync);
  return wrap;
}
