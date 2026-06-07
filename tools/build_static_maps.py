#!/usr/bin/env python3
"""
build_static_maps.py — export standalone static HTML maps into ../maps/ from the CSVs.

These are committable, viewable-on-GitHub-Pages artifacts (no server, no JS build). They
complement the interactive MapLibre view; the production plan favours folium/leafmap for
spatial work, so this is the Python path.

Outputs:
  maps/schools_points.html   — folium point map, each school sized by # community members.
  maps/migration_flows.html  — folium map with curved/great-circle lines for teacher moves
                               (consecutive postings that change school), weighted by volume.
  maps/index.html            — a tiny landing page linking both.

Run:
  cd tools
  python3 -m pip install folium pandas        # leafmap optional, see note below
  python3 build_static_maps.py

Dependency-light by design: only `folium` + `pandas` are required. (leafmap/kepler can be
swapped in for the flow map later; folium keeps the demo deployable with no extra wheels.)
"""

import csv
import os
from collections import defaultdict

try:
    import folium
except ImportError:  # pragma: no cover
    raise SystemExit("This script needs folium:  python3 -m pip install folium pandas")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "maps")


def read_csv(name):
    with open(os.path.join(DATA, name), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    os.makedirs(OUT, exist_ok=True)
    schools = read_csv("Schools.csv")
    assignments = read_csv("Teaching_Assignments.csv")

    school_by_id = {s["SCHOOL_ID"]: s for s in schools}

    # Distinct teachers who passed through each school.
    members = defaultdict(set)
    for a in assignments:
        members[a["SCHOOL_ID"]].add(a["TEACHER_ID"])

    # ── Map 1: school points sized by headcount ──────────────────────────────
    m1 = folium.Map(location=[20, 30], zoom_start=2, tiles="CartoDB positron")
    max_members = max((len(v) for v in members.values()), default=1)
    for s in schools:
        lat, lon = f(s["LATITUDE"]), f(s["LONGITUDE"])
        if lat is None or lon is None:
            continue
        n = len(members.get(s["SCHOOL_ID"], ()))
        folium.CircleMarker(
            location=[lat, lon],
            radius=4 + 16 * (n / max_members),
            color="#0b6b78", weight=1, fill=True, fill_color="#17A2B8", fill_opacity=0.7,
            popup=folium.Popup(
                f"<b>{s['SCHOOL_NAME']}</b><br>{s['CITY']}, {s['COUNTRY']}<br>"
                f"{n} community members<br>Curriculum: {s.get('CURRICULUM_TYPE','')}",
                max_width=260),
            tooltip=f"{s['SCHOOL_NAME']} ({n})",
        ).add_to(m1)
    m1.save(os.path.join(OUT, "schools_points.html"))
    print(f"wrote maps/schools_points.html  ({len(schools)} schools)")

    # ── Map 2: migration flows (consecutive postings that change school) ──────
    postings = defaultdict(list)
    for a in assignments:
        postings[a["TEACHER_ID"]].append(a)
    for lst in postings.values():
        lst.sort(key=lambda a: a["START_DATE"])

    flows = defaultdict(int)  # (from_id, to_id) -> count
    for lst in postings.values():
        for i in range(len(lst) - 1):
            a, b = lst[i]["SCHOOL_ID"], lst[i + 1]["SCHOOL_ID"]
            if a != b:
                flows[(a, b)] += 1

    m2 = folium.Map(location=[20, 30], zoom_start=2, tiles="CartoDB dark_matter")
    max_flow = max(flows.values(), default=1)
    for (a, b), n in sorted(flows.items(), key=lambda kv: kv[1], reverse=True):
        sa, sb = school_by_id.get(a), school_by_id.get(b)
        if not sa or not sb:
            continue
        la, lo = f(sa["LATITUDE"]), f(sa["LONGITUDE"])
        lb, ob = f(sb["LATITUDE"]), f(sb["LONGITUDE"])
        if None in (la, lo, lb, ob):
            continue
        folium.PolyLine(
            [[la, lo], [lb, ob]],
            color="#FF6B35", weight=1 + 5 * (n / max_flow), opacity=0.5,
            tooltip=f"{sa['SCHOOL_NAME']} → {sb['SCHOOL_NAME']}: {n} move(s)",
        ).add_to(m2)
    # endpoints for reference
    for s in schools:
        lat, lon = f(s["LATITUDE"]), f(s["LONGITUDE"])
        if lat is None:
            continue
        folium.CircleMarker([lat, lon], radius=2, color="#17A2B8", fill=True,
                            fill_opacity=0.8, tooltip=s["SCHOOL_NAME"]).add_to(m2)
    m2.save(os.path.join(OUT, "migration_flows.html"))
    print(f"wrote maps/migration_flows.html ({len(flows)} school-to-school corridors)")

    # ── Landing page ─────────────────────────────────────────────────────────
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as fp:
        fp.write(
            "<!doctype html><meta charset=utf-8>"
            "<title>6 Degrees — static maps</title>"
            "<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;"
            "margin:40px auto;padding:0 20px;color:#1f2a30}"
            "a{color:#0b6b78}h1{color:#17A2B8}</style>"
            "<h1>6&deg; — static maps</h1>"
            "<p>Pre-rendered folium maps (no JavaScript build). "
            "For the live interactive map see the main app's <b>Map</b> tab.</p>"
            "<ul><li><a href='schools_points.html'>Schools, sized by community members</a></li>"
            "<li><a href='migration_flows.html'>Teacher migration flows</a></li></ul>")
    print("wrote maps/index.html")


if __name__ == "__main__":
    main()
