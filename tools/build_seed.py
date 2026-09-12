#!/usr/bin/env python3
"""Merge the beta group (data/beta_group.json) into the demo graph.

Run:  python3 tools/build_seed.py            # writes ../data/demo_data.json in place
      python3 tools/build_seed.py --dry-run  # print what would change, write nothing

WHY THIS EXISTS
---------------
The beta testers were looking at 150 invented teachers and none of themselves, which is
a big part of why the site read as an analytics demo rather than a tool. This seeds the
six of us in, using first name + last initial only.

It is a *builder*, not a one-off edit, because the dates in beta_group.json are guesses.
When someone corrects their own history, re-run this and every relationship is recomputed
from the postings — no hand-maintained edge list to get out of sync.

THE DEGREE RULES
----------------
Dave's scheme, as adopted on 13 Sep 2025 and as implemented in js/degrees.js:

    1  same school,  same time          4  same city,     different time
    2  same school,  different time     5  same country,  same time
    3  same city,    same time          6  same country,  different time

For a pair of people we compare every posting of one against every posting of the other
and keep the STRONGEST (lowest-numbered) relationship found, along with the context that
produced it. This is the same "min over all shared contexts" rule the existing
colleagueships data follows.

Seeded records are identifiable by their id prefix (B... / ASG9... / COLB...), so this
script is idempotent: it strips anything it previously added before re-adding.
"""
import json
import pathlib
import sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO = ROOT / "data" / "demo_data.json"
SEED = ROOT / "data" / "beta_group.json"

TODAY = date.today().isoformat()
FAR_FUTURE = "9999-12-31"   # stands in for an open-ended "still there" end date


def overlaps(a_start, a_end, b_start, b_end):
    """True if two closed date ranges share at least one day."""
    return (a_start or "") <= (b_end or FAR_FUTURE) and (b_start or "") <= (a_end or FAR_FUTURE)


def relate(pa, sa, pb, sb):
    """Degree + context for one posting pair, or None if no shared place at all.

    pa/pb are postings (dicts with SCHOOL_ID/START_DATE/END_DATE);
    sa/sb are the corresponding school records.
    """
    same_time = overlaps(pa["START_DATE"], pa["END_DATE"], pb["START_DATE"], pb["END_DATE"])

    if sa["SCHOOL_ID"] == sb["SCHOOL_ID"]:
        return (1 if same_time else 2, "school", sa["SCHOOL_ID"], sa["SCHOOL_NAME"], same_time)
    if sa["CITY"] and sa["CITY"] == sb["CITY"] and sa["COUNTRY"] == sb["COUNTRY"]:
        return (3 if same_time else 4, "city", sa["CITY"], f'{sa["CITY"]}, {sa["COUNTRY"]}', same_time)
    if sa["COUNTRY"] and sa["COUNTRY"] == sb["COUNTRY"]:
        return (5 if same_time else 6, "country", sa["COUNTRY"], sa["COUNTRY"], same_time)
    return None


def overlap_years(pa, pb):
    """The inclusive year span the two postings share, as 'YYYY-YYYY' (or '')."""
    lo = max(pa["START_DATE"] or "", pb["START_DATE"] or "")[:4]
    hi = min(pa["END_DATE"] or FAR_FUTURE, pb["END_DATE"] or FAR_FUTURE)[:4]
    if not lo or not hi or hi < lo:
        return ""
    if hi == "9999":
        hi = "present"
    return lo if lo == hi else f"{lo}-{hi}"


