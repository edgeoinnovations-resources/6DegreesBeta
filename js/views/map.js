// View 3 — Map.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS WAS REWRITTEN (Sept 2026)
//
// Dave, on the first beta: "The headcount columns visualization was giving me fits for a
// little bit. On the map, you don't see the columns until you zoom in. And on the globe
// projection they are out in space until you zoom in."
//
// Both halves of that had the same root cause, and it was not fixable by tweaking numbers:
//
//   1. GLOBE. The old version drew arcs and columns with deck.gl (MapboxOverlay) on top
//      of MapLibre. deck.gl syncs itself to MapLibre's *mercator* camera; when MapLibre
//      switches to globe, the two cameras disagree and deck's geometry detaches from the
//      map — "out in space". This is an open, unfixed upstream bug (visgl/deck.gl#9466,
//      affecting deck 9.x + MapLibre 5.x), and it breaks in BOTH orders: add the overlay
//      before switching to globe and the layers deform; add it after and they land
//      misaligned. There is no workaround at the app level.
//
//   2. INVISIBLE COLUMNS. Columns were extruded circles of a FIXED 30 km radius. At world
//      zoom 30 km is well under one pixel, so they genuinely were not there to see until
//      you zoomed a long way in.
//
// The fix for (1) is to stop mixing renderers: every layer here is now a native MapLibre
// layer, so there is exactly one camera and one projection and globe simply works.
// Migration arcs are great-circle LineStrings on a `line` layer; headcount columns are a
// `fill-extrusion` over generated circle polygons.
//
// The fix for (2) is to size columns in SCREEN space: their radius and height are
// recomputed from metres-per-pixel whenever the view changes, so a column is always about
// 9 px wide and the tallest is always about 130 px high, at every zoom level.
//
// MODES, NOT FREE-COMBINING CHECKBOXES. The old overlay let you tick "3D columns" and
// "Globe" together, which is a combination that cannot render correctly — MapLibre's own
// docs warn that fill-extrusion in globe projection produces artifacts and recommend
// mercator for it. Rather than ship a state that is always wrong, the view now has three
// mutually exclusive modes, so no broken combination is reachable:
//
//   Flat   — mercator, no pitch.       Points + arcs.
//   Globe  — globe projection.         Points + arcs.
//   3D     — mercator + pitch.         Points + arcs + headcount columns.
// ─────────────────────────────────────────────────────────────────────────────
import { el, teacherTypeahead } from '../widgets.js';
import { regionColor, roleCategory, PRIMARY } from '../degrees.js';

const MODES = {
  flat: { label: 'Flat', projection: 'mercator', pitch: 0, columns: false },
  globe: { label: 'Globe', projection: 'globe', pitch: 0, columns: false },
  '3d': { label: '3D', projection: 'mercator', pitch: 55, columns: true },
};

// Screen-space targets for the headcount columns (see header note).
const COLUMN_RADIUS_PX = 9;
const COLUMN_MAX_HEIGHT_PX = 130;

