// degrees.js — shared analytics & vocabulary for the whole app.
//
// TWO terms, never conflated:
//   • Relationship DEGREE (1–6): co-location strength on a single pair, precomputed
//     in colleagueships. 1 = same school same time … 6 = same country different time.
//   • SEPARATION (hop count): fewest hops between two people through the colleagueship
//     graph (the classic "six degrees of separation"), computed here with BFS.

// ── Degree vocabulary ───────────────────────────────────────────────────────
// One 6-step sequential turquoise scale: degree 1 most saturated → degree 6 faintest.
export const DEGREE_META = {
  1: { label: 'Same school, same time',        short: 'Same school · same time',     color: '#0b6b78' },
  2: { label: 'Same school, different time',   short: 'Same school · diff time',     color: '#17A2B8' },
  3: { label: 'Same city, same time',          short: 'Same city · same time',       color: '#5cbecd' },
  4: { label: 'Same city, different time',     short: 'Same city · diff time',       color: '#93d6e1' },
  5: { label: 'Same country, same time',       short: 'Same country · same time',    color: '#bfe6ed' },
  6: { label: 'Same country, different time',  short: 'Same country · diff time',    color: '#e2f3f7' },
};
export const DEGREES = [1, 2, 3, 4, 5, 6];
export const ACCENT = '#FF6B35';       // focused/selected node + verified=mutual badge
export const PRIMARY = '#17A2B8';

export const degreeColor = (d) => (DEGREE_META[d] || {}).color || '#cccccc';
export const degreeLabel = (d) => (DEGREE_META[d] || {}).label || `Degree ${d}`;
export const degreeShort = (d) => (DEGREE_META[d] || {}).short || `Degree ${d}`;

// ── Role categories ────────────────────────────────────────────────────────
// Linda (7 Jun 2026): "we talked about NOT having teaching assignment, because that gets
// tricky - hard to list them all, so many people cross divisions or change jobs, etc.
// I think it would be helpful to have basics - student, faculty, staff, administrator."
//
// So specific job titles, subjects-taught, grade levels and departments are no longer
// surfaced anywhere in the UI. Each posting is bucketed into one of these four instead.
// 'Student' exists for the TCK case Linda raised (someone who attended an international
// school and later taught in one); no demo record uses it yet.
export const ROLE_CATEGORIES = ['Student', 'Faculty', 'Staff', 'Administrator'];

const ROLE_BY_TITLE = {
  'Student': 'Student',
  'Teacher': 'Faculty', 'Senior Teacher': 'Faculty', 'Head of Department': 'Faculty',
  'Subject Coordinator': 'Faculty', 'PYP Coordinator': 'Faculty', 'MYP Coordinator': 'Faculty',
  'IB DP Coordinator': 'Faculty', 'Curriculum Coordinator': 'Faculty', 'Teaching Assistant': 'Faculty',
  'Counselor': 'Staff', 'Librarian': 'Staff', 'Athletic Director': 'Staff',
  'Dean of Students': 'Administrator', 'Deputy Head': 'Administrator', 'Principal': 'Administrator',
  'Vice Principal': 'Administrator', 'Head of School': 'Administrator',
};

// A posting's role category. Unknown titles fall back to Faculty, which is the safe
// default for this community (and is what ~80% of records are).
export const roleCategory = (positionTitle) => ROLE_BY_TITLE[positionTitle] || 'Faculty';

// The role categories a teacher has held, in the canonical order above.
export function rolesOf(idx, teacherId) {
  const seen = new Set((idx.postingsByTeacher.get(teacherId) || []).map((p) => roleCategory(p.POSITION_TITLE)));
  return ROLE_CATEGORIES.filter((r) => seen.has(r));
}

