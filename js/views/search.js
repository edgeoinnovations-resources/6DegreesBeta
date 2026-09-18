// View 2 — "Who knows whom".
//
// WHY THIS SHAPE (beta feedback, Jun–Sep 2026):
//
//   Dave: "I really like the 'reverse recruiting' section, but not the name. That's the
//   sort of feature I'd use more than the graphically based ones — who's 'related' to
//   someone I know. That's always the question you ask someone: 'Do you know…?'"
//
//   Linda (day one): "I'm looking at X school — who do I know or who do they know that
//   has been there?"   Dee (day one): "I'm looking at hiring X. Who do I know that's
//   worked with them?"   Dee (Sept): "if I meet someone at a conference … 'look, we were
//   both here!' or 'oh, we both know…'"
//
// Every stated version of the question is anchored on a PERSON or a SCHOOL. Nobody ever
// asked to filter by subject taught — and the one person who raised subjects (Melissa)
// said they "don't have to be searchable". So the old subject/countries "reverse
// recruiting" query builder is gone, and its job is done by the two modes below:
//
//   1. At a school   — "who do I know that's there or been there?"
//   2. With a person — the chain between you, plus who you both know.
//   3. Find people   — plain faceted list (place / curriculum / role / experience).
//
// FUTURE — natural-language search. Deliberately not built, and no longer given a tab.
// The plan, for whenever it earns its place: the browser NEVER holds an API key. Client
// POSTs the question to a Supabase Edge Function; that function (key stored as a Supabase
// secret) asks the Anthropic API to turn the question into a STRUCTURED filter (country,
// max_degree, anchor, …); the function runs that filter against Postgres and returns
// rows, which render exactly like the faceted table. The model only ever emits a query
// spec — never data, never a key in the client.
import { el, append, teacherTypeahead } from '../widgets.js';
import {
  bfsPath, strengthPath, degreeColor, degreeLabel, degreeShort,
  teacherName, roleCategory, rolesOf, ROLE_CATEGORIES, confirmBadge, hasAcknowledged,
  currentPosting,
} from '../degrees.js';

export const view = {
  id: 'search', num: 2, title: 'Who knows whom',
  render(root, ctx) {
    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Who knows whom' }),
      el('p', { html: 'The two questions people actually ask: <em>“I’m looking at that school — who do I know there?”</em> and <em>“I just met this person — what do we have in common?”</em>' }),
    ]));

    // Sub-tabs.
    const sub = el('div.checkrow', { style: 'margin-bottom:14px;' });
    const sections = [
      ['school', 'At a school'],
      ['person', 'With a person'],
      ['find', 'Find people'],
    ];
    const panes = {};
    const tabs = new Map();
    const select = (id) => {
      Object.entries(panes).forEach(([k, p]) => (p.style.display = k === id ? 'block' : 'none'));
      tabs.forEach((b, k) => b.classList.toggle('sel', k === id));
    };
    sections.forEach(([id, label]) => {
      const btn = el('label', { text: label, style: 'cursor:pointer;' });
      btn.addEventListener('click', () => select(id));
      sub.appendChild(btn);
      tabs.set(id, btn);
    });
    root.appendChild(sub);

    panes.school = whoDoIKnowAt(ctx); root.appendChild(panes.school);
    panes.person = withAPerson(ctx); root.appendChild(panes.person);
    panes.find = findPeople(ctx); root.appendChild(panes.find);

    // Honour a deep-linked sub-tab (?tab=person), else default to the school question.
    const wanted = sections.some(([id]) => id === ctx.state.params.tab) ? ctx.state.params.tab : 'school';
    select(wanted);
  },
};

// Best (lowest-degree) direct edge from `from` to every neighbour.
function bestEdges(adj, from) {
  const best = new Map();
  for (const e of adj.get(from) || []) {
    if (!best.has(e.other) || e.degree < best.get(e.other).degree) best.set(e.other, e);
  }
  return best;
}

const degPill = (d) => `<span class="pill" style="background:${degreeColor(d)};color:#fff;">deg ${d}</span>`;