export const view = {
  id: 'map', num: 3, title: 'Map',

  render(root, ctx) {
    const { data, idx } = ctx;

    if (typeof maplibregl === 'undefined') {
      root.appendChild(el('div.error-box', { html: 'MapLibre GL failed to load from CDN — check your network connection.' }));
      return;
    }

    // Everything that must be cleaned up on teardown lives here, so teardown can't miss any.
    const timers = new Set();
    const popups = new Set();
    let destroyed = false;
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const addPopup = (p) => { popups.add(p); p.on('close', () => popups.delete(p)); return p; };
    const clearPopups = () => { for (const p of [...popups]) { try { p.remove(); } catch {} } popups.clear(); };

    root.style.padding = '0';
    const shell = el('div.map-shell');
    const mapDiv = el('div', { id: 'map' });
    shell.appendChild(mapDiv);
    root.appendChild(shell);

    // ── Aggregates ───────────────────────────────────────────────────────────
    const schoolMembers = new Map(); // SCHOOL_ID -> Set(teacherId)
    for (const a of data.assignments) {
      if (!schoolMembers.has(a.SCHOOL_ID)) schoolMembers.set(a.SCHOOL_ID, new Set());
      schoolMembers.get(a.SCHOOL_ID).add(a.TEACHER_ID);
    }

    const schools = data.schools.filter((s) => isFinite(s.LONGITUDE) && isFinite(s.LATITUDE));
    const schoolFeatures = schools.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+s.LONGITUDE, +s.LATITUDE] },
      properties: {
        id: s.SCHOOL_ID, name: s.SCHOOL_NAME, city: s.CITY, country: s.COUNTRY,
        members: (schoolMembers.get(s.SCHOOL_ID) || new Set()).size,
        color: regionColor(s.COUNTRY),
      },
    }));
    const maxMembers = Math.max(1, ...schoolFeatures.map((f) => f.properties.members));

    // Migration arcs: consecutive postings that change school, aggregated per ordered pair.
    const arcAgg = new Map();
    for (const [, postings] of idx.postingsByTeacher) {
      for (let i = 0; i < postings.length - 1; i++) {
        const a = idx.schoolById.get(postings[i].SCHOOL_ID);
        const b = idx.schoolById.get(postings[i + 1].SCHOOL_ID);
        if (!a || !b || a.SCHOOL_ID === b.SCHOOL_ID) continue;
        if (![a.LONGITUDE, a.LATITUDE, b.LONGITUDE, b.LATITUDE].every(isFinite)) continue;
        const k = `${a.SCHOOL_ID}|${b.SCHOOL_ID}`;
        if (!arcAgg.has(k)) {
          arcAgg.set(k, {
            from: [+a.LONGITUDE, +a.LATITUDE], to: [+b.LONGITUDE, +b.LATITUDE],
            fromName: a.SCHOOL_NAME, toName: b.SCHOOL_NAME, count: 0,
          });
        }
        arcAgg.get(k).count++;
      }
    }
    const arcs = [...arcAgg.values()];
    const maxArc = Math.max(1, ...arcs.map((a) => a.count));
    const arcFeatures = {
      type: 'FeatureCollection',
      features: arcs.map((a) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: greatCircle(a.from, a.to) },
        properties: { count: a.count, fromName: a.fromName, toName: a.toName, width: 1 + (a.count / maxArc) * 5 },
      })),
    };

    // Headcount per city (distinct people across every school in that city).
    const cityAgg = new Map();
    for (const s of schools) {
      const key = `${s.CITY}|${s.COUNTRY}`;
      if (!cityAgg.has(key)) cityAgg.set(key, { city: s.CITY, country: s.COUNTRY, lngs: [], lats: [], members: new Set() });
      const c = cityAgg.get(key);
      c.lngs.push(+s.LONGITUDE); c.lats.push(+s.LATITUDE);
      for (const t of (schoolMembers.get(s.SCHOOL_ID) || [])) c.members.add(t);
    }
    const cities = [...cityAgg.values()].filter((c) => c.lngs.length).map((c) => ({
      city: c.city, country: c.country,
      center: [mean(c.lngs), mean(c.lats)],
      headcount: c.members.size,
      color: regionColor(c.country),
    }));
    const maxHeadcount = Math.max(1, ...cities.map((c) => c.headcount));

    // ── Controls ─────────────────────────────────────────────────────────────
    let mode = MODES[ctx.state.params.mapMode] ? ctx.state.params.mapMode : 'flat';
    let showArcs = true;

    const overlay = el('div.map-overlay');
    overlay.appendChild(el('h3', { text: 'Worldwide community' }));

    const modeRow = el('div.checkrow', { style: 'margin-bottom:10px;' });
    const modeBtns = new Map();
    Object.entries(MODES).forEach(([id, m]) => {
      const b = el('label', { text: m.label, style: 'cursor:pointer;' });
      b.addEventListener('click', () => setMode(id));
      modeRow.appendChild(b);
      modeBtns.set(id, b);
    });
    overlay.appendChild(modeRow);

    const arcsCb = el('input', { type: 'checkbox' });
    arcsCb.checked = true;
    arcsCb.addEventListener('change', () => { showArcs = arcsCb.checked; applyVisibility(); });
    overlay.appendChild(el('div.control-group', {}, [el('label', {}, [arcsCb, ' Migration arcs'])]));

    // Says out loud why columns aren't offered outside 3D, instead of silently misbehaving.
    const modeNote = el('p.muted', { style: 'font-size:11px;margin:2px 0 8px;' });
    overlay.appendChild(modeNote);

    const journeyBox = el('div.control-group', { style: 'flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;' });
    journeyBox.appendChild(el('label', { text: 'Fly a teacher’s journey' }));
    let journeyId = ctx.state.egoTeacher || 'T001';
    journeyBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { journeyId = id; }, { value: journeyId, placeholder: 'Pick a teacher…' }));
    const flyBtn = el('button.btn.accent', { text: '▶ Fly the journey' });
    flyBtn.addEventListener('click', () => (flying ? stopJourney() : flyJourney(journeyId)));
    journeyBox.appendChild(flyBtn);
    overlay.appendChild(journeyBox);

    overlay.appendChild(el('div.legend', { style: 'margin-top:10px;' }, [
      el('span.item', {}, [el('span.swatch', { style: `background:${PRIMARY}` }), 'arc = a teacher move']),
    ]));
    shell.appendChild(overlay);

    const panel = el('div.side-panel');
    shell.appendChild(panel);

    // ── Map ──────────────────────────────────────────────────────────────────
    const map = new maplibregl.Map({
      container: mapDiv,
      style: 'https://demotiles.maplibre.org/style.json', // keyless basemap
      center: [30, 20],
      zoom: 1.6,
      pitch: MODES[mode].pitch,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    let loaded = false;

    // Handy when debugging the map from the console: window.__6deg.map, .state()
    // (Defined with defineProperty rather than Object.assign: Object.assign INVOKES
    //  getters on the source and copies their values, which would freeze these at
    //  their initial state and report stale values forever.)
    window.__6deg = window.__6deg || {};
    window.__6deg.map = map;
    window.__6deg.state = () => ({ loaded, mode, showArcs, flying });

    map.on('load', () => {
      if (destroyed) return;      // the view can be left before the style finishes loading
      loaded = true;

      map.addSource('arcs', { type: 'geojson', data: arcFeatures });
      map.addLayer({
        id: 'arc-lines', type: 'line', source: 'arcs',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PRIMARY,
          'line-opacity': 0.55,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, ['*', ['get', 'width'], 0.6], 6, ['get', 'width'], 12, ['*', ['get', 'width'], 1.8]],
        },
      });

      // Columns sit above arcs, below points.
      map.addSource('columns', { type: 'geojson', data: columnFeatures() });
      map.addLayer({
        id: 'headcount-columns', type: 'fill-extrusion', source: 'columns',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.82,
        },
      });

      map.addSource('schools', { type: 'geojson', data: { type: 'FeatureCollection', features: schoolFeatures } });
      map.addLayer({
        id: 'school-circles', type: 'circle', source: 'schools',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'members'], 0, 4, maxMembers, 22],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.8,
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.on('click', 'school-circles', (e) => openRoster(e.features[0].properties.id));
      map.on('click', 'arc-lines', (e) => {
        const p = e.features[0].properties;
        addPopup(new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${p.fromName} → ${p.toName}</strong><br>${p.count} teacher move(s)`)
          .addTo(map));
      });
      map.on('click', 'headcount-columns', (e) => {
        const p = e.features[0].properties;
        addPopup(new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${p.city}, ${p.country}</strong><br>${p.headcount} community members`)
          .addTo(map));
      });

      for (const id of ['school-circles', 'arc-lines', 'headcount-columns']) {
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
      }

      // Columns are sized in screen space, so they must be recomputed as the view moves.
      map.on('moveend', rescaleColumns);
      map.on('zoomend', rescaleColumns);

      // Any manual interaction cancels an in-flight journey rather than fighting the user.
      map.on('dragstart', () => { if (flying) stopJourney(); });

      applyMode();
    });

    map.on('error', (e) => console.warn('[6deg] map error:', e && e.error && e.error.message));

    // ── Columns, sized in screen space ───────────────────────────────────────
    // metres-per-pixel at the current zoom and centre latitude. Using the centre latitude
    // (not each city's own) keeps every column the same on-screen size as each other.
    function metresPerPixel() {
      const lat = map.getCenter().lat;
      return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
    }

    function columnFeatures() {
      const mpp = Math.abs(metresPerPixel()) || 1;
      const radius = COLUMN_RADIUS_PX * mpp;
      const maxHeight = COLUMN_MAX_HEIGHT_PX * mpp;
      return {
        type: 'FeatureCollection',
        features: cities.map((c) => ({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [circlePolygon(c.center, radius)] },
          properties: {
            city: c.city, country: c.country, headcount: c.headcount, color: c.color,
            // A floor of 0.12 keeps one-person cities from rendering as flat discs.
            height: Math.max(0.12, c.headcount / maxHeadcount) * maxHeight,
          },
        })),
      };
    }

    let rescaleTimer = null;
    function rescaleColumns() {
      if (!loaded || destroyed || !MODES[mode].columns) return;
      if (rescaleTimer) clearTimeout(rescaleTimer);
      rescaleTimer = setTimeout(() => {
        rescaleTimer = null;
        if (!loaded || destroyed || !MODES[mode].columns) return;
        const src = map.getSource('columns');
        if (src) src.setData(columnFeatures());
      }, 120);
    }

    // ── Mode handling ────────────────────────────────────────────────────────
    function setMode(id) {
      if (!MODES[id] || id === mode) return;
      mode = id;
      applyMode();
    }

    function applyMode() {
      const m = MODES[mode];
      modeBtns.forEach((b, id) => b.classList.toggle('sel', id === mode));
      modeNote.textContent = m.columns
        ? 'Headcount columns: one column per city, height = people. Always ~130 px tall at the busiest city, at any zoom.'
        : 'Headcount columns are a 3D-mode feature — extruded shapes render with artifacts in globe projection, so they stay off here.';

      if (!loaded) return;

      try {
        map.setProjection({ type: m.projection });
      } catch (err) {
        console.warn('[6deg] projection unsupported, staying in mercator:', err && err.message);
      }

      map.easeTo({ pitch: m.pitch, duration: 500 });
      applyVisibility();
      if (m.columns) {
        const src = map.getSource('columns');
        if (src) src.setData(columnFeatures());
      }
    }

    function applyVisibility() {
      if (!loaded) return;
      const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
      vis('arc-lines', showArcs);
      vis('headcount-columns', MODES[mode].columns);
    }

    // ── School roster ────────────────────────────────────────────────────────
    function openRoster(schoolId) {
      const s = idx.schoolById.get(schoolId) || {};
      const roster = data.assignments
        .filter((a) => a.SCHOOL_ID === schoolId)
        .map((a) => ({ a, t: idx.teacherById.get(a.TEACHER_ID) }))
        .filter((r) => r.t)
        .sort((x, y) => String(x.a.START_DATE).localeCompare(String(y.a.START_DATE)));

      panel.innerHTML = '';
      panel.append(
        el('button.close', { text: '×', onclick: () => panel.classList.remove('open') }),
        el('h3', { text: s.SCHOOL_NAME || schoolId }),
        el('div.sub', { text: `${s.CITY || ''}, ${s.COUNTRY || ''} · ${s.CURRICULUM_TYPE || ''} · ${roster.length} postings` }),
        el('h4', { text: 'Who has been here', style: 'margin:8px 0 4px;font-size:13px;' }),
        el('ul', {}, roster.map((r) => el('li', {
          html: `<strong>${r.t.FULL_NAME}</strong> — ${roleCategory(r.a.POSITION_TITLE)}` +
            `<small>${(r.a.START_DATE || '').slice(0, 4)}–${(r.a.END_DATE || '').slice(0, 4) || 'present'}</small>`,
        }))),
      );
      panel.classList.add('open');
    }

    // ── Fly the journey ──────────────────────────────────────────────────────
    // The old version leaked: it never cancelled its timer chain (so it kept flying a
    // removed map after you left the view) and never removed the popups it dropped.
    let flying = false;

    function stopJourney() {
      flying = false;
      flyBtn.textContent = '▶ Fly the journey';
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clearPopups();
    }

    function flyJourney(teacherId) {
      const stops = (idx.postingsByTeacher.get(teacherId) || [])
        .map((p) => idx.schoolById.get(p.SCHOOL_ID))
        .filter((s) => s && isFinite(s.LONGITUDE) && isFinite(s.LATITUDE));
      if (!stops.length) return;

      stopJourney();
      flying = true;
      flyBtn.textContent = '■ Stop';
      panel.classList.remove('open');

      let i = 0;
      const hop = () => {
        if (!flying || destroyed || i >= stops.length) {
          if (flying) stopJourney();
          return;
        }
        const s = stops[i];
        map.flyTo({
          center: [+s.LONGITUDE, +s.LATITUDE],
          zoom: 4.2,
          pitch: MODES[mode].pitch || 30,
          speed: 0.8,
          essential: true,
        });
        addPopup(new maplibregl.Popup({ closeOnClick: false, offset: 12 })
          .setLngLat([+s.LONGITUDE, +s.LATITUDE])
          .setHTML(`<strong>${s.SCHOOL_NAME}</strong><br>${s.CITY}, ${s.COUNTRY}`)
          .addTo(map));
        i++;
        later(hop, 2600);
      };
      hop();
    }

    // ── Teardown ─────────────────────────────────────────────────────────────
    this.teardown = () => {
      destroyed = true;
      flying = false;
      if (rescaleTimer) clearTimeout(rescaleTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clearPopups();
      try { map.remove(); } catch {}
      root.style.padding = '';
    };
  },
};

