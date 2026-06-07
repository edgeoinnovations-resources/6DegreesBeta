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

// ── Region grouping (coarse, for color-by-region modes) ─────────────────────
const REGION_BY_COUNTRY = {
  'United Arab Emirates': 'Middle East', 'Qatar': 'Middle East', 'Saudi Arabia': 'Middle East',
  'Kuwait': 'Middle East', 'Oman': 'Middle East', 'Jordan': 'Middle East', 'Egypt': 'Middle East',
  'Singapore': 'Asia', 'Thailand': 'Asia', 'China': 'Asia', 'Hong Kong': 'Asia', 'Japan': 'Asia',
  'South Korea': 'Asia', 'Malaysia': 'Asia', 'India': 'Asia', 'Vietnam': 'Asia', 'Indonesia': 'Asia',
  'United Kingdom': 'Europe', 'Germany': 'Europe', 'France': 'Europe', 'Switzerland': 'Europe',
  'Netherlands': 'Europe', 'Spain': 'Europe', 'Italy': 'Europe',
  'United States': 'Americas', 'Canada': 'Americas', 'Brazil': 'Americas', 'Mexico': 'Americas',
  'Argentina': 'Americas', 'Chile': 'Americas', 'Colombia': 'Americas',
  'Nigeria': 'Africa', 'Kenya': 'Africa', 'South Africa': 'Africa', 'Ghana': 'Africa',
  'Morocco': 'Africa', 'Tanzania': 'Africa', 'Ethiopia': 'Africa',
  'Australia': 'Oceania', 'New Zealand': 'Oceania',
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