// ── 1. Who do I know at School X? ───────────────────────────────────────────
function whoDoIKnowAt(ctx) {
  const { data, idx, adj } = ctx;
  const pane = el('div');
  pane.appendChild(el('p.muted', { style: 'margin:4px 2px 12px;', text: 'Pick a school you’re curious about. These are the people you already have a link to who taught, studied or worked there — at any time.' }));

  const schoolsSorted = data.schools.slice().sort((a, b) => a.SCHOOL_NAME.localeCompare(b.SCHOOL_NAME));
  const schoolSel = el('select', {}, schoolsSorted.map((s) => el('option', { value: s.SCHOOL_ID, text: `${s.SCHOOL_NAME} · ${s.COUNTRY}` })));
  if (ctx.state.params.school) schoolSel.value = ctx.state.params.school;

  let fromId = ctx.state.egoTeacher || 'T001';
  const fromBox = el('div.control-group', {}, [el('label', { text: 'You are' })]);
  fromBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { fromId = id; run(); }, { value: fromId }));

  const maxDeg = el('select', {}, [1, 2, 3, 4, 5, 6].map((d) =>
    el('option', { value: d, text: `≤ degree ${d}`, selected: d === 3 ? 'selected' : null })));

  const controls = el('div.controls');
  controls.append(fromBox,
    el('div.control-group', {}, [el('label', { text: 'At school' }), schoolSel]),
    el('div.control-group', {}, [el('label', { text: 'Max link' }), maxDeg]),
    el('button.btn', { text: 'Find', onclick: run }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);
  schoolSel.addEventListener('change', run);
  maxDeg.addEventListener('change', run);

  function run() {
    const sid = schoolSel.value, md = +maxDeg.value;
    const peopleAtSchool = idx.teachersBySchool.get(sid) || new Set();
    const best = bestEdges(adj, fromId);
    const matches = [...peopleAtSchool]
      .filter((p) => p !== fromId && best.has(p) && best.get(p).degree <= md)
      .map((p) => ({ id: p, edge: best.get(p) }))
      .sort((a, b) => a.edge.degree - b.edge.degree);

    out.innerHTML = '';
    const s = idx.schoolById.get(sid) || {};
    out.appendChild(el('p.muted', { style: 'margin:8px 2px;', html: `<strong>${matches.length}</strong> of <strong>${teacherName(idx, fromId)}</strong>’s connections have been at <strong>${s.SCHOOL_NAME || sid}</strong> (within degree ${md}) — out of ${peopleAtSchool.size} community members who passed through.` }));

    if (!matches.length) {
      out.appendChild(el('div.card', { html: 'No links at that school within this degree. Widen <em>Max link</em>, or check the <strong>With a person</strong> tab to find a second-hand route.' }));
      return;
    }

    const ack = hasAcknowledged(data);
    const table = el('table.data');
    const heads = ack ? ['Name', 'Role there', 'Link', 'Shared context', 'Verified', '']
                      : ['Name', 'Role there', 'Link', 'Shared context', ''];
    table.appendChild(el('thead', {}, [el('tr', {}, heads.map((h) => el('th', { text: h })))]));
    const tb = el('tbody');
    matches.forEach((m) => {
      const t = idx.teacherById.get(m.id) || {};
      const theirPosting = (idx.postingsByTeacher.get(m.id) || []).find((p) => p.SCHOOL_ID === sid);
      const yrs = theirPosting
        ? `${(theirPosting.START_DATE || '').slice(0, 4)}–${(theirPosting.END_DATE || '').slice(0, 4) || 'present'}`
        : '';
      tb.appendChild(el('tr', {}, [
        el('td', { html: `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)}` }),
        el('td', { html: `${theirPosting ? roleCategory(theirPosting.POSITION_TITLE) : '—'}<br><small class="muted">${yrs}</small>` }),
        el('td', { html: degPill(m.edge.degree) }),
        el('td', { html: `${m.edge.label || ''}<br><small class="muted">${degreeLabel(m.edge.degree)}</small>` }),
        ack ? el('td', { html: m.edge.verified === 'mutual' ? '<span class="badge-mutual">mutual ✓</span>' : (m.edge.verified || '') }) : null,
        el('td', {}, [el('button.btn.ghost', { text: 'connections →', onclick: () => ctx.navigateTo('ego', { teacher: m.id }) })]),
      ]));
    });
    table.appendChild(tb);
    out.appendChild(table);
  }
  run();
  return pane;
}

