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

// Pairs are stored canonically (profile_a < profile_b), so look them up that way.
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function loadData() {
  if (_cache) return _cache;

  const [profilesRes, postingsRes, connRes, tagsRes, sharedRes] = await Promise.all([
    supabase.from('public_profiles').select('*'),
    supabase.from('postings')
      .select('id, profile_id, school_id, role, start_date, end_date, schools(id,name,city,country,latitude,longitude,city_source)'),
    supabase.from('connections').select('*'),
    supabase.from('connection_tags')
      .select('id, requester_id, subject_id, tag_key, status, context, created_at, responded_at'),
    // Every way each pair is connected, not just the strongest. This is the table
    // that grows fastest — pairs × contexts — so it will be the first to meet
    // PostgREST's 1,000-row default cap. At seven members it is a few dozen rows;
    // paginate this one first when the group grows.
    supabase.from('shared_contexts').select('*'),
  ]);

  for (const r of [profilesRes, postingsRes, connRes, tagsRes, sharedRes]) {
    if (r.error) throw r.error;   // keep code/details intact for friendlyDbError
  }

  // ── teachers ──────────────────────────────────────────────────────────────
  // Column names stay in the old SHAPE so the views need no changes, even
  // though the database is snake_case.
  const teachers = (profilesRes.data || []).map((p) => ({
    TEACHER_ID: p.id,
    FULL_NAME: p.display_name || 'Former member',
    // What to call someone: the name they go by, falling back to their first name.
    FIRST_NAME: p.preferred_name || p.first_name || p.display_name || '',
    LAST_NAME: p.last_name || (p.last_initial ? `${p.last_initial}.` : ''),
    // The formal first name, kept because that is what an old staff list will say.
    // Only shown where it differs from what they go by.
    GIVEN_NAME: p.first_name || '',
    PREFERRED_NAME: p.preferred_name || '',
    YEARS_EXPERIENCE: null,          // derived below from postings
    STATUS: p.status,
    IS_GHOST: p.status === 'ghost',
    EMAIL: '',                        // never fetched, never shown
  }));

  // ── schools actually in use ───────────────────────────────────────────────
  const schoolById = new Map();
  for (const a of postingsRes.data || []) {
    const s = a.schools;
    if (s && !schoolById.has(s.id)) {
      schoolById.set(s.id, {
        SCHOOL_ID: String(s.id),
        SCHOOL_NAME: s.name,
        CITY: s.city || '',
        COUNTRY: s.country,
        LATITUDE: s.latitude,
        LONGITUDE: s.longitude,
        CITY_INFERRED: s.city_source === 'fallback-largest-city',
        CURRICULUM_TYPE: '',
        ENROLLMENT_SIZE: null,
      });
    }
  }

  // ── assignments ───────────────────────────────────────────────────────────
  const assignments = (postingsRes.data || []).map((a) => ({
    ASSIGNMENT_ID: String(a.id),
    TEACHER_ID: a.profile_id,
    SCHOOL_ID: String(a.school_id),
    POSITION_TITLE: a.role,          // already one of the four role categories
    START_DATE: a.start_date,
    END_DATE: a.end_date,
    IS_CURRENT_POSITION: a.end_date ? 'No' : 'Yes',
    SALARY_RANGE: '',
    SUPERVISOR_NAME: '',
  }));

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
  // lists underneath it.
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
    schools: [...schoolById.values()],
    assignments,
    colleagueships,
    sharedByPair,
    tags: tagsRes.data || [],
    generated_at: new Date().toISOString().slice(0, 10),
  };
  return _cache;
}
