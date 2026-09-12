# 6 Degrees

A **buildless static web app** — a professional networking map for international school
teachers. People are connected by **relationship degrees 1–6** based purely on shared
**location and time**. Everything is read-only, runs entirely in the browser, and deploys
with no build step so non-developers can edit it.

> All fictional teachers use `@6degrees.demo` emails and jittered coordinates. The six
> real beta-group members are seeded with **first name + last initial only and no email
> address at all** — see [The beta group](#the-beta-group-in-the-demo-graph).

---

## Two terms — kept distinct everywhere

| Term | Meaning | Source |
|------|---------|--------|
| **Relationship degree (1–6)** | Co-location strength on a single pair. 1 = same school same time … 6 = same country different time. | Precomputed in `colleagueships` |
| **Separation (hop count)** | Fewest hops between two people through the connection graph — the classic "six degrees of separation". | Computed with **BFS** in `js/degrees.js` |

### ⚠ A structural caveat worth knowing before building more on top of this

The degree scale is a **strength label, not a filter on who you know**, and treating every
degree as a "connection" makes the graph almost complete:

- **42.7%** of all possible pairs have a direct edge.
- At degree ≤ 6 the median person is directly linked to **66 of the other 155 people**.
- Degrees 5 and 6 — "same country, same/different time" — are **28.6%** of all edges. They
  mean no more than *"we were both in Thailand at some point."*
- Consequently average separation is **~1.6 hops** with a **diameter of 3**. There is no
  such thing as six degrees of separation inside a graph this dense.

The unbuilt piece that fixes this is the one the team already designed and never
implemented — Dave, 13 Sep 2025: *"Checkmark 'I know this person' (default setting 'I
don't know this person')"*, and the June meeting's conclusion that it *"should be shared
by both parties"*. Co-location is **evidence that two people may have crossed paths**;
acknowledgement is what makes it a connection. The `VERIFIED` column already has the shape
for this (`mutual` / `one-sided` / `unverified`) but its current values are synthetic and
spread evenly across all six degrees, so it carries no signal yet.

## The views

Nav order is deliberate. Three testers independently said the original eight equal-weight
dashboards were too much — Sarah: *"so many dashboards that it feels a lot like navigating
consilience"*; Linda: *"a lot of analysis there that's interesting, but as a teacher user
… I'm not sure I care"*; Dee: *"the most simple ones will be the most popular"*. So the
four views that answer a teacher's own question come first, and the four analytical ones
live behind a single **Explore** entry. Nothing was deleted, only de-ranked.

### Primary

1. **Connections** — concentric rings around one person, ring = relationship degree. Click any node to re-centre.
2. **Who knows whom** — the merged answer tool, in three tabs:
   - *At a school* — "I'm looking at that school; who do I know there?"
   - *With a person* — the chain between you two, plus **who you both know**.
   - *Find people* — plain faceted list (place / curriculum / role / experience).
