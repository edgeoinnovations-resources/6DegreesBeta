# 6 Degrees

A **buildless static web app** — a professional networking map for international school
teachers. People are connected by **relationship degrees 1–6** based purely on shared
**location and time**. Everything is read-only, runs entirely in the browser, and deploys
to **GitHub Pages with no build step** so non-developers can edit it.

**Live:** https://edgeoinnovations-resources.github.io/6DegreesBeta/

> All data is fictional (`@6degrees.demo` emails, jittered coordinates) — safe to host publicly.

---

## Two terms — kept distinct everywhere

| Term | Meaning | Source |
|------|---------|--------|
| **Relationship degree (1–6)** | Co-location strength on a single pair. 1 = same school same time … 6 = same country different time. | Precomputed in `colleagueships` |
| **Separation (hop count)** | Fewest hops between two people through the connection graph — the classic "six degrees of separation". | Computed with **BFS** in `js/degrees.js` |

For this dataset the community is one connected component with an **average separation of
~1.6 hops** and a **diameter of 3** (shown on the Insights tab).

## The eight views (left-nav tabs)

1. **Ego graph** — concentric rings around one teacher (default `T001`, Sarah Mitchell), one clean example of every degree 1–6. Click any node to re-center; search-as-you-type to pick anyone.
2. **Force network** — the whole community; edges colored by degree, **degree 1–6 filter checkboxes**, node-size + color-by-region toggles, drag/zoom, click → postings panel.
3. **Matrix** — school × school heatmap, cell = teachers shared between two schools, ordered by country cluster.
4. **Chord** — country↔country (toggle school↔school) migration flows from consecutive postings.
5. **Map** — MapLibre keyless basemap: school points sized by headcount with clickable rosters, deck.gl migration **arcs**, **3D headcount columns**, a **globe** toggle, and a **"fly the journey"** camera animation.
6. **Timeline (Gantt)** — one row per teacher; a **year slider** scrubs a now-line and the same-time co-location between two compared teachers is highlighted (a degree forming). Defaults to `T001` vs `T002` (same-school overlap).
7. **Insights** — the average-separation headline, degree distribution, tenure by region, curriculum mix, most-connected schools, top corridors, cumulative growth.
8. **Search & pathfinder** — faceted search, a **pathfinder** (`T001 → T010` demo chain), "who do I know at School X", a reverse-recruiting query builder, and a commented natural-language-search stub.

### About the pathfinder default (`T001 → T010`)

The demo guide tells the warm-intro story `T001 → T008 → T009 → T010` (three clean
degree-1 hops). That is the **Featured demo chain** the pathfinder shows by default. Note
that the live graph also contains **shorter 2-hop routes** between the same two people — the
pathfinder's **"Fewest hops (BFS)"** and **"Strongest links"** modes surface those. The
featured chain is curated for the narrative; the other modes are honest graph search.

## Architecture

```
index.html              shell: brand header + left tab nav + view container
.nojekyll               serve files/folders verbatim on Pages
/data/                  demo_data.json + four CSVs + DEMO_GUIDE.md
/css/styles.css
/js/loadData.js         THE swappable data layer (Supabase later — see below)
/js/degrees.js          degree vocab+colors, adjacency, BFS + strength pathfinder, separation, migration
/js/widgets.js          tiny DOM helper + teacher search-as-you-type
/js/app.js              loads data ONCE, builds the tab router, mounts the active view
/js/views/*.js          one module per view (egoGraph, network, matrix, chord, map, timeline, insights, search)
/tools/build_static_maps.py   optional Python (folium) static map export
/maps/                  committed static HTML output of the script above
```

**`loadData()` is the only thing that changes for Supabase.** Every view consumes the
object it returns; no view talks to the data source directly. Today it `fetch()`es
`./data/demo_data.json`; later, swap the body for `supabase.from(...).select(...)` calls
that return the same `{ teachers, schools, assignments, colleagueships }` shape.

Libraries are loaded from CDN (D3 v7, MapLibre GL v5, deck.gl v9) — **no bundler, no
`node_modules`, ES modules with relative paths only** (the site lives at a subpath).

## Run locally

It must be served over HTTP (ES modules + `fetch` won't run from `file://`):

```bash
cd "6 Degrees"
python3 -m http.server 8000
# open http://localhost:8000/
```

## Optional: regenerate the static Python maps

```bash
cd tools
python3 -m pip install folium pandas
python3 build_static_maps.py      # writes ../maps/*.html
```

These are committed and viewable on Pages at `…/6DegreesBeta/maps/`.

## GitHub Pages configuration

- Deployed from branch **`main`**, folder **`/` (root)**.
- A root **`.nojekyll`** file is present so Pages serves every file/folder verbatim
  (no Jekyll processing of `js/`, `data/`, etc.).
- No build step, no Actions required — Pages serves the static files directly.

To (re)enable: **Settings → Pages → Build and deployment → Deploy from a branch →
`main` / `/ (root)`**.

## Privacy / data notes

- `SALARY_RANGE` and `SUPERVISOR_NAME` exist in the schema for parity but are intentionally
  **blank and never displayed** (salary capture dropped; no naming of non-consenting parties).
- No credentials are committed anywhere in this repository.
