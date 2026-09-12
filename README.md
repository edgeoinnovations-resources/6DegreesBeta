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

### The six degrees, and why the first demo made them look broken

| Degree | Meaning |
|--------|---------|
| 1 | Same school, same time |
| 2 | Same school, different time |
| 3 | Same city, same time |
| 4 | Same city, different time |
| 5 | Same country, same time |
| 6 | Same country, different time |

For any pair, the **strongest (lowest) relationship found across all their postings wins** —
share a city and you get 3/4, never 5/6.

The first demo made this scheme look unusable: 42% of all possible pairs were directly
linked, the median person was linked to 66 of the other 155, average separation was 1.59
hops and nothing was more than 3 hops from anything. "People you both know" answered 61.

**That was the geography, not the degree definitions.** The old demo had 39 schools in 25
countries, and only *five* of those countries contained more than one city — so degrees
5 and 6 could barely occur and everyone collapsed into everyone else. Rebuilding on the
real school geography fixed it with the rules completely unchanged:

| | Old (39 schools, 25 countries, 156 people) | Now (620 schools, 126 countries, 1,206 people) |
|---|---|---|
| Density | 42.2% | **3.0%** |
| Median direct connections | 66 | **35** |
| Average separation | 1.59 hops | **2.49 hops** |
| Diameter | 3 | **4** |
| "People you both know" (Paul + Linda) | 61 | **18** |

Separation now distributes like a real network — 3% at one hop, 45% at two, 51% at three —
across one fully connected component with nobody isolated.

### Still open: co-location is not acknowledgement

Degree 1 means two people were at the same school at the same time. In a school of 1,600
that is evidence they *may* have crossed paths, not proof they know each other. The piece
the team designed and has not built is Dave's (13 Sep 2025) *"Checkmark 'I know this
person' (default setting 'I don't know this person')"*, with the June meeting's conclusion
that it *"should be shared by both parties"*.

The `VERIFIED` column exists for exactly this (`mutual` / `one-sided` / `unverified`). In
the first demo its values were random noise — almost exactly 18% "mutual" at every degree
— which made the mutual badge and the "verified only" filter look meaningful while
carrying no signal. The generator no longer invents it, so everything is `unverified`, and
the UI hides those controls until real acknowledgement exists (`hasAcknowledged()` in
`js/degrees.js`). They light up on their own when it does.

## The views

Nav order is deliberate. Three testers independently said the original eight equal-weight
dashboards were too much — Sarah: *"so many dashboards that it feels a lot like navigating
consilience"*; Linda: *"a lot of analysis there that's interesting, but as a teacher user
… I'm not sure I care"*; Dee: *"the most simple ones will be the most popular"*. So the
four views that answer a teacher's own question come first, and the four analytical ones
live behind a single **Explore** entry. Nothing was deleted, only de-ranked.

### Primary