// ── Region grouping (coarse, for color-by-region modes) ─────────────────────
const REGION_BY_COUNTRY = {
  // Covers every country in data/demo_data.json (126 of them, from the ISR school
  // list). Generated from GeoNames continent codes, with the Middle East split out
  // by hand because the app treats it as its own region -- and Egypt counts as
  // Middle East here, which is the convention the first version already used.
  // Middle East
  'Egypt': 'Middle East', 'Iran': 'Middle East', 'Iraq': 'Middle East', 'Israel': 'Middle East',
  'Jordan': 'Middle East', 'Kuwait': 'Middle East', 'Lebanon': 'Middle East',
  'Oman': 'Middle East', 'Palestine': 'Middle East', 'Qatar': 'Middle East',
  'Saudi Arabia': 'Middle East', 'Syria': 'Middle East', 'United Arab Emirates': 'Middle East',
  'Yemen': 'Middle East',
  // Asia
  'Afghanistan': 'Asia', 'Armenia': 'Asia', 'Azerbaijan': 'Asia', 'Bangladesh': 'Asia',
  'Cambodia': 'Asia', 'China': 'Asia', 'Georgia': 'Asia', 'Hong Kong': 'Asia', 'India': 'Asia',
  'Indonesia': 'Asia', 'Japan': 'Asia', 'Kazakhstan': 'Asia', 'Kyrgyzstan': 'Asia', 'Laos': 'Asia',
  'Macau': 'Asia', 'Malaysia': 'Asia', 'Myanmar': 'Asia', 'Nepal': 'Asia', 'Pakistan': 'Asia',
  'Philippines': 'Asia', 'Singapore': 'Asia', 'Sri Lanka': 'Asia', 'Taiwan': 'Asia',
  'Thailand': 'Asia', 'Turkmenistan': 'Asia', 'Uzbekistan': 'Asia', 'Vietnam': 'Asia',
  // Europe
  'Albania': 'Europe', 'Austria': 'Europe', 'Belarus': 'Europe', 'Belgium': 'Europe',
  'Bulgaria': 'Europe', 'Croatia': 'Europe', 'Cyprus': 'Europe', 'Czech Republic': 'Europe',
  'Denmark': 'Europe', 'Estonia': 'Europe', 'Finland': 'Europe', 'France': 'Europe',
  'Germany': 'Europe', 'Greece': 'Europe', 'Hungary': 'Europe', 'Italy': 'Europe',
  'Latvia': 'Europe', 'Lithuania': 'Europe', 'Luxembourg': 'Europe', 'Moldova': 'Europe',
  'Monaco': 'Europe', 'Netherlands': 'Europe', 'Norway': 'Europe', 'Poland': 'Europe',
  'Portugal': 'Europe', 'Romania': 'Europe', 'Russia': 'Europe', 'Serbia': 'Europe',
  'Slovakia': 'Europe', 'Slovenia': 'Europe', 'Spain': 'Europe', 'Sweden': 'Europe',
  'Switzerland': 'Europe', 'Ukraine': 'Europe',
  // Americas
  'Argentina': 'Americas', 'Bahamas': 'Americas', 'Bolivia': 'Americas', 'Brazil': 'Americas',
  'Chile': 'Americas', 'Colombia': 'Americas', 'Cuba': 'Americas',
  'Dominican Republic': 'Americas', 'Ecuador': 'Americas', 'Guyana': 'Americas',
  'Honduras': 'Americas', 'Jamaica': 'Americas', 'Mexico': 'Americas', 'Panama': 'Americas',
  'Paraguay': 'Americas', 'Peru': 'Americas', 'United States': 'Americas', 'Venezuela': 'Americas',
  // Africa
  'Algeria': 'Africa', 'Angola': 'Africa', 'Burkina Faso': 'Africa', 'Cameroon': 'Africa',
  'Eritrea': 'Africa', 'Ethiopia': 'Africa', 'Gabon': 'Africa', 'Kenya': 'Africa',
  'Liberia': 'Africa', 'Libya': 'Africa', 'Madagascar': 'Africa', 'Malawi': 'Africa',
  'Mali': 'Africa', 'Mauritania': 'Africa', 'Morocco': 'Africa', 'Namibia': 'Africa',
  'Niger': 'Africa', 'Nigeria': 'Africa', 'Rwanda': 'Africa', 'Senegal': 'Africa',
  'South Africa': 'Africa', 'Sudan': 'Africa', 'Tanzania': 'Africa', 'Togo': 'Africa',
  'Tunisia': 'Africa', 'Uganda': 'Africa', 'Zambia': 'Africa', 'Zimbabwe': 'Africa',
  // Oceania
  'Australia': 'Oceania', 'East Timor': 'Oceania', 'Marshall Islands': 'Oceania',
  'Northern Mariana Islands': 'Oceania', 'Papua New Guinea': 'Oceania',
};
export const regionOf = (country) => REGION_BY_COUNTRY[country] || 'Other';
export const REGION_COLORS = {
  'Middle East': '#FF6B35', 'Asia': '#17A2B8', 'Europe': '#6f5cc4',
  'Americas': '#2ca02c', 'Africa': '#e6a817', 'Oceania': '#d6457f', 'Other': '#888888',
};
export const regionColor = (country) => REGION_COLORS[regionOf(country)] || '#888888';

