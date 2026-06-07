# 6 Degrees — Mock Data Demo Guide

Generated 2026-06-07. All data is fictional. Emails use the `@6degrees.demo` domain and
coordinates are jittered around real city centers — safe to host on a public GitHub Pages repo.

## What's in the box

| File | Rows | Purpose |
|------|------|---------|
| `Teachers.csv` | 150 | People — matches your existing Teachers schema (14 cols) |
| `Schools.csv` | 39 | International schools across 26 cities / 18 countries (17 cols) |
| `Teaching_Assignments.csv` | 416 | Postings — matches your schema (16 cols) |
| `Colleagueships.csv` | 4,774 | Pre-computed connections, strongest degree per pair |
| `demo_data.json` | — | All four tables bundled for a single client-side `fetch()` |

The CSVs load straight into the Supabase tables later; the JSON is what the GitHub Pages demo
reads now via your `loadData()` shim. Same data, two delivery paths.

## Degree spread (strongest link per pair)

| Degree | Meaning | Count |
|--------|---------|-------|
| 1 | same school, same time | 909 |
| 2 | same school, different time | 1,142 |
| 3 | same city, different school, same time | 691 |
| 4 | same city, different school, different time | 667 |
| 5 | same country, different city, same time | 681 |
| 6 | same country, different city, different time | 684 |

## The hero and the six clean examples

`T001 — Sarah Mitchell` (Physics; Bangkok 2011–15 → Dubai 2015–19 → Singapore 2019–present)
is the demo ego. She has one deliberately clean example of every degree — point at these
when showing the concentric-ring ego graph:

| Degree | Teacher | Why |
|--------|---------|-----|
| 1 | `T002` James Thompson | American School of Dubai, overlaps 2017–2019 |
| 2 | `T003` Emily Davies | American School of Dubai, but 2010–2014 (no overlap) |
| 3 | `T004` Michael Patel | GEMS World Academy Dubai (same city, diff school), overlaps |
| 4 | `T005` Olivia Greene | Dubai International Academy, 2011–2014 (same city, no overlap) |
| 5 | `T006` David Hassan | Abu Dhabi (same country, diff city), overlaps |
| 6 | `T007` Hannah Eriksson | Abu Dhabi, 2009–2012 (same country, no overlap) |

These seven links are flagged `verified = mutual`, so they show the verification badge.

## The pathfinder chain

A clean 3-hop path for the "how are we linked?" feature. `T001` and `T010` share **no**
direct degree, but a path exists:

```
T001 Sarah Mitchell
  └─ (1st, Singapore American School) ─ T008 Grace Okafor
       └─ (1st, Graded São Paulo) ─ T009 Carlos Fernandez
            └─ (1st, AIS Lagos) ─ T010 Imani Mbeki
```

Use this to demo bridges, warm-intro-through-the-bridge, and re-centering.

## Notes that honor the decisions you made

- `SALARY_RANGE` is present (schema parity) but **blank** — salary capture was dropped.
- `SUPERVISOR_NAME` is present but **blank** — no naming of non-consenting third parties.
- Dates are year-anchored (Aug start / Jun end); overlap is computed on calendar-year ranges.
- "Current" postings have an empty `END_DATE` and `IS_CURRENT_POSITION = Yes`.

## Loading

```js
// loadData.js — the one function that changes when you move to Supabase
export async function loadData() {
  const res = await fetch('./demo_data.json');   // GitHub Pages: static file
  return res.json();
  // Later (Supabase): const { data } = await supabase.from('colleagueships').select('*'); ...
}
```

Every visualization reads from the object this returns — swap the body, nothing else moves.
