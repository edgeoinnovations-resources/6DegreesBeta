// View 8 — Search & pathfinder.
//  • Faceted search over teachers (country/city/school/role/subject/years/curriculum/verified).
//  • Pathfinder: pick A & B → path through the colleagueship graph, each hop labeled by degree
//    + shared context. Defaults to the documented T001→T010 demo chain (see note in renderPath).
//  • "Who do I know at School X?" — school + max degree → matching people.
//  • Reverse-recruiting query builder: people within N degrees of [person] who taught [subject]
//    in 2+ countries.
//  • Clearly-commented stub for future natural-language search (Supabase edge fn → Anthropic API).
import { el, teacherTypeahead } from '../widgets.js';
import {
  bfsPath, strengthPath, degreeColor, degreeLabel, degreeShort, regionOf, parseYear, ACCENT, teacherName,
} from '../degrees.js';

export const view = {
  id: 'search', num: 8, title: 'Search',
  render(root, ctx) {
    const { data, idx } = ctx;

    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Search & pathfinder' }),
      el('p', { html: 'Find people, trace how any two are linked, and build recruiting queries — all over the read-only demo graph.' }),
    ]));

    // Section nav (sub-tabs).
    const sub = el('div.checkrow', { style: 'margin-bottom:14px;' });
    const sections = [
      ['faceted', 'Faceted search'], ['path', 'Pathfinder'],
      ['school', 'Who do I know at…'], ['recruit', 'Reverse recruiting'], ['nl', 'Natural language'],
    ];
    const panes = {};
    sections.forEach(([id, label], i) => {
      const btn = el('label', { style: i === 0 ? 'background:#eef6f8;border-color:#17A2B8;' : '' }, [label]);
      btn.addEventListener('click', () => {
        Object.values(panes).forEach((p) => (p.style.display = 'none'));
        [...sub.children].forEach((c) => (c.style.cssText = ''));
        btn.style.cssText = 'background:#eef6f8;border-color:#17A2B8;';
        panes[id].style.display = 'block';
      });
      sub.appendChild(btn);
    });
    root.appendChild(sub);

    panes.faceted = facetedSearch(ctx); root.appendChild(panes.faceted);
    panes.path = pathfinder(ctx); panes.path.style.display = 'none'; root.appendChild(panes.path);
    panes.school = whoDoIKnow(ctx); panes.school.style.display = 'none'; root.appendChild(panes.school);
    panes.recruit = reverseRecruiting(ctx); panes.recruit.style.display = 'none'; root.appendChild(panes.recruit);
    panes.nl = nlStub(); panes.nl.style.display = 'none'; root.appendChild(panes.nl);
  },
};