// ── geometry helpers ────────────────────────────────────────────────────────
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

// Great-circle path as a LineString, interpolated with spherical linear interpolation.
// Longitudes are unwrapped so the line never jumps the wrong way across the antimeridian.
function greatCircle([lng1, lat1], [lng2, lat2], steps = 48) {
  const φ1 = toRad(lat1), λ1 = toRad(lng1), φ2 = toRad(lat2), λ2 = toRad(lng2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));

  // Coincident or antipodal-ish: a straight segment is the honest answer.
  if (!isFinite(d) || d < 1e-9) return [[lng1, lat1], [lng2, lat2]];

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }

  for (let i = 1; i < pts.length; i++) {
    let delta = pts[i][0] - pts[i - 1][0];
    if (delta > 180) pts[i][0] -= 360;
    else if (delta < -180) pts[i][0] += 360;
  }
  return pts;
}

// A closed circular ring of `radiusMetres` around a point, in lng/lat.
function circlePolygon([lng, lat], radiusMetres, steps = 24) {
  const R = 6378137;
  const dLat = toDeg(radiusMetres / R);
  const dLng = toDeg(radiusMetres / (R * Math.max(0.01, Math.cos(toRad(lat)))));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(θ), lat + dLat * Math.sin(θ)]);
  }
  return ring;
}
