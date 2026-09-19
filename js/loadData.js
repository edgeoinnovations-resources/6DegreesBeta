// loadData.js — THE data layer. Now Supabase.
//
// This file was written from the start as the one place that would change when
// the demo became real: "loadData() is the only thing that changes for Supabase.
// Every view consumes the object it returns; no view talks to the data source
// directly." That is now cashed in — the views are untouched.
//
// The shape returned is deliberately the SAME as the old static file, so the
// eight views keep working:
//   { teachers, schools, assignments, colleagueships }
//
// Two differences that matter:
//   * Only schools someone has actually worked at are returned. The table holds
//     2,130 of them; shipping all of that to draw a map of six people would be
//     absurd, and the picker queries the table directly when you need the rest.
//   * A connection can now have a NULL degree: a mutually approved tag between
//     two people who never shared a place. Views must tolerate that.
import { supabase } from './supabaseClient.js';

let _cache = null;

export function invalidate() { _cache = null; }

// PostgREST answers at most 1,000 rows and says nothing about the rest.
//
// At seven members every table here is tiny, so a plain select was fine and the
// cap was invisible. At the 500 members Paul wants it is not: 3,000 postings,
// ~3,700 connections, ~7,500 shared contexts. Every one of those would have come
// back cut to 1,000 with no error — the app would have drawn a third of the
// network and looked entirely healthy doing it. This is the same cap that made
// Venezuela disappear from the country list in September.
async function page(build) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

// Pairs are stored canonically (profile_a < profile_b), so look them up that way.
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Column names keep the old SHAPE so the eight views need no changes, even
// though the database is snake_case. Both loaders use these, so the partial and
// the full graph can never describe the same person differently.
function toTeacher(p) {
  return {
    TEACHER_ID: p.id,
    FULL_NAME: p.display_name || 'Former member',
    // What to call someone: the name they go by, falling back to their first name.
    FIRST_NAME: p.preferred_name || p.first_name || p.display_name || '',
    LAST_NAME: p.last_name || (p.last_initial ? `${p.last_initial}.` : ''),
    // The formal first name, kept because that is what an old staff list will say.
    GIVEN_NAME: p.first_name || '',
    PREFERRED_NAME: p.preferred_name || '',
    YEARS_EXPERIENCE: 0,
    STATUS: p.status,
    IS_GHOST: p.status === 'ghost',
    EMAIL: '',                        // never fetched, never shown
  };
}

function shapePostings(rows) {
  const schoolById = new Map();
  for (const a of rows) {
    const s = a.schools;
    if (s && !schoolById.has(s.id)) {
      schoolById.set(s.id, {
        SCHOOL_ID: String(s.id), SCHOOL_NAME: s.name,
        CITY: s.city || '', REGION: s.region || '', COUNTRY: s.country,
        LATITUDE: s.latitude, LONGITUDE: s.longitude,
        CITY_INFERRED: s.city_source === 'fallback-largest-city',
        CURRICULUM_TYPE: '', ENROLLMENT_SIZE: null,
      });
    }
  }
  const assignments = rows.map((a) => ({
    ASSIGNMENT_ID: String(a.id), TEACHER_ID: a.profile_id,
    SCHOOL_ID: String(a.school_id), POSITION_TITLE: a.role,
    START_DATE: a.start_date, END_DATE: a.end_date,
    IS_CURRENT_POSITION: a.end_date ? 'No' : 'Yes',
    SALARY_RANGE: '', SUPERVISOR_NAME: '',
  }));
  return { schools: [...schoolById.values()], assignments };
}

// ── Your own neighbourhood, which is all the opening screen needs ───────────
//
// The whole graph used to load before anything rendered. Density is ~56% —
// "we both worked in Spain at some point" connects nearly everyone — so that
// download grows with the square of the membership: 1 MB at 150 members, 35 MB
// at 1,000, 307 MB at 3,000, against a 5 GB monthly egress allowance.
//
// The rings show YOUR connections and the card shows ONE pair. Both are the size
// of your own neighbourhood however large the network gets. One RPC serves both.
let _mine = null;

export async function loadMyGraph() {
  if (_mine) return _mine;

  const { data: { user } } = await supabase.auth.getUser();
  const me = user?.id || null;

  const [connRes, postRes, profRes] = await Promise.all([
    supabase.rpc('my_connections'),
    // Your own history: the map journey and "where they've been" read it.
    supabase.from('postings')
      .select('id, profile_id, school_id, role, start_date, end_date, schools(id,name,city,region,country,latitude,longitude,city_source)')
      .eq('profile_id', me),
    supabase.from('public_profiles').select('*').eq('id', me).maybeSingle(),
  ]);
  for (const r of [connRes, postRes, profRes]) if (r.error) throw r.error;

  const rows = connRes.data || [];

  const teachers = [toTeacher(profRes.data || { id: me })].concat(
    rows.map((r) => toTeacher({
      id: r.other_id, display_name: r.display_name, first_name: r.first_name,
      last_name: r.last_name, preferred_name: r.preferred_name, status: r.status,
    })),
  );

  const colleagueships = rows.map((r, i) => ({
    COLLEAGUESHIP_ID: `M${i}`,
    TEACHER_A_ID: me, TEACHER_B_ID: r.other_id,
    DEGREE: r.degree,
    SHARED_CONTEXT_TYPE: r.context_type || '',
    SHARED_CONTEXT_LABEL: r.context_label || '',
    TIME_RELATION: r.time_relation || '',
    OVERLAP_YEARS: r.overlap_years || '',
    ACKNOWLEDGED: !!r.acknowledged,
    TAG_KEYS: r.tag_keys ? r.tag_keys.split(',') : [],
    VERIFIED: r.acknowledged ? 'mutual' : 'unverified',
  }));

  // Node size and ring grouping come back with the connection rather than being
  // derived from a graph we no longer hold.
  const counts = new Map(rows.map((r) => [r.other_id, Number(r.their_degree_count) || 0]));
  counts.set(me, rows.length);
  const homeCountry = new Map(rows.map((r) => [r.other_id, r.home_country || null]));

  const { schools, assignments } = shapePostings(postRes.data || []);

  _mine = {
    me, teachers, schools, assignments, colleagueships,
    counts, homeCountry,
    sharedByPair: new Map(),
    tags: [],
    partial: true,          // views needing the whole network must say so
    generated_at: new Date().toISOString().slice(0, 10),
  };
  return _mine;
}