// ── Faceted search ──────────────────────────────────────────────────────────
function facetedSearch(ctx) {
  const { data, idx } = ctx;
  const pane = el('div');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const countries = uniq(data.schools.map((s) => s.COUNTRY));
  const cities = uniq(data.schools.map((s) => s.CITY));
  const curricula = uniq(data.schools.map((s) => s.CURRICULUM_TYPE));
  const roles = uniq(data.assignments.map((a) => a.POSITION_TITLE));
  const subjects = uniq(data.assignments.flatMap((a) => (a.SUBJECTS_TAUGHT || '').split(/[,;/]/).map((x) => x.trim())));

  const sel = (label, options) => {
    const s = el('select', {}, [el('option', { value: '', text: `Any ${label}` }), ...options.map((o) => el('option', { value: o, text: o }))]);
    return el('div.control-group', {}, [el('label', { text: label }), s]);
  };
  const fCountry = sel('country', countries), fCity = sel('city', cities), fCurr = sel('curriculum', curricula),
    fRole = sel('role', roles), fSubject = sel('subject', subjects);
  const minYears = el('input', { type: 'number', min: 0, max: 40, value: 0, style: 'width:64px;' });
  const verifiedOnly = el('input', { type: 'checkbox' });

  const controls = el('div.controls');
  controls.append(fCountry, fCity, fCurr, fRole, fSubject,
    el('div.control-group', {}, [el('label', { text: 'Min years' }), minYears]),
    el('div.control-group', {}, [el('label', {}, [verifiedOnly, ' verified (mutual) only'])]),
    el('button.btn', { text: 'Search', onclick: run }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);
  const val = (group) => group.querySelector('select').value;

  function run() {
    const c = val(fCountry), city = val(fCity), curr = val(fCurr), role = val(fRole), subj = val(fSubject);
    const minY = +minYears.value || 0;
    const vOnly = verifiedOnly.checked;

    const mutualSet = vOnly ? new Set(data.colleagueships.filter((x) => x.VERIFIED === 'mutual')
      .flatMap((x) => [x.TEACHER_A_ID, x.TEACHER_B_ID])) : null;

    const results = data.teachers.filter((t) => {
      if ((t.YEARS_EXPERIENCE || 0) < minY) return false;
      if (vOnly && !mutualSet.has(t.TEACHER_ID)) return false;
      const postings = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
      const schoolsT = postings.map((p) => idx.schoolById.get(p.SCHOOL_ID)).filter(Boolean);
      if (c && !schoolsT.some((s) => s.COUNTRY === c)) return false;
      if (city && !schoolsT.some((s) => s.CITY === city)) return false;
      if (curr && !schoolsT.some((s) => s.CURRICULUM_TYPE === curr)) return false;
      if (role && !postings.some((p) => p.POSITION_TITLE === role)) return false;
      if (subj && !postings.some((p) => (p.SUBJECTS_TAUGHT || '').toLowerCase().includes(subj.toLowerCase()))) return false;
      return true;
    });

    out.innerHTML = '';
    out.appendChild(el('p.muted', { style: 'margin:8px 2px;', text: `${results.length} teacher(s)` }));
    out.appendChild(resultsTable(results, ctx));
  }
  run();
  return pane;
}

function resultsTable(results, ctx) {
  const { idx, counts } = ctx;
  const table = el('table.data');
  table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Specialization', 'Nationality', 'Yrs', 'Current school', 'Conns', ''].map((h) => el('th', { text: h })))]));
  const tb = el('tbody');
  results.slice(0, 200).forEach((t) => {
    const ps = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
    const cur = ps.find((p) => p.IS_CURRENT_POSITION === 'Yes') || ps[ps.length - 1];
    const sc = cur ? idx.schoolById.get(cur.SCHOOL_ID) : null;
    tb.appendChild(el('tr', {}, [
      el('td', { html: `<strong>${t.FULL_NAME}</strong>` }),
      el('td', { text: t.SPECIALIZATION || '' }),
      el('td', { text: t.NATIONALITY || '' }),
      el('td', { text: String(t.YEARS_EXPERIENCE ?? '') }),
      el('td', { text: sc ? `${sc.SCHOOL_NAME}, ${sc.COUNTRY}` : '—' }),
      el('td', { text: String(counts.get(t.TEACHER_ID) || 0) }),
      el('td', {}, [el('button.btn.ghost', { text: 'ego →', onclick: () => ctx.navigateTo('ego', { teacher: t.TEACHER_ID }) })]),
    ]));
  });
  table.appendChild(tb);
  return table;
}

// ── Pathfinder ──────────────────────────────────────────────────────────────
function pathfinder(ctx) {
  const { data, idx, adj } = ctx;
  const pane = el('div');
  let A = 'T001', B = 'T010', mode = 'featured';

  const controls = el('div.controls');
  const aBox = el('div.control-group', {}, [el('label', { text: 'Person A' })]);
  aBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { A = id; mode = mode === 'featured' ? 'strength' : mode; draw(); }, { value: A }));
  const bBox = el('div.control-group', {}, [el('label', { text: 'Person B' })]);
  bBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { B = id; mode = mode === 'featured' ? 'strength' : mode; draw(); }, { value: B }));
  const modeSel = el('select', {}, [
    el('option', { value: 'featured', text: 'Featured demo chain' }),
    el('option', { value: 'strength', text: 'Strongest links (Dijkstra on degree)' }),
    el('option', { value: 'hops', text: 'Fewest hops (BFS)' }),
  ]);
  modeSel.addEventListener('change', () => { mode = modeSel.value; draw(); });
  controls.append(aBox, bBox, el('div.control-group', {}, [el('label', { text: 'Path' }), modeSel]),
    el('button.btn', { text: 'Find path', onclick: draw }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);

  function draw() {
    modeSel.value = mode;
    out.innerHTML = '';
    let chain, caption;

    if (mode === 'featured' && A === 'T001' && B === 'T010') {
      // The DEMO_GUIDE's narrative chain: T001→T008→T009→T010, every hop a real degree-1 edge.
      // (Shown as the demo default. NOTE: the graph also has shorter 2-hop links between these
      //  two — switch to "Fewest hops" / "Strongest links" to see them. Curated here for the story.)
      chain = buildChain(['T001', 'T008', 'T009', 'T010'], adj);
      caption = 'Featured demo chain — the warm-intro story from the demo guide (all degree-1 hops). ' +
        'The live graph also has shorter routes; try the other path modes.';
    } else {
      const fn = mode === 'hops' ? bfsPath : strengthPath;
      chain = fn(adj, A, B);
      caption = mode === 'hops'
        ? 'Fewest hops (BFS) — the literal "degrees of separation".'
        : 'Strongest links — minimizes total relationship-degree (prefers strong colleagueships).';
      if (mode === 'featured') { modeSel.value = 'strength'; mode = 'strength'; }
    }

    if (!chain) { out.appendChild(el('div.error-box', { text: 'No path found between these two people.' })); return; }
    out.appendChild(el('p.muted', { style: 'margin:8px 2px;', html: `${caption} &nbsp;·&nbsp; <strong>${chain.length - 1} hop(s)</strong>` }));
    out.appendChild(renderChain(chain, idx, ctx));
  }
  draw();
  return pane;
}

