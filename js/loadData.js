// loadData.js — THE swappable data layer.
//
// This is the ONLY file that changes when the demo moves to Supabase.
// Every view consumes the object returned here; no view fetches data directly.
//
// The returned shape is:
//   {
//     teachers:       [ { TEACHER_ID, FULL_NAME, NATIONALITY, SPECIALIZATION, ... } ],
//     schools:        [ { SCHOOL_ID, SCHOOL_NAME, CITY, COUNTRY, LATITUDE, LONGITUDE, ... } ],
//     assignments:    [ { ASSIGNMENT_ID, TEACHER_ID, SCHOOL_ID, START_DATE, END_DATE, ... } ],
//     colleagueships: [ { TEACHER_A_ID, TEACHER_B_ID, DEGREE, SHARED_CONTEXT_*, VERIFIED, ... } ],
//   }

let _cache = null;

export async function loadData() {
  if (_cache) return _cache;

  // GitHub Pages: a static file served verbatim. Relative path — the site lives at a subpath.
  const res = await fetch('./data/demo_data.json');
  if (!res.ok) throw new Error(`Failed to load demo_data.json: ${res.status}`);
  const raw = await res.json();

  _cache = {
    teachers: raw.teachers || [],
    schools: raw.schools || [],
    assignments: raw.assignments || [],
    colleagueships: raw.colleagueships || [],
    generated_at: raw.generated_at,
  };
  return _cache;

  // ──────────────────────────────────────────────────────────────────────────
  // Future (Supabase) — replace the body above with something like:
  //
  //   import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  //   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // anon key only — RLS enforced
  //   const [teachers, schools, assignments, colleagueships] = await Promise.all([
  //     supabase.from('teachers').select('*'),
  //     supabase.from('schools').select('*'),
  //     supabase.from('teaching_assignments').select('*'),
  //     supabase.from('colleagueships').select('*'),
  //   ]);
  //   return { teachers: teachers.data, schools: schools.data,
  //            assignments: assignments.data, colleagueships: colleagueships.data };
  //
  // Return the SAME shape and nothing else in the app moves.
  // ──────────────────────────────────────────────────────────────────────────
}