// ── 2. With a person — the chain, plus who you both know ────────────────────
function withAPerson(ctx) {
  const { data, idx, adj } = ctx;
  const pane = el('div');
  pane.appendChild(el('p.muted', { style: 'margin:4px 2px 12px;', text: 'You’ve just met someone, or you’re about to work with them. This shows how the two of you are linked and who you already know in common.' }));

  let A = ctx.state.egoTeacher || 'T001';
  let B = ctx.state.params.other || (idx.teacherById.has('B002') ? 'B002' : 'T010');
  let mode = 'hops';

  const aBox = el('div.control-group', {}, [el('label', { text: 'You are' })]);
  aBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { A = id; draw(); }, { value: A }));
  const bBox = el('div.control-group', {}, [el('label', { text: 'Them' })]);
  bBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { B = id; draw(); }, { value: B }));

  const modeSel = el('select', {}, [
    el('option', { value: 'hops', text: 'Fewest people in between' }),
    el('option', { value: 'strength', text: 'Strongest links' }),
  ]);
  modeSel.addEventListener('change', () => { mode = modeSel.value; draw(); });

  const controls = el('div.controls');
  controls.append(aBox, bBox,
    el('div.control-group', {}, [el('label', { text: 'Route' }), modeSel]),
    el('button.btn', { text: 'Show', onclick: draw }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);

  function draw() {
    out.innerHTML = '';
    if (A === B) {
      out.appendChild(el('div.card', { text: 'Pick two different people.' }));
      return;
    }

    // (a) Any direct link — "look, we were both here!"
    const direct = (adj.get(A) || []).filter((e) => e.other === B).sort((x, y) => x.degree - y.degree);
    if (direct.length) {
      const list = el('ul');
      direct.forEach((e) => list.appendChild(el('li', {
        html: `${degPill(e.degree)} <strong>${e.label || ''}</strong> — ${degreeShort(e.degree)}${e.overlap ? ` · ${e.overlap}` : ''}${e.verified === 'mutual' ? ' <span class="badge-mutual">mutual ✓</span>' : ''}`,
      })));
      const card = el('div.card');
      card.append(el('h4', { text: 'You overlapped directly' }), list);
      out.appendChild(card);
    }

    // (b) The chain.
    const chain = (mode === 'hops' ? bfsPath : strengthPath)(adj, A, B);
    const chainCard = el('div.card');
    chainCard.appendChild(el('h4', { text: 'How you’re linked' }));
    if (!chain) {
      chainCard.appendChild(el('p.muted', { text: 'No route between these two people in the current graph.' }));
    } else {
      chainCard.appendChild(el('p.muted', {
        style: 'margin:0 0 10px;',
        html: `<strong>${chain.length - 2 <= 0 ? 'Direct' : `${chain.length - 2} person(s) in between`}</strong> · ${chain.length - 1} hop(s) · ${mode === 'hops' ? 'fewest people in between' : 'strongest links'}`,
      }));
      chainCard.appendChild(renderChain(chain, idx, ctx));
    }
    out.appendChild(chainCard);

    // (c) Mutual connections — "oh, we both know…"
    const bestA = bestEdges(adj, A), bestB = bestEdges(adj, B);
    const mutual = [...bestA.keys()]
      .filter((id) => id !== B && bestB.has(id))
      .map((id) => ({ id, ea: bestA.get(id), eb: bestB.get(id) }))
      .sort((x, y) => (x.ea.degree + x.eb.degree) - (y.ea.degree + y.eb.degree));

    const mutualCard = el('div.card');
    mutualCard.appendChild(el('h4', { text: `People you both know (${mutual.length})` }));
    if (!mutual.length) {
      mutualCard.appendChild(el('p.muted', { text: 'Nobody in common yet.' }));
    } else {
      const table = el('table.data');
      table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Role', `Link to ${teacherName(idx, A).split(' ')[0]}`, `Link to ${teacherName(idx, B).split(' ')[0]}`, ''].map((h) => el('th', { text: h })))]));
      const tb = el('tbody');
      mutual.slice(0, 100).forEach((m) => {
        const t = idx.teacherById.get(m.id) || {};
        tb.appendChild(el('tr', {}, [
          el('td', { html: `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)}` }),
          el('td', { text: rolesOf(idx, m.id).join(', ') }),
          el('td', { html: `${degPill(m.ea.degree)}<br><small class="muted">${m.ea.label || ''}</small>` }),
          el('td', { html: `${degPill(m.eb.degree)}<br><small class="muted">${m.eb.label || ''}</small>` }),
          el('td', {}, [el('button.btn.ghost', { text: 'connections →', onclick: () => ctx.navigateTo('ego', { teacher: m.id }) })]),
        ]));
      });
      table.appendChild(tb);
      mutualCard.appendChild(table);
    }
    out.appendChild(mutualCard);
  }
  draw();
  return pane;
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
      el('div.meta', { text: rolesOf(idx, step.id).join(', ') }),
    ]);
    node.addEventListener('click', () => ctx.navigateTo('ego', { teacher: step.id }));
    wrap.appendChild(node);
  });
  return wrap;
}