// Turn an explicit id list into [{id, edge}] by looking up each consecutive edge.
function buildChain(ids, adj) {
  const chain = [{ id: ids[0], edge: null }];
  for (let i = 1; i < ids.length; i++) {
    const edges = adj.get(ids[i - 1]) || [];
    let edge = edges.filter((e) => e.other === ids[i]).sort((a, b) => a.degree - b.degree)[0];
    if (!edge) return null;
    chain.push({ id: ids[i], edge });
  }
  return chain;
}

function renderChain(chain, idx, ctx) {
  const wrap = el('div.path-chain');
  chain.forEach((step, i) => {
    if (i > 0) {
      const e = step.edge;
      wrap.appendChild(el('div.path-hop', {}, [
        el('span.arrow', { text: '→' }),
        el('span.deg-pill', { style: `background:${degreeColor(e.degree)}`, text: `Degree ${e.degree}` }),
        el('span.ctx', { html: `${degreeShort(e.degree)}<br>${e.label || ''}${e.overlap ? ` · ${e.overlap}` : ''}${e.verified === 'mutual' ? ' ✓' : ''}` }),
      ]));
    }
    const t = idx.teacherById.get(step.id) || {};
    const endpoint = i === 0 || i === chain.length - 1;
    const node = el(`div.path-node${endpoint ? '.endpoint' : ''}`, { style: 'cursor:pointer;' }, [
      el('div.nm', { text: t.FULL_NAME || step.id }),
      el('div.meta', { text: `${t.SPECIALIZATION || ''} · ${t.NATIONALITY || ''}` }),
    ]);
    node.addEventListener('click', () => ctx.navigateTo('ego', { teacher: step.id }));
    wrap.appendChild(node);
  });
  return wrap;
}