// ── Indexes ─────────────────────────────────────────────────────────────────
export function buildIndexes(data) {
  const teacherById = new Map(data.teachers.map((t) => [t.TEACHER_ID, t]));
  const schoolById = new Map(data.schools.map((s) => [s.SCHOOL_ID, s]));

  // Postings per teacher, sorted chronologically by START_DATE.
  const postingsByTeacher = new Map();
  for (const a of data.assignments) {
    if (!postingsByTeacher.has(a.TEACHER_ID)) postingsByTeacher.set(a.TEACHER_ID, []);
    postingsByTeacher.get(a.TEACHER_ID).push(a);
  }
  for (const list of postingsByTeacher.values()) {
    list.sort((x, y) => String(x.START_DATE).localeCompare(String(y.START_DATE)));
  }

  // Teachers who passed through each school (any time).
  const teachersBySchool = new Map();
  for (const a of data.assignments) {
    if (!teachersBySchool.has(a.SCHOOL_ID)) teachersBySchool.set(a.SCHOOL_ID, new Set());
    teachersBySchool.get(a.SCHOOL_ID).add(a.TEACHER_ID);
  }

  return { teacherById, schoolById, postingsByTeacher, teachersBySchool };
}

export const teacherName = (idx, id) => (idx.teacherById.get(id) || {}).FULL_NAME || id;

// The six of us are seeded into the demo graph with INFERRED schools and years
// (see data/beta_group.json). Anything not yet corrected by its owner is marked in the
// UI so nobody mistakes a placeholder for their real history.
// Whether the dataset carries any acknowledged ("mutual") link at all.
//
// The first demo's VERIFIED column was random noise -- almost exactly 18% "mutual" at
// every single degree -- which made the mutual badge and the "verified only" filter
// look meaningful while carrying no signal. The generator no longer invents it, because
// whether two people acknowledge each other is not something it can know. So the UI asks
// this question and hides those controls entirely rather than offering a filter that
// matches nothing. When a real acknowledgement layer lands, they light up on their own.
export const hasAcknowledged = (data) =>
  (data.colleagueships || []).some((c) => c.VERIFIED === 'mutual');

export const needsConfirming = (t) => !!(t && t.IS_BETA_GROUP && !t.DETAILS_CONFIRMED);
export const CONFIRM_HINT = 'Seeded from the group chat — schools and years are guesses, not your real history. Tell Paul the right ones.';
export const confirmBadge = (t) => (needsConfirming(t)
  ? ` <span class="badge-unconfirmed" title="${CONFIRM_HINT}">details to confirm</span>`
  : '');

// ── Where someone is now ────────────────────────────────────────────────────
// The posting someone currently holds, or their most recent one.
//
// Dee, 14 Sep 2026: "@Sarah — says you are currently at Almaty and not ICS."
// Sarah had entered Almaty first and Sarah blamed herself ("Probably user error").
// It was not: the old rule took the FIRST posting in array order with no end date,
// so the order rows came back in decided where someone worked. Dates decide now:
//   * if any posting is open-ended, the one that started most recently;
//   * otherwise the one that ended most recently.
// Dates are ISO (YYYY-MM-DD), so string comparison is date comparison.
export function currentPosting(postings) {
  if (!postings || !postings.length) return null;
  const open = postings.filter((p) => !p.END_DATE);
  const pool = open.length ? open : postings;
  const key = (p) => String((open.length ? p.START_DATE : p.END_DATE) || p.START_DATE || '');
  return pool.reduce((best, p) => (key(p) > key(best) ? p : best));
}

// ── Adjacency & connection counts ───────────────────────────────────────────
// adjacency: Map<teacherId, Array<{ other, degree, type, label, time, overlap, verified }>>
export function buildAdjacency(colleagueships) {
  const adj = new Map();
  const add = (a, b, rec) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(rec);
  };
  for (const c of colleagueships) {
    const base = {
      degree: c.DEGREE,
      type: c.SHARED_CONTEXT_TYPE,
      contextId: c.SHARED_CONTEXT_ID,
      label: c.SHARED_CONTEXT_LABEL,
      time: c.TIME_RELATION,
      overlap: c.OVERLAP_YEARS,
      verified: c.VERIFIED,
      // Both people confirmed they know each other. It sits ALONGSIDE the degree
      // and never alters it — degrees come from place and time alone.
      acknowledged: !!c.ACKNOWLEDGED,
      tagKeys: c.TAG_KEYS || [],
    };
    add(c.TEACHER_A_ID, c.TEACHER_B_ID, { other: c.TEACHER_B_ID, ...base });
    add(c.TEACHER_B_ID, c.TEACHER_A_ID, { other: c.TEACHER_A_ID, ...base });
  }
  return adj;
}

export function connectionCounts(adj) {
  const counts = new Map();
  for (const [id, edges] of adj) counts.set(id, edges.length);
  return counts;
}