def main():
    dry = "--dry-run" in sys.argv

    demo = json.loads(DEMO.read_text())
    seed = json.loads(SEED.read_text())

    schools = {s["SCHOOL_ID"]: s for s in demo["schools"]}

    # ── strip anything a previous run added (idempotence) ────────────────────
    before = (len(demo["teachers"]), len(demo["assignments"]), len(demo["colleagueships"]))
    demo["teachers"] = [t for t in demo["teachers"] if not t["TEACHER_ID"].startswith("B")]
    demo["assignments"] = [a for a in demo["assignments"] if not a["TEACHER_ID"].startswith("B")]
    demo["colleagueships"] = [
        c for c in demo["colleagueships"]
        if not (c["TEACHER_A_ID"].startswith("B") or c["TEACHER_B_ID"].startswith("B"))
    ]

    # ── build teacher + assignment records ──────────────────────────────────
    new_teachers, new_assignments = [], []
    asg_n = 9000
    unknown_schools = []

    for p in seed["people"]:
        name = f'{p["first"]} {p["last_initial"]}.' if p.get("last_initial") else p["first"]
        postings = p.get("postings", [])
        all_confirmed = all(x.get("confirmed") for x in postings) if postings else False

        starts = sorted(x["start"] for x in postings if x.get("start"))

        # Derive years of experience from the postings rather than leaving it null.
        # A null here coerces to 0 in JS arithmetic, which would quietly drag down any
        # community average and render as "null yrs" in tooltips.
        span_years = 0
        for x in postings:
            if not x.get("start"):
                continue
            end = x.get("end") or TODAY
            span_years += max(0, (int(end[:4]) - int(x["start"][:4])))
        new_teachers.append({
            "TEACHER_ID": p["id"],
            "FIRST_NAME": p["first"],
            "LAST_NAME": (p["last_initial"] + ".") if p.get("last_initial") else "",
            "FULL_NAME": name,
            # No email for real people. The demo teachers carry @6degrees.demo addresses;
            # these six get none at all, so there is nothing to leak.
            "EMAIL": "",
            "NATIONALITY": p.get("nationality", ""),
            "CERTIFICATION_LEVEL": "",
            "SPECIALIZATION": p.get("specialization", ""),
            "YEARS_EXPERIENCE": span_years,
            "STATUS": "Active",
            "HIRE_DATE": starts[0] if starts else "",
            "IS_BETA_GROUP": True,
            # Drives the "details to confirm" marker in the UI.
            "DETAILS_CONFIRMED": all_confirmed,
            "CREATED_DATE": TODAY,
            "LAST_MODIFIED": TODAY,
        })

        for x in postings:
            sid = x["school_id"]
            if sid not in schools:
                unknown_schools.append((p["id"], sid))
                continue
            asg_n += 1
            new_assignments.append({
                "ASSIGNMENT_ID": f"ASG{asg_n}",
                "TEACHER_ID": p["id"],
                "SCHOOL_ID": sid,
                # Role category only — no job titles, no subjects, no grade levels.
                # (Linda, 7 Jun 2026: "we talked about NOT having teaching assignment".)
                "POSITION_TITLE": x.get("role", "Faculty"),
                "START_DATE": x.get("start"),
                "END_DATE": x.get("end"),
                "EMPLOYMENT_TYPE": "Full-time",
                "SALARY_RANGE": "",
                "SUPERVISOR_NAME": "",
                "IS_CURRENT_POSITION": "Yes" if x.get("current") else "No",
                "DETAILS_CONFIRMED": bool(x.get("confirmed")),
                "CREATED_DATE": TODAY,
                "LAST_MODIFIED": TODAY,
            })

    demo["teachers"].extend(new_teachers)
    demo["assignments"].extend(new_assignments)

    # ── recompute colleagueships for every pair involving a seeded person ───
    postings_by = {}
    for a in demo["assignments"]:
        postings_by.setdefault(a["TEACHER_ID"], []).append(a)

    seeded_ids = [t["TEACHER_ID"] for t in new_teachers]
    everyone = [t["TEACHER_ID"] for t in demo["teachers"]]

    pairs = set()
    for b in seeded_ids:
        for other in everyone:
            if other != b:
                pairs.add(tuple(sorted((b, other))))

    col_n = 0
    new_cols = []
    for a_id, b_id in sorted(pairs):
        best = None
        for pa in postings_by.get(a_id, []):
            sa = schools.get(pa["SCHOOL_ID"])
            if not sa:
                continue
            for pb in postings_by.get(b_id, []):
                sb = schools.get(pb["SCHOOL_ID"])
                if not sb:
                    continue
                r = relate(pa, sa, pb, sb)
                if r and (best is None or r[0] < best[0][0]):
                    best = (r, pa, pb)
        if not best:
            continue
        (deg, ctype, cid, clabel, same_time), pa, pb = best
        col_n += 1
        new_cols.append({
            "COLLEAGUESHIP_ID": f"COLB{col_n:05d}",
            "TEACHER_A_ID": a_id,
            "TEACHER_B_ID": b_id,
            "DEGREE": deg,
            "SHARED_CONTEXT_TYPE": ctype,
            "SHARED_CONTEXT_ID": cid,
            "SHARED_CONTEXT_LABEL": clabel,
            "TIME_RELATION": "same time" if same_time else "different time",
            "OVERLAP_YEARS": overlap_years(pa, pb) if same_time else "",
            # Co-location is computed; "we actually know each other" is not something this
            # script can know, so nothing here is ever marked mutual.
            "VERIFIED": "unverified",
            "COMPUTED_AT": TODAY,
        })

    demo["colleagueships"].extend(new_cols)
    demo["counts"] = {
        "schools": len(demo["schools"]),
        "teachers": len(demo["teachers"]),
        "assignments": len(demo["assignments"]),
        "colleagueships": len(demo["colleagueships"]),
    }
    demo["generated_at"] = TODAY

    # ── report ──────────────────────────────────────────────────────────────
    print(f"seeded {len(new_teachers)} people, {len(new_assignments)} postings, {len(new_cols)} connections")
    print(f"  teachers       {before[0]:5} -> {len(demo['teachers'])}")
    print(f"  assignments    {before[1]:5} -> {len(demo['assignments'])}")
    print(f"  colleagueships {before[2]:5} -> {len(demo['colleagueships'])}")

    if unknown_schools:
        print("\n  !! unknown school_id values (posting skipped):")
        for pid, sid in unknown_schools:
            print(f"     {pid} -> {sid}")

    print("\nthe shapes Linda described, as computed:")
    by_pair = {(c["TEACHER_A_ID"], c["TEACHER_B_ID"]): c for c in new_cols}
    names = {t["TEACHER_ID"]: t["FULL_NAME"] for t in demo["teachers"]}
    for a, b, expect in [
        ("B001", "B002", "Paul & Linda — same school, same time"),
        ("B002", "B003", "Linda & Dave — same school, different time"),
        ("B002", "B004", "Linda & Dee — same city, same time, different school"),
        ("B004", "B005", "Dee & Sarah — same school, same time"),
    ]:
        c = by_pair.get((a, b)) or by_pair.get((b, a))
        if c:
            print(f"  degree {c['DEGREE']}  {names.get(a)} + {names.get(b)}"
                  f"  [{c['SHARED_CONTEXT_LABEL']}, {c['TIME_RELATION']}"
                  f"{', ' + c['OVERLAP_YEARS'] if c['OVERLAP_YEARS'] else ''}]   <- {expect}")
        else:
            print(f"  MISSING  {names.get(a)} + {names.get(b)}   <- expected {expect}")

    if dry:
        print("\n--dry-run: nothing written")
        return

    DEMO.write_text(json.dumps(demo, indent=1))
    print(f"\nwrote {DEMO.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