// ── Who do I know at School X? ────────────────────────────────────────────────
function whoDoIKnow(ctx) {
  const { data, idx, adj } = ctx;
  const pane = el('div');
  const schoolsSorted = data.schools.slice().sort((a, b) => a.SCHOOL_NAME.localeCompare(b.SCHOOL_NAME));
  const schoolSel = el('select', {}, schoolsSorted.map((s) => el('option', { value: s.SCHOOL_ID, text: `${s.SCHOOL_NAME} · ${s.COUNTRY}` })));
  const fromBox = el('div.control-group', {}, [el('label', { text: 'From' })]);
  let fromId = 'T001';
  fromBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { fromId = id; run(); }, { value: fromId }));
  const maxDeg = el('select', {}, [1, 2, 3, 4, 5, 6].map((d) => el('option', { value: d, text: `≤ degree ${d}`, selected: d === 3 ? 'selected' : null })));

  const controls = el('div.controls');
  controls.append(fromBox, el('div.control-group', {}, [el('label', { text: 'At school' }), schoolSel]),
    el('div.control-group', {}, [el('label', { text: 'Max link' }), maxDeg]),
    el('button.btn', { text: 'Find', onclick: run }));
  pane.appendChild(controls);
  const out = el('div'); pane.appendChild(out);

  function run() {
    const sid = schoolSel.value, md = +maxDeg.value;
    const peopleAtSchool = idx.teachersBySchool.get(sid) || new Set();
    // Best (lowest) degree link from fromId to each person.
    const best = new Map();
    for (const e of adj.get(fromId) || []) {
      if (!best.has(e.other) || e.degree < best.get(e.other).degree) best.set(e.other, e);
    }
    const matches = [...peopleAtSchool].filter((p) => p !== fromId && best.has(p) && best.get(p).degree <= md)
      .map((p) => ({ id: p, edge: best.get(p) }))
      .sort((a, b) => a.edge.degree - b.edge.degree);

    out.innerHTML = '';
    const sName = (idx.schoolById.get(sid) || {}).SCHOOL_NAME || sid;
    out.appendChild(el('p.muted', { style: 'margin:8px 2px;', html: `${matches.length} connection(s) of <strong>${teacherName(idx, fromId)}</strong> at <strong>${sName}</strong> within degree ${md}` }));
    const table = el('table.data');
    table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Link', 'Shared context', 'Verified', ''].map((h) => el('th', { text: h })))]));
    const tb = el('tbody');
    matches.forEach((m) => {
      const t = idx.teacherById.get(m.id) || {};
      tb.appendChild(el('tr', {}, [
        el('td', { html: `<strong>${t.FULL_NAME}</strong><br><small class="muted">${t.SPECIALIZATION || ''}</small>` }),
        el('td', { html: `<span class="pill" style="background:${degreeColor(m.edge.degree)};color:#fff;">deg ${m.edge.degree}</span>` }),
        el('td', { html: `${m.edge.label || ''}<br><small class="muted">${degreeLabel(m.edge.degree)}</small>` }),
        el('td', { html: m.edge.verified === 'mutual' ? '<span class="badge-mutual">mutual ✓</span>' : m.edge.verified }),
        el('td', {}, [el('button.btn.ghost', { text: 'ego →', onclick: () => ctx.navigateTo('ego', { teacher: m.id }) })]),
      ]));
    });
    table.appendChild(tb); out.appendChild(table);
  }
  run();
  return pane;
}