// ── Pathfinding ─────────────────────────────────────────────────────────────
// Fewest-hops shortest path (literal "degrees of separation"). Returns
// [{ id }, { id, edge }, …] or null if unreachable.
export function bfsPath(adj, a, b) {
  if (a === b) return [{ id: a }];
  const prev = new Map([[a, null]]);
  const prevEdge = new Map();
  const q = [a];
  while (q.length) {
    const cur = q.shift();
    for (const e of adj.get(cur) || []) {
      if (prev.has(e.other)) continue;
      prev.set(e.other, cur);
      prevEdge.set(e.other, e);
      if (e.other === b) return reconstruct(prev, prevEdge, a, b);
      q.push(e.other);
    }
  }
  return null;
}

// Strength-weighted shortest path (Dijkstra minimizing summed relationship degree).
// Prefers chains of STRONG colleagueships (degree 1 cheapest) over merely-fewer hops.
// This is the demo default — it returns the documented all-degree-1 anchor chain.
export function strengthPath(adj, a, b) {
  if (a === b) return [{ id: a }];
  const dist = new Map([[a, 0]]);
  const prev = new Map([[a, null]]);
  const prevEdge = new Map();
  const visited = new Set();
  while (true) {
    // Pop the unvisited node with the smallest distance (small graph → linear scan is fine).
    let cur = null, best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) { best = d; cur = id; }
    }
    if (cur === null) break;
    if (cur === b) return reconstruct(prev, prevEdge, a, b);
    visited.add(cur);
    for (const e of adj.get(cur) || []) {
      if (visited.has(e.other)) continue;
      const nd = best + e.degree; // cost = relationship degree (1 strongest … 6 weakest)
      if (nd < (dist.get(e.other) ?? Infinity)) {
        dist.set(e.other, nd);
        prev.set(e.other, cur);
        prevEdge.set(e.other, e);
      }
    }
  }
  return null;
}

function reconstruct(prev, prevEdge, a, b) {
  const chain = [];
  let node = b;
  while (node !== null && node !== undefined) {
    chain.unshift({ id: node, edge: prevEdge.get(node) || null });
    node = prev.get(node);
  }
  return chain[0] && chain[0].id === a ? chain : null;
}

// ── Aggregate separation metrics (pure BFS hop count) ───────────────────────
// Returns { avgSeparation, diameter, reachablePairs, components }.
// BFS from every node; average and max over all reachable ordered-once pairs.
export function separationStats(adj) {
  const nodes = [...adj.keys()];
  let totalHops = 0, pairCount = 0, diameter = 0;
  const seenGlobal = new Set();
  let components = 0;

  for (const src of nodes) {
    // single-source BFS distances
    const dist = new Map([[src, 0]]);
    const q = [src];
    while (q.length) {
      const cur = q.shift();
      const d = dist.get(cur);
      for (const e of adj.get(cur) || []) {
        if (!dist.has(e.other)) { dist.set(e.other, d + 1); q.push(e.other); }
      }
    }
    for (const [other, d] of dist) {
      if (other === src || d === 0) continue;
      // Count each unordered pair once by id ordering.
      if (src < other) { totalHops += d; pairCount += 1; if (d > diameter) diameter = d; }
    }
  }

  // connected components via union of BFS reach
  for (const src of nodes) {
    if (seenGlobal.has(src)) continue;
    components += 1;
    const q = [src]; seenGlobal.add(src);
    while (q.length) {
      const cur = q.shift();
      for (const e of adj.get(cur) || []) {
        if (!seenGlobal.has(e.other)) { seenGlobal.add(e.other); q.push(e.other); }
      }
    }
  }

  return {
    avgSeparation: pairCount ? totalHops / pairCount : 0,
    diameter,
    reachablePairs: pairCount,
    components,
    nodeCount: nodes.length,
  };
}

// ── Migration moves (consecutive postings crossing a context boundary) ──────
// Returns [{ teacherId, from:{schoolId,country,city,...}, to:{...}, year }] for every
// posting N → N+1 where the boundary (country by default) changes.
export function migrationMoves(data, idx, boundary = 'COUNTRY') {
  const moves = [];
  for (const [tid, postings] of idx.postingsByTeacher) {
    for (let i = 0; i < postings.length - 1; i++) {
      const sA = idx.schoolById.get(postings[i].SCHOOL_ID);
      const sB = idx.schoolById.get(postings[i + 1].SCHOOL_ID);
      if (!sA || !sB) continue;
      if (sA[boundary] === sB[boundary]) continue; // no boundary crossing
      moves.push({
        teacherId: tid,
        from: sA,
        to: sB,
        year: parseYear(postings[i + 1].START_DATE),
      });
    }
  }
  return moves;
}

export const parseYear = (dateStr) => {
  if (!dateStr) return null;
  const y = parseInt(String(dateStr).slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
};

// Year span of a posting; END_DATE empty → still current (use clampNow).
export function postingYears(a, clampNow) {
  const start = parseYear(a.START_DATE);
  let end = parseYear(a.END_DATE);
  if (end == null) end = clampNow; // current posting
  return { start, end };
}