3. **Map** — school points, great-circle migration arcs, headcount columns, globe, and "fly the journey". See [Map](#map-flat--globe--3d).
4. **Network** — the whole community as a force graph, edges coloured by degree, 2D and 3D.

### Explore

**Matrix** (school × school heatmap) · **Timeline** (two careers on one axis) ·
**Chord** (country-to-country flows) · **Insights** (community aggregates).

## Map: Flat / Globe / 3D

The map has **three mutually exclusive modes** rather than free-combining checkboxes,
because some combinations cannot render correctly:

| Mode | Projection | Layers |
|------|-----------|--------|
| **Flat** | mercator, no pitch | points + arcs |
| **Globe** | globe | points + arcs |
| **3D** | mercator + 55° pitch | points + arcs + headcount columns |

Two bugs Dave reported — *"you don't see the columns until you zoom in"* and *"on the globe
projection they are out in space"* — were both structural, not tuning problems:

- **Columns were invisible** because they were extruded circles of a fixed 30 km radius. At
  world zoom that is **0.62 pixels** wide. They are now sized in *screen space*: radius and
  height are recomputed from metres-per-pixel on every view change, so a column is always
  ~9 px wide and the tallest is always ~130 px high, at every zoom.
- **Globe detached the overlay** because arcs and columns were drawn by **deck.gl** on top
  of MapLibre. deck.gl syncs to MapLibre's *mercator* camera; switch to globe and the two
  cameras disagree. That is an open upstream bug ([visgl/deck.gl#9466](https://github.com/visgl/deck.gl/issues/9466),
  deck 9.x + MapLibre 5.x) which breaks in **both** orders and has no app-level workaround.

**deck.gl has therefore been removed entirely.** Every layer is now a native MapLibre
layer — one camera, one projection — so globe simply works. Migration arcs are great-circle
`LineString`s (spherical interpolation, longitudes unwrapped so nothing jumps the
antimeridian); headcount columns are a `fill-extrusion` over generated circle polygons.

Columns stay a 3D-mode-only feature on purpose: MapLibre's own documentation warns that
`fill-extrusion` produces artifacts under globe projection and recommends mercator for it.
Rather than ship a state that is always wrong, the mode model makes it unreachable.

## The beta group in the demo graph

The first beta ran on 150 invented teachers and none of the actual testers, which is part
of why it read as an analytics demo. The six of us are now seeded in.

**The schools and years are inferred guesses, not real history.** They come from whatever
people happened to mention in the WhatsApp thread, every posting carries
`"confirmed": false`, and the app renders a **"details to confirm"** badge next to those
people until their owner corrects them.

What *is* deliberate is the **shape** of the connections, taken from Linda's own worked
example (12 Sep 2025). The builder reproduces it exactly:

| Pair | Degree | Context |
|------|--------|---------|
| Paul S. + Linda H. | 1 | American School of Dubai, same time |
| Linda H. + Dave S. | 2 | American School of Dubai, different time |
| Linda H. + Dee | 3 | Addis Ababa, same time, different school |
| Dee + Sarah P. | 1 | ICS Addis Ababa, same time |

To correct anyone's details, edit `data/beta_group.json` and re-run the builder — every
relationship is recomputed from the postings, so there is no hand-maintained edge list to
drift out of sync:

```bash
python3 tools/build_seed.py --dry-run   # show what would change
python3 tools/build_seed.py             # write data/demo_data.json
```

It is idempotent (seeded rows are prefixed `B` / `ASG9` / `COLB` and stripped before
re-adding), so it is safe to run repeatedly.

## Data shown and not shown

Linda, 7 Jun 2026: *"we talked about NOT having teaching assignment, because that gets
tricky — hard to list them all, so many people cross divisions or change jobs, etc. I
think it would be helpful to have basics — student, faculty, staff, administrator."*

- **Not surfaced anywhere:** subjects taught, grade levels, department, specific job titles.
- **Surfaced instead:** a single **role category** — `Student` / `Faculty` / `Staff` /
  `Administrator` — derived in `roleCategory()` in `js/degrees.js`. `Student` exists for the
  TCK case Linda raised; no demo record uses it yet.
- `SALARY_RANGE` and `SUPERVISOR_NAME` exist in the schema for parity but are intentionally
  **blank and never displayed** (salary capture dropped; no naming of non-consenting parties).
- The seeded real people carry **no email address at all**.
- **There is no in-app messaging or contact sharing**, by decision — the June meeting
  concluded that putting people in touch is a later version and a liability question first.
  Testers do ask for it (*"Interesting data, but no way to connect"*); that is a known,
  deliberate gap, not an oversight.

## Architecture

```
index.html              shell: brand header + left tab nav + view container
.nojekyll               serve files/folders verbatim on Pages
/data/demo_data.json    the graph the app reads (generated; includes the seeded six)
/data/beta_group.json   EDITABLE source for the six real members
/data/*.csv             the original demo tables
/css/styles.css
/js/loadData.js         THE swappable data layer (Supabase later — see below)
/js/degrees.js          degree vocab+colors, role categories, adjacency, BFS + strength
                        pathfinder, separation, migration
/js/widgets.js          tiny DOM helper + teacher search-as-you-type
/js/app.js              loads data ONCE, hash router (Back/Forward works), mounts views
/js/views/*.js          one module per view
/tools/build_seed.py    merges beta_group.json into demo_data.json, recomputing degrees
/tools/build_static_maps.py   optional Python (folium) static map export
/maps/                  committed static HTML output of the script above
```

**`loadData()` is the only thing that changes for Supabase.** Every view consumes the
object it returns; no view talks to the data source directly.

View **and its parameters live in the URL hash** (`#search?tab=person`), so Back/Forward
work and any state is shareable — Dave: *"If you go from one section to another, any
parameters you enter reset."*

Libraries are loaded from CDN (D3 v7, MapLibre GL v5, 3d-force-graph) — **no bundler, no
`node_modules`, ES modules with relative paths only**. deck.gl was removed; see [Map](#map-flat--globe--3d).

## Run locally

It must be served over HTTP (ES modules + `fetch` won't run from `file://`):

```bash
cd "6 Degrees"
python3 -m http.server 8000
# open http://localhost:8000/
```

## Privacy / data notes

- **The repository must not contain real people's data.** `.gitignore` excludes the
  WhatsApp export, the meeting recording and transcript, the planning documents, and all
  media — these contain real names, a personal email address, meeting audio, and private
  photos and video of team members' homes. Deliberate site assets go in `assets/`, which is
  the one place media is allowed.
- No credentials are committed anywhere in this repository.