// ── Reverse recruiting query builder ─────────────────────────────────────────
// "People within N degrees of [person] who taught [subject] in 2+ countries."
function reverseRecruiting(ctx) {
  const { data, idx, adj } = ctx;
  const pane = el('div');
  pane.appendChild(el('p.muted', { style: 'margin:4px 2px 12px;', html: 'People within <em>N</em> degrees of a person who taught a subject across multiple countries — a warm-intro shortlist.' }));

  let anchor = 'T001';
  const anchorBox = el('div.control-group', {}, [el('label', { text: 'Within N degrees of' })]);
  anchorBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { anchor = id; run(); }, { value: anchor }));
  const nSel = el('select', {}, [1, 2, 3, 4, 5, 6].map((d) => el('option', { value: d, text: `≤ ${d} hops`, selected: d === 2 ? 'selected' : null })));
  const subjects = [...new Set(data.assignments.flatMap((a) => (a.SUBJECTS_TAUGHT || '').split(/[,;/]/).map((x) => x.trim())).filter(Boolean))].sort();
  const subjSel = el('select', {}, [el('option', { value: '', text: 'Any subject' }), ...subjects.map((s) => el('option', { value: s, text: s }))]);
  const minCountries = el('input', { type: 'number', min: 1, max: 6, value: 2, style: 'width:60px;' });

  const controls = el('div.controls');
  controls.append(anchorBox, el('div.control-group', {}, [el('label', { text: 'Separation' }), nSel]),
    el('div.control-group', {}, [el('label', { text: 'Taught' }), subjSel]),
    el('div.control-group', {}, [el('label', { text: 'In ≥ N countries' }), minCountries]),
    el('button.btn.accent', { text: 'Build shortlist', onclick: run }));
  pane.appendChild(controls);
  const out = el('div'); pane.appendChild(out);

  function run() {
    const N = +nSel.value, subj = subjSel.value, minC = +minCountries.value || 1;
    // BFS hop distance from anchor.
    const dist = new Map([[anchor, 0]]); const q = [anchor];
    while (q.length) { const cur = q.shift(); const d = dist.get(cur);
      if (d >= N) continue;
      for (const e of adj.get(cur) || []) if (!dist.has(e.other)) { dist.set(e.other, d + 1); q.push(e.other); } }

    const rows = [];
    for (const [id, d] of dist) {
      if (id === anchor || d === 0) continue;
      const postings = idx.postingsByTeacher.get(id) || [];
      const taughtSubj = !subj || postings.some((p) => (p.SUBJECTS_TAUGHT || '').toLowerCase().includes(subj.toLowerCase()));
      if (!taughtSubj) continue;
      const countries = new Set(postings.map((p) => (idx.schoolById.get(p.SCHOOL_ID) || {}).COUNTRY).filter(Boolean));
      if (countries.size < minC) continue;
      rows.push({ id, d, countries: [...countries] });
    }
    rows.sort((a, b) => a.d - b.d || b.countries.length - a.countries.length);

    out.innerHTML = '';
    out.appendChild(el('p.muted', { style: 'margin:8px 2px;', html: `${rows.length} candidate(s) within ${N} hop(s) of <strong>${teacherName(idx, anchor)}</strong>${subj ? ` who taught <strong>${subj}</strong>` : ''} in ≥ ${minC} countries` }));
    const table = el('table.data');
    table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Hops', 'Specialization', 'Countries taught in', ''].map((h) => el('th', { text: h })))]));
    const tb = el('tbody');
    rows.slice(0, 200).forEach((r) => {
      const t = idx.teacherById.get(r.id) || {};
      tb.appendChild(el('tr', {}, [
        el('td', { html: `<strong>${t.FULL_NAME}</strong>` }),
        el('td', { html: `<span class="pill">${r.d}</span>` }),
        el('td', { text: t.SPECIALIZATION || '' }),
        el('td', { html: `${r.countries.length} · <small class="muted">${r.countries.join(', ')}</small>` }),
        el('td', {}, [el('button.btn.ghost', { text: 'ego →', onclick: () => ctx.navigateTo('ego', { teacher: r.id }) })]),
      ]));
    });
    table.appendChild(tb); out.appendChild(table);
  }
  run();
  return pane;
}

// ── Natural-language search stub (future) ────────────────────────────────────
function nlStub() {
  const pane = el('div.card');
  pane.append(
    el('h4', { text: 'Natural-language search (coming soon)' }),
    el('p.muted', { html: 'Type a question like <em>"physics teachers in the Gulf within 2 degrees of Sarah Mitchell"</em>. ' +
      'This is intentionally a stub — see the commented plan below.' }),
    el('div', { style: 'display:flex;gap:8px;margin:10px 0;' }, [
      el('input', { type: 'text', placeholder: 'Ask a question…', style: 'flex:1;', disabled: 'disabled' }),
      el('button.btn', { text: 'Ask', disabled: 'disabled' }),
    ]),
    el('pre', { style: 'background:#f3f7f8;padding:12px;border-radius:8px;font-size:12px;overflow:auto;white-space:pre-wrap;',
      text:
`// FUTURE: natural-language search.
// The browser NEVER holds an API key. Flow:
//
//   1. Client POSTs the question to a Supabase Edge Function.
//   2. The Edge Function (server-side, key stored as a Supabase secret) calls the
//      Anthropic API (claude model) with the question + a compact schema description,
//      asking it to emit a STRUCTURED filter (country, subject, max_degree, anchor, …).
//   3. The Edge Function runs that filter against Postgres (the same tables) and
//      returns rows — which this view renders exactly like the faceted results table.
//
//   No key is ever embedded client-side; the model only returns a query spec, not data.` }),
  );
  return pane;
}
