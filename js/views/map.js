// View 5 — Map (2D / 3D / globe). MapLibre keyless demotiles basemap.
//  • Schools as circle markers (native MapLibre layer → works in mercator AND globe),
//    radius = number of community members who passed through. Click → side-panel roster.
//  • Migration layer: deck.gl ArcLayer school→school for consecutive postings; width = volume.
//  • 3D mode: deck.gl ColumnLayer per city, height = headcount + map pitch.
//  • Globe projection toggle (MapLibre setProjection).
//  • "Fly the journey": animate the camera hopping through a teacher's postings in order.
import { el, teacherTypeahead } from '../widgets.js';
import { regionColor, parseYear, PRIMARY, ACCENT } from '../degrees.js';

export const view = {
  id: 'map', num: 5, title: 'Map',
  _map: null,
  render(root, ctx) {
    const { data, idx } = ctx;
    const self = this;

    if (typeof maplibregl === 'undefined') {
      root.appendChild(el('div.error-box', { html: 'MapLibre GL failed to load from CDN — check your network connection.' }));
      return;
    }

    // Map needs a positioned, sized container. Use the whole view area.
    root.style.padding = '0';
    const shell = el('div.map-shell');
    const mapDiv = el('div', { id: 'map' });
    shell.appendChild(mapDiv);
    root.appendChild(shell);

    // ── Precompute geo aggregates ──
    const schoolMembers = new Map(); // SCHOOL_ID -> Set(teacher)
    for (const a of data.assignments) {
      if (!schoolMembers.has(a.SCHOOL_ID)) schoolMembers.set(a.SCHOOL_ID, new Set());
      schoolMembers.get(a.SCHOOL_ID).add(a.TEACHER_ID);
    }
    const schoolFeatures = data.schools
      .filter((s) => isFinite(s.LONGITUDE) && isFinite(s.LATITUDE))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.LONGITUDE, s.LATITUDE] },
        properties: {
          id: s.SCHOOL_ID, name: s.SCHOOL_NAME, city: s.CITY, country: s.COUNTRY,
          members: (schoolMembers.get(s.SCHOOL_ID) || new Set()).size, color: regionColor(s.COUNTRY),
        },
      }));

    // Migration arcs (consecutive postings where the school changes), aggregated by pair.
    const arcAgg = new Map();
    for (const [tid, postings] of idx.postingsByTeacher) {
      for (let i = 0; i < postings.length - 1; i++) {
        const a = idx.schoolById.get(postings[i].SCHOOL_ID), b = idx.schoolById.get(postings[i + 1].SCHOOL_ID);
        if (!a || !b || a.SCHOOL_ID === b.SCHOOL_ID) continue;
        if (![a.LONGITUDE, a.LATITUDE, b.LONGITUDE, b.LATITUDE].every(isFinite)) continue;
        const k = `${a.SCHOOL_ID}|${b.SCHOOL_ID}`;
        if (!arcAgg.has(k)) arcAgg.set(k, { from: [a.LONGITUDE, a.LATITUDE], to: [b.LONGITUDE, b.LATITUDE], count: 0, fromName: a.SCHOOL_NAME, toName: b.SCHOOL_NAME });
        arcAgg.get(k).count++;
      }
    }
    const arcs = [...arcAgg.values()];

    // City headcount columns (distinct teachers per city centroid).
    const cityAgg = new Map();
    for (const s of data.schools) {
      const key = `${s.CITY}|${s.COUNTRY}`;
      if (!cityAgg.has(key)) cityAgg.set(key, { city: s.CITY, country: s.COUNTRY, lngs: [], lats: [], members: new Set() });
      const c = cityAgg.get(key);
      if (isFinite(s.LONGITUDE)) { c.lngs.push(s.LONGITUDE); c.lats.push(s.LATITUDE); }
      for (const t of (schoolMembers.get(s.SCHOOL_ID) || [])) c.members.add(t);
    }
    const columns = [...cityAgg.values()].filter((c) => c.lngs.length).map((c) => ({
      position: [d3.mean(c.lngs), d3.mean(c.lats)], city: c.city, country: c.country,
      headcount: c.members.size, color: regionColor(c.country),
    }));

    // ── Control overlay ──
    const overlay = el('div.map-overlay');
    overlay.appendChild(el('h3', { text: 'Worldwide community' }));
    const mkToggle = (label, checked, on) => {
      const cb = el('input', { type: 'checkbox' }); if (checked) cb.checked = true;
      cb.addEventListener('change', () => on(cb.checked));
      return el('div.control-group', {}, [el('label', {}, [cb, ' ' + label])]);
    };
    let showArcs = true, show3D = false, globe = false;
    overlay.appendChild(mkToggle('Migration arcs', true, (v) => { showArcs = v; updateDeck(); }));
    overlay.appendChild(mkToggle('3D headcount columns', false, (v) => { show3D = v; if (map) map.easeTo({ pitch: v ? 50 : 0 }); updateDeck(); }));
    overlay.appendChild(mkToggle('Globe projection', false, (v) => { globe = v; setGlobe(v); }));

    const journeyBox = el('div.control-group', { style: 'flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;' });
    journeyBox.appendChild(el('label', { text: 'Fly a teacher\'s journey' }));
    let journeyId = 'T001';
    journeyBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { journeyId = id; }, { value: journeyId, placeholder: 'Pick a teacher…' }));
    journeyBox.appendChild(el('button.btn.accent', { text: '▶ Fly the journey', onclick: () => flyJourney(journeyId) }));
    overlay.appendChild(journeyBox);

    overlay.appendChild(el('div.legend', { style: 'margin-top:10px;' }, [
      el('span.item', {}, [el('span.swatch', { style: `background:${PRIMARY}` }), 'arc = a teacher move']),
    ]));
    shell.appendChild(overlay);

    // side panel for school roster
    const panel = el('div.side-panel');
    shell.appendChild(panel);

    // ── Build the map ──
    const map = new maplibregl.Map({
      container: mapDiv,
      style: 'https://demotiles.maplibre.org/style.json', // keyless basemap
      center: [30, 20], zoom: 1.4, attributionControl: true,
    });
    self._map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    let overlayCtl = null;
    map.on('load', () => {
      // School points as a native source/layer (renders correctly under globe too).
      map.addSource('schools', { type: 'geojson', data: { type: 'FeatureCollection', features: schoolFeatures } });
      const maxMembers = d3.max(schoolFeatures, (f) => f.properties.members) || 1;
      map.addLayer({
        id: 'school-circles', type: 'circle', source: 'schools',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'members'], 0, 4, maxMembers, 26],
          'circle-color': ['get', 'color'], 'circle-opacity': 0.78,
          'circle-stroke-width': 1.2, 'circle-stroke-color': '#ffffff',
        },
      });

      map.on('click', 'school-circles', (e) => openRoster(e.features[0].properties.id));
      map.on('mouseenter', 'school-circles', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'school-circles', () => (map.getCanvas().style.cursor = ''));

      // deck.gl overlay (arcs + columns).
      if (typeof deck !== 'undefined' && deck.MapboxOverlay) {
        overlayCtl = new deck.MapboxOverlay({ interleaved: false, layers: [] });
        map.addControl(overlayCtl);
        updateDeck();
      } else {
        overlay.appendChild(el('p.muted', { style: 'font-size:11px;margin-top:8px;', text: 'deck.gl not loaded — arcs/columns unavailable, points still work.' }));
      }
    });

    function updateDeck() {
      if (!overlayCtl || typeof deck === 'undefined') return;
      const layers = [];
      if (showArcs) {
        const maxC = d3.max(arcs, (a) => a.count) || 1;
        layers.push(new deck.ArcLayer({
          id: 'arcs', data: arcs,
          getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to,
          getSourceColor: [23, 162, 184], getTargetColor: [255, 107, 53],
          getWidth: (d) => 1 + (d.count / maxC) * 6, getHeight: show3D ? 0.6 : 0.25,
          greatCircle: true, pickable: true,
          onClick: ({ object, coordinate }) => object && coordinate && new maplibregl.Popup({ offset: 8 })
            .setLngLat(coordinate).setHTML(`<strong>${object.fromName} → ${object.toName}</strong><br>${object.count} teacher move(s)`).addTo(map),
        }));
      }
      if (show3D) {
        const maxH = d3.max(columns, (c) => c.headcount) || 1;
        layers.push(new deck.ColumnLayer({
          id: 'cols', data: columns, diskResolution: 12, radius: 30000, extruded: true,
          getPosition: (d) => d.position, getElevation: (d) => (d.headcount / maxH) * 600000,
          getFillColor: (d) => [...hexRgb(d.color), 200], elevationScale: 1, pickable: true,
          onClick: ({ object, coordinate }) => object && coordinate && new maplibregl.Popup({ offset: 8 })
            .setLngLat(coordinate).setHTML(`<strong>${object.city}, ${object.country}</strong><br>${object.headcount} community members`).addTo(map),
        }));
      }
      overlayCtl.setProps({ layers });
    }

    function setGlobe(on) {
      try { map.setProjection({ type: on ? 'globe' : 'mercator' }); }
      catch (err) { console.warn('[6deg] globe projection unsupported:', err); }
    }

    function openRoster(schoolId) {
      const s = idx.schoolById.get(schoolId) || {};
      // roster: who was there + which years
      const roster = data.assignments.filter((a) => a.SCHOOL_ID === schoolId)
        .map((a) => ({ a, t: idx.teacherById.get(a.TEACHER_ID) }))
        .filter((r) => r.t)
        .sort((x, y) => String(x.a.START_DATE).localeCompare(String(y.a.START_DATE)));
      panel.innerHTML = '';
      panel.append(
        el('button.close', { text: '×', onclick: () => panel.classList.remove('open') }),
        el('h3', { text: s.SCHOOL_NAME || schoolId }),
        el('div.sub', { text: `${s.CITY || ''}, ${s.COUNTRY || ''} · ${s.CURRICULUM_TYPE || ''} · ${roster.length} postings` }),
        el('h4', { text: 'Roster (mini timeline)', style: 'margin:8px 0 4px;font-size:13px;' }),
        el('ul', {}, roster.map((r) => el('li', {
          html: `<strong>${r.t.FULL_NAME}</strong> — ${r.a.POSITION_TITLE}` +
            `<small>${(r.a.START_DATE || '').slice(0, 4)}–${(r.a.END_DATE || '').slice(0, 4) || 'present'} · ${r.a.SUBJECTS_TAUGHT || ''}</small>`,
        }))),
      );
      panel.classList.add('open');
    }

    function flyJourney(teacherId) {
      const postings = (idx.postingsByTeacher.get(teacherId) || [])
        .map((p) => idx.schoolById.get(p.SCHOOL_ID)).filter((s) => s && isFinite(s.LONGITUDE));
      if (!postings.length) return;
      panel.classList.remove('open');
      let i = 0;
      const hop = () => {
        if (i >= postings.length) return;
        const s = postings[i];
        map.flyTo({ center: [s.LONGITUDE, s.LATITUDE], zoom: 4.2, pitch: show3D ? 50 : 30, speed: 0.8, essential: true });
        new maplibregl.Popup({ closeOnClick: false, offset: 12 })
          .setLngLat([s.LONGITUDE, s.LATITUDE])
          .setHTML(`<strong>${s.SCHOOL_NAME}</strong><br>${s.CITY}, ${s.COUNTRY}`)
          .addTo(map);
        i++;
        setTimeout(hop, 2600);
      };
      hop();
    }

    this.teardown = () => { if (self._map) { try { self._map.remove(); } catch {} self._map = null; } root.style.padding = ''; };
  },
};

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