1. **Connections** — concentric rings around one person, ring = relationship degree. See [Connections](#connections-how-the-rings-are-laid-out).
2. **Who knows whom** — the merged answer tool, in three tabs:
   - *At a school* — "I'm looking at that school; who do I know there?"
   - *With a person* — the chain between you two, plus **who you both know**.
   - *Find people* — plain faceted list (place / curriculum / role / experience).
3. **Map** — school points, great-circle migration arcs, headcount columns, globe, and "fly the journey". See [Map](#map-flat--globe--3d).
4. **Network** — the whole community as a force graph, edges coloured by degree, 2D and 3D.

### Explore

**Matrix** (school × school heatmap) · **Timeline** (two careers on one axis) ·
**Chord** (country-to-country flows) · **Insights** (community aggregates).

## Connections: how the rings are laid out

Rings are sized by **what they must hold**, not by degree number. The first version spaced
them evenly (`ringR = maxR * d / 6`), but connections pile into degrees 1 and 2. On the
densest person in the demo (97 connections) that meant:

| Degree | People | Ring circumference | Space needed | |
|---|---|---|---|---|
| 1 | 26 | 262 px | 649 px | **2.5× oversubscribed** |
| 2 | 50 | 524 px | 1,361 px | **2.6× oversubscribed** |
| 3 | 4 | 785 px | 100 px | 13% used |
| 5 | 2 | 1,309 px | 47 px | 4% used |

So the inner rings collapsed into a solid donut of overlapping circles while the outer
rings sat empty. Now each ring gets the radius its own population needs, and a ring too
crowded for one circle is split into concentric **bands** inside its own zone, which keeps
"ring = degree" true.

The layout **fits by shrinking the nodes and the ring padding** until the whole plan sits
inside the canvas. It deliberately does *not* scale the finished plan — ring capacity is
computed from those radii, so scaling afterwards silently invalidates it and the nodes
overlap again.

Other things that follow from the geometry:

- **Labels** need room both along the ring *and* between rings, or two nodes on
  neighbouring rings print their names on top of each other. Whether a name fits is decided
  from its **measured** width (`getComputedTextLength`), not a fixed threshold — a guess let
  long names like "Christian" print over the next ring. Where there isn't room, names appear
  on hover instead. They sit radially outward from each node, which fans them out.
- **Rings are staggered angularly** so nodes on neighbouring rings don't line up on the
  same spoke.
- **No ring captions.** The rings briefly carried "degree N · count" captions at the top;
  they were removed as unnecessary and confusing — the legend and the rail already say
  which degree is which. The 40° gap that existed to make room for them is now available
  to nodes, giving each ring ~12% more space.
- **Angular position means something**: each ring is ordered by region, then country.
- **Empty rings are not drawn.** Faint alternating zone tints make rings read as regions.
- **Spokes** are gentle curves, faint by default and lit on hover; hovering dims everything
  else, and re-centring animates nodes to their new rings rather than redrawing.
- **A list rail** fills the width that used to be dead space, holds every person however
  crowded the rings are, and is hover- and click-linked to the graph. Crowded rings cap at
  34 drawn with a "show every person" toggle; the rail always has the full list.

## Map: Flat / Globe / 3D

The map has **three mutually exclusive modes** rather than free-combining checkboxes,
because some combinations cannot render correctly:

| Mode | Projection | Draws |
|------|-----------|-------|
| **Flat** | mercator, no pitch | school points |
| **Globe** | globe | school points |
| **3D** | mercator + 55° pitch | headcount columns, **no** school points |

In 3D the columns replace the school dots — the dots sat at the columns' feet and only
added clutter. **Migration arcs are off by default** in every mode: 242 great circles over
the whole world is a thicket that buries everything else, so it's opt-in.

**Fly a teacher's journey** is a solo view. While it runs, every other dot and line is
hidden and only that person's career is drawn — their stops in order, joined by
great-circle legs that accumulate one hop at a time. When the last stop lands the camera
frames the whole journey and holds it, so panning around no longer cancels it; the button
becomes *Clear …'s journey*. Clearing empties the journey sources and restores whatever
the current mode was showing.

The control panel collapses to its title bar, and starts open.

Two bugs Dave reported — *"you don't see the columns until you zoom in"* and *"on the globe
projection they are out in space"* — were both structural, not tuning problems:

- **Columns were invisible** because they were extruded circles of a fixed 30 km radius. At
  world zoom that is **0.62 pixels** wide. They are now sized in *screen space*: radius and
  height are recomputed from metres-per-pixel on every view change, so a column is always
  ~6 px across and the tallest is always ~130 px high, at every zoom.
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

## Where the geography comes from

`data/isr_schools.json` holds 2,127 schools in 152 countries, taken from the two school
lists published by International Schools Review. **ISR lists country and school name only
— it never states the city**, so the city is inferred and every row records how:

| `city_source` | Meaning | Count |
|---|---|---|
| `name` | the city appears verbatim in the school name | 840 |
| `fuzzy` | the name contains a near-miss spelling of a real city (ISR's "Durress" → Durrës) | 31 |
| `fallback-largest-city` | **a guess** — the name reveals nothing, so the country's largest city was assumed | 1,256 |

Coordinates are **city centroids** from GeoNames (via `geonamescache`), not school
addresses.

`tools/build_demo_data.py` uses only the `name` and `fuzzy` rows — the guesses are
ignored entirely — which yields **620 schools across 395 cities in 126 countries, 63 of
them with more than one city**. To see more of degrees 5 and 6, more countries need more
cities; single-city countries (and genuinely, Singapore) can never produce them.

```bash
python3 tools/build_demo_data.py --dry-run              # report, write nothing
python3 tools/build_demo_data.py                        # default: 1,200 teachers
python3 tools/build_demo_data.py --teachers 800 --schools-per-city 2
```

It is deterministic (fixed seed), recomputes every colleagueship from the postings, and
folds in the beta group from `data/beta_group.json`. Output is 8.2 MB of JSON, which
GitHub Pages gzips to about 400 KB.

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
| Linda H. + Dee M. | 3 | Addis Ababa, same time, different school |
| Dee M. + Sarah P. | 1 | ICS Addis Ababa, same time |

To correct anyone's details, edit `data/beta_group.json` and re-run the builder — every
relationship is recomputed from the postings, so there is no hand-maintained edge list to
drift out of sync:

```bash
python3 tools/build_demo_data.py        # rebuilds everything, beta group included
```

`tools/build_seed.py` is the older, narrower tool: it merges the beta group into an
*existing* `demo_data.json` without regenerating the fictional teachers. `build_demo_data.py`
supersedes it for a full rebuild and folds the beta group in itself.

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