export async function loadData() {
  if (_cache) return _cache;

  // Who is asking. shared_contexts is only ever read for pairs involving this
  // person (the person card and the ego rail), so it is fetched that way rather
  // than pulling every pair in the network: at 500 members that is ~20 rows
  // instead of ~7,500.
  const { data: { user } } = await supabase.auth.getUser();
  const me = user?.id || null;

  const [profiles, postings, conns, tags, shared] = await Promise.all([
    page(() => supabase.from('public_profiles').select('*').order('id')),
    page(() => supabase.from('postings')
      .select('id, profile_id, school_id, role, start_date, end_date, schools(id,name,city,region,country,latitude,longitude,city_source)')
      .order('id')),
    page(() => supabase.from('connections').select('*').order('profile_a').order('profile_b')),
    page(() => supabase.from('connection_tags')
      .select('id, requester_id, subject_id, tag_key, status, context, created_at, responded_at')
      .order('id')),
    me
      ? page(() => supabase.from('shared_contexts').select('*')
          .or(`profile_a.eq.${me},profile_b.eq.${me}`).order('degree'))
      : Promise.resolve([]),
  ]);

  const profilesRes = { data: profiles };
  const postingsRes = { data: postings };
  const connRes = { data: conns };
  const tagsRes = { data: tags };
  const sharedRes = { data: shared };

  const teachers = (profilesRes.data || []).map(toTeacher);

  const { schools, assignments } = shapePostings(postingsRes.data || []);

  // years of experience, derived rather than asked for
  const yearsBy = new Map();
  const thisYear = new Date().getFullYear();
  for (const a of assignments) {
    const from = +String(a.START_DATE).slice(0, 4);
    const to = a.END_DATE ? +String(a.END_DATE).slice(0, 4) : thisYear;
    if (Number.isFinite(from)) {
      yearsBy.set(a.TEACHER_ID, (yearsBy.get(a.TEACHER_ID) || 0) + Math.max(0, to - from));
    }
  }
  for (const t of teachers) t.YEARS_EXPERIENCE = yearsBy.get(t.TEACHER_ID) ?? 0;

  // ── connections ───────────────────────────────────────────────────────────
  // degree may be null for a tag-only link: acknowledged, not co-located.
  const colleagueships = (connRes.data || []).map((c, i) => ({
    COLLEAGUESHIP_ID: `C${i}`,
    TEACHER_A_ID: c.profile_a,
    TEACHER_B_ID: c.profile_b,
    DEGREE: c.degree,                        // null === acknowledged only
    SHARED_CONTEXT_TYPE: c.context_type || '',
    SHARED_CONTEXT_LABEL: c.context_label || '',
    TIME_RELATION: c.time_relation || '',
    OVERLAP_YEARS: c.overlap_years || '',
    ACKNOWLEDGED: !!c.acknowledged,
    TAG_KEYS: c.tag_keys ? c.tag_keys.split(',') : [],
    VERIFIED: c.acknowledged ? 'mutual' : 'unverified',
  }));

  // ── every shared context, keyed by pair ───────────────────────────────────
  // Dave, 13 Sep 2026: "Linda is only listed as a Degree 1 connection, even though
  // we are technically also Degree 2 and Degree 4 connections as well." The
  // headline degree still places someone on a ring; this is what the person card
  // lists underneath it. Only pairs involving the signed-in member are fetched,
  // which is all any screen asks for.
  const sharedByPair = new Map();
  for (const r of sharedRes.data || []) {
    const key = pairKey(r.profile_a, r.profile_b);
    if (!sharedByPair.has(key)) sharedByPair.set(key, []);
    sharedByPair.get(key).push({
      DEGREE: r.degree,
      SHARED_CONTEXT_TYPE: r.context_type,
      SHARED_CONTEXT_LABEL: r.context_label,
      TIME_RELATION: r.time_relation,
      OVERLAP_YEARS: r.overlap_years || '',
    });
  }
  for (const list of sharedByPair.values()) {
    list.sort((a, b) => a.DEGREE - b.DEGREE
      || a.SHARED_CONTEXT_LABEL.localeCompare(b.SHARED_CONTEXT_LABEL));
  }

  _cache = {
    teachers,
    schools,
    assignments,
    colleagueships,
    sharedByPair,
    tags: tagsRes.data || [],
    generated_at: new Date().toISOString().slice(0, 10),
  };
  return _cache;
}