// ── 3. Find people — plain faceted list ─────────────────────────────────────
// Facets are place, curriculum, role category and experience. No subject, no job title:
// see the header note.
function findPeople(ctx) {
  const { data, idx, counts } = ctx;
  const pane = el('div');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const countries = uniq(data.schools.map((s) => s.COUNTRY));
  const cities = uniq(data.schools.map((s) => s.CITY));
  const curricula = uniq(data.schools.map((s) => s.CURRICULUM_TYPE));

  const sel = (label, options) => {
    const s = el('select', {}, [el('option', { value: '', text: `Any ${label}` }), ...options.map((o) => el('option', { value: o, text: o }))]);
    return el('div.control-group', {}, [el('label', { text: label }), s]);
  };
  const fCountry = sel('country', countries), fCity = sel('city', cities),
    fCurr = sel('curriculum', curricula), fRole = sel('role', ROLE_CATEGORIES);
  const minYears = el('input', { type: 'number', min: 0, max: 40, value: 0, style: 'width:64px;' });
  const verifiedOnly = el('input', { type: 'checkbox' });
  const ackAvailable = hasAcknowledged(data);

  const controls = el('div.controls');
  append(controls, fCountry, fCity, fCurr, fRole,
    el('div.control-group', {}, [el('label', { text: 'Min years' }), minYears]),
    ackAvailable ? el('div.control-group', {}, [el('label', {}, [verifiedOnly, ' verified (mutual) only'])]) : null,
    el('button.btn', { text: 'Search', onclick: run }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);
  const val = (group) => group.querySelector('select').value;

  function run() {
    const c = val(fCountry), city = val(fCity), curr = val(fCurr), role = val(fRole);
    const minY = +minYears.value || 0;
    const vOnly = ackAvailable && verifiedOnly.checked;

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
      if (role && !postings.some((p) => roleCategory(p.POSITION_TITLE) === role)) return false;
      return true;
    });

    out.innerHTML = '';
    out.appendChild(el('p.muted', { style: 'margin:8px 2px;', text: `${results.length} person(s)` }));

    const table = el('table.data');
    table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Role', 'Yrs', 'Current school', 'Conns', ''].map((h) => el('th', { text: h })))]));
    const tb = el('tbody');
    results.slice(0, 200).forEach((t) => {
      const ps = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
      const cur = currentPosting(ps);
      const sc = cur ? idx.schoolById.get(cur.SCHOOL_ID) : null;
      tb.appendChild(el('tr', {}, [
        el('td', { html: `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)}` }),
        el('td', { text: rolesOf(idx, t.TEACHER_ID).join(', ') }),
        el('td', { text: String(t.YEARS_EXPERIENCE ?? '') }),
        el('td', { text: sc ? `${sc.SCHOOL_NAME}, ${sc.COUNTRY}` : '—' }),
        el('td', { text: String(counts.get(t.TEACHER_ID) || 0) }),
        el('td', {}, [el('button.btn.ghost', { text: 'connections →', onclick: () => ctx.navigateTo('ego', { teacher: t.TEACHER_ID }) })]),
      ]));
    });
    table.appendChild(tb);
    out.appendChild(table);
  }
  run();
  return pane;
}
