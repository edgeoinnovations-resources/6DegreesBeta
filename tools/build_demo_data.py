#!/usr/bin/env python3
"""Regenerate data/demo_data.json over the real international-school geography.

Run:  python3 tools/build_demo_data.py                # default scale
      python3 tools/build_demo_data.py --teachers 800 --schools-per-city 3
      python3 tools/build_demo_data.py --dry-run      # report only, write nothing

WHY
---
The first demo had 39 schools in 25 countries, and only FIVE of those countries had more
than one city. Degrees 5 and 6 ("same country, same/different time") can only occur when
two people share a country but never a city or school, so the old geography could barely
produce them, and degrees 3/4 needed two schools in one city.

The geography now comes from the school list published by International Schools Review
(see data/isr_schools.json). ISR lists country + school name only and never states the
city, so the city is INFERRED: this build uses only schools whose city is readable from
the school name, and ignores the ~59% where the city had to be guessed.

TWO THINGS THIS ALSO FIXES
--------------------------
1. The old colleagueships disagreed with their own assignments on 472 edges - always the
   time half, claiming "same time" when the postings did not overlap - and 2,493
   different-time edges displayed an OVERLAP_YEARS range anyway. Everything here is
   computed from the postings by one function, so that class of bug cannot recur.

2. VERIFIED was random noise (~18% "mutual" at every degree), which made the mutual
   badge and the "verified only" filter meaningless. Nothing is marked mutual now:
   whether two people acknowledge each other is not something a generator can know.

THE DEGREE RULES (Dave's scheme, as adopted 13 Sep 2025)
    1 same school, same time        4 same city,    different time
    2 same school, different time   5 same country, same time
    3 same city,   same time        6 same country, different time
For a pair, the STRONGEST (lowest) relationship found across all their postings wins.
"""
import argparse
import json
import pathlib
import random
import re
import collections
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
ISR = ROOT / "data" / "isr_schools.json"
SEED_FILE = ROOT / "data" / "beta_group.json"
OUT = ROOT / "data" / "demo_data.json"

TODAY = date.today().isoformat()
THIS_YEAR = date.today().year
FAR_FUTURE = "9999-12-31"

# ── Schools the beta group needs that ISR does not list ─────────────────────
# ISR only lists schools that have been reviewed on ISR, and it spells some differently
# ("American School Bombay"). These are kept so the seeded six keep their careers.
EXTRA_SCHOOLS = [
    dict(SCHOOL_NAME="American School of Dubai", CITY="Dubai", COUNTRY="United Arab Emirates",
         LATITUDE=25.21122, LONGITUDE=55.26088),
    dict(SCHOOL_NAME="American Community School of Abu Dhabi", CITY="Abu Dhabi",
         COUNTRY="United Arab Emirates", LATITUDE=24.45119, LONGITUDE=54.39696),
    dict(SCHOOL_NAME="Denver International School", CITY="Denver", COUNTRY="United States",
         LATITUDE=39.73915, LONGITUDE=-104.9847),
    # These two ARE in the ISR list, but ISR's name reveals no city so the build would
    # skip them. Their cities are not in doubt, so they are pinned here instead.
    dict(SCHOOL_NAME="Sandford International School", CITY="Addis Ababa", COUNTRY="Ethiopia",
         LATITUDE=9.02497, LONGITUDE=38.74689),
    dict(SCHOOL_NAME="American School Bombay", CITY="Mumbai", COUNTRY="India",
         LATITUDE=19.07283, LONGITUDE=72.88261),
]

# Friendlier display names than the formal ISO ones pycountry returns.
FRIENDLY = {
    "Iran, Islamic Republic of": "Iran", "Viet Nam": "Vietnam",
    "Korea, Republic of": "South Korea", "Korea, Democratic People's Republic of": "North Korea",
    "Syrian Arab Republic": "Syria", "Lao People's Democratic Republic": "Laos",
    "Taiwan, Province of China": "Taiwan", "Moldova, Republic of": "Moldova",
    "Tanzania, United Republic of": "Tanzania", "Bolivia, Plurinational State of": "Bolivia",
    "Venezuela, Bolivarian Republic of": "Venezuela", "Palestine, State of": "Palestine",
    "Congo, The Democratic Republic of the": "DR Congo", "Brunei Darussalam": "Brunei",
    "Russian Federation": "Russia", "Czechia": "Czech Republic",
    "Macao": "Macau", "Hong Kong": "Hong Kong", "Timor-Leste": "East Timor",
    "Micronesia, Federated States of": "Micronesia", "Virgin Islands, U.S.": "US Virgin Islands",
}

CURRICULA = ["IB", "American", "British", "IB/American", "IB/British", "Bilingual", "National"]
GRADE_BANDS = ["PK-12", "K-12", "K-6", "6-12", "PK-6", "1-12"]
SPECIALIZATIONS = [
    "Mathematics", "Physics", "Chemistry", "Biology", "English", "History", "Geography",
    "Economics", "Business Management", "Computer Science", "Design Technology", "Music",
    "Drama", "Visual Arts", "Physical Education", "Psychology", "French", "Spanish",
    "Mandarin", "Arabic", "German", "Early Years", "Primary Homeroom", "Librarian",
    "Counselling", "Learning Support", "English as an Additional Language",
    "Theory of Knowledge", "Environmental Systems",
]
NATIONALITIES = [
    ("American", 20), ("British", 17), ("Canadian", 11), ("Australian", 8), ("Irish", 4),
    ("New Zealander", 4), ("South African", 5), ("Indian", 6), ("Filipino", 4),
    ("Dutch", 2), ("German", 2), ("French", 2), ("Spanish", 2), ("Italian", 1),
    ("Kenyan", 1), ("Nigerian", 1), ("Brazilian", 1), ("Mexican", 1), ("Japanese", 1),
    ("Korean", 1), ("Chinese", 2), ("Malaysian", 1), ("Singaporean", 1), ("Egyptian", 1),
]
ROLES = [("Faculty", 78), ("Staff", 10), ("Administrator", 10), ("Student", 2)]

FIRST = """Aaron Abigail Adam Adele Adrian Aisha Alan Alice Amara Amelia Amir Amy Andrew Anika
Anna Anthony Antonio Arjun Ashley Aya Barbara Benjamin Beth Bianca Brendan Brian Bridget Caleb
Cameron Carla Carlos Caroline Catherine Charles Charlotte Chloe Christian Christine Claire Clara
Colin Connor Daniel Danielle David Deborah Declan Diana Diego Dominic Dylan Edward Eleanor Elena
Eli Elias Elizabeth Emily Emma Eric Erin Esther Ethan Eva Evelyn Fatima Felix Fiona Francesca
Frank Gabriel Gemma George Georgia Grace Gregory Hannah Harold Harriet Hassan Heather Helen Henry
Hiroshi Hugo Ian Imani Ines Isaac Isabel Ivan Jack Jacob James Jane Jasmine Jason Javier Jennifer
Jessica Joanna John Jonas Jordan Jose Joseph Joshua Julia Julian Justin Kaito Karen Kate Katherine
Keiko Kevin Kiran Krishna Laura Lauren Leah Lena Leo Liam Lila Linda Lucas Lucy Luis Maya Magnus
Malik Marco Margaret Maria Mariam Mark Martin Mary Mateo Matthew Megan Mei Melissa Micah Michael
Michelle Miguel Mohammed Molly Naomi Natalie Nathan Neil Nicholas Nicole Nina Noah Nora Olivia
Omar Oscar Owen Patrick Paul Paula Peter Philip Priya Rachel Rafael Rebecca Richard Riya Robert
Rohan Rosa Rose Ruth Ryan Sadia Samuel Sandra Sara Sarah Sean Sebastian Shannon Simon Sofia Sophie
Stephen Steven Susan Takeshi Tanya Teresa Thomas Timothy Tobias Tom Victor Victoria Vincent Wei
William Yara Yasmin Yuki Zachary Zainab Zoe""".split()

LAST = """Abbott Adams Ahmed Alvarez Andersen Anderson Bailey Baker Banda Barnes Bell Bennett
Bergman Bishop Black Blake Bowen Brennan Brooks Brown Bryant Burke Burns Butler Byrne Campbell
Carter Chan Chandra Chen Clark Clarke Coleman Collins Connolly Cooper Costa Cox Crawford Cruz
Cunningham Curtis Dalton Daniels Davies Davis Delgado Desai Diaz Dixon Doherty Donnelly Doyle
Duarte Duffy Dunne Edwards Ellis Evans Farrell Fernandez Fischer Fisher Fitzgerald Fleming Fletcher
Flores Ford Foster Fox Franklin Garcia Gardner George Gibson Gill Gomez Gonzalez Graham Grant Gray
Green Griffin Gupta Hale Hall Hamilton Hansen Hardy Harper Harris Hart Hassan Hayes Henderson
Hendricks Hernandez Hill Hoffman Holland Holmes Hopkins Howard Hughes Hunt Hussain Ibrahim Ingram
Jackson Jacobs James Jensen Jimenez Johnson Jones Jordan Joshi Kaur Keane Kelly Kennedy Khan Kim
King Knight Kowalski Kumar Lam Lambert Lane Larsen Lawson Lee Leonard Lewis Lim Lindqvist Lopez
Lowe Lucas Lynch Mackenzie Maguire Mahmood Malik Marsh Marshall Martin Martinez Mason Matthews
McBride McCarthy McDonald McGrath McKenna Mehta Mendez Miller Mitchell Mohamed Moore Morales Moreno
Morgan Morris Morrison Murphy Murray Nakamura Navarro Nelson Newman Nguyen Nichols Nolan Norton
Nowak Obrien Oconnor Odonnell Okafor Oliveira Olsen Osborne Owens Palmer Park Parker Patel Pearson
Perez Perry Peters Peterson Phillips Pierce Porter Powell Price Quinn Ramirez Ramos Rasmussen Reed
Reid Reyes Reynolds Rhodes Rice Richards Riley Rivera Roberts Robertson Robinson Rodriguez Rogers
Romero Rose Ross Roy Russell Ryan Sanchez Sanders Santos Saunders Schmidt Schneider Scott Sharma
Shaw Shepherd Silva Simmons Simpson Singh Slater Smith Solomon Soto Spencer Stevens Stewart Stone
Sullivan Sutton Suzuki Takahashi Tanaka Taylor Thompson Thomson Torres Tran Turner Vargas Vasquez
Wagner Walker Wallace Walsh Ward Warren Watson Weber Webster Wells West Weston Wheeler White
Whitfield Wilkins Williams Wilson Winters Wong Wood Woods Wright Yamamoto Yates Young Zhang""".split()


def overlaps(a_start, a_end, b_start, b_end):
    return (a_start or "") <= (b_end or FAR_FUTURE) and (b_start or "") <= (a_end or FAR_FUTURE)


def relate(pa, sa, pb, sb):
    """Degree + context for one posting pair, or None if no shared place."""
    same = overlaps(pa["START_DATE"], pa["END_DATE"], pb["START_DATE"], pb["END_DATE"])
    if sa["SCHOOL_ID"] == sb["SCHOOL_ID"]:
        return (1 if same else 2), "school", sa["SCHOOL_ID"], sa["SCHOOL_NAME"], same
    if sa["CITY"] and sa["CITY"] == sb["CITY"] and sa["COUNTRY"] == sb["COUNTRY"]:
        return (3 if same else 4), "city", sa["CITY"], f'{sa["CITY"]}, {sa["COUNTRY"]}', same
    if sa["COUNTRY"] and sa["COUNTRY"] == sb["COUNTRY"]:
        return (5 if same else 6), "country", sa["COUNTRY"], sa["COUNTRY"], same
    return None


def overlap_years(pa, pb):
    lo = max(pa["START_DATE"] or "", pb["START_DATE"] or "")[:4]
    hi = min(pa["END_DATE"] or FAR_FUTURE, pb["END_DATE"] or FAR_FUTURE)[:4]
    if not lo or not hi or hi < lo:
        return ""
    if hi == "9999":
        hi = "present"
    return lo if lo == hi else f"{lo}-{hi}"


def weighted(rnd, pairs):
    vals, wts = zip(*pairs)
    return rnd.choices(vals, weights=wts)[0]


def load_school_pool(per_city):
    """ISR schools whose city is readable from the name, capped per city, plus EXTRA_SCHOOLS."""
    isr = json.loads(ISR.read_text())
    rows, seen_city = [], collections.Counter()
    for country, v in sorted(isr["countries"].items()):
        display = FRIENDLY.get(country, country)
        for r in v["schools"]:
            if r["city_source"] not in ("name", "fuzzy"):
                continue                       # skip guessed cities entirely
            key = (display, r["city"])
            if per_city and seen_city[key] >= per_city:
                continue
            seen_city[key] += 1
            rows.append(dict(SCHOOL_NAME=r["school"], CITY=r["city"], COUNTRY=display,
                             LATITUDE=r["lat"], LONGITUDE=r["lon"]))
    have = {(x["SCHOOL_NAME"], x["COUNTRY"]) for x in rows}
    for x in EXTRA_SCHOOLS:
        if (x["SCHOOL_NAME"], x["COUNTRY"]) not in have:
            rows.append(dict(x))
    return rows


def finish_schools(rows, rnd):
    out = []
    for i, s in enumerate(rows, 1):
        out.append(dict(
            SCHOOL_ID=f"SCH{i:04d}", SCHOOL_NAME=s["SCHOOL_NAME"],
            SCHOOL_TYPE="International School", CITY=s["CITY"], COUNTRY=s["COUNTRY"],
            LATITUDE=s["LATITUDE"], LONGITUDE=s["LONGITUDE"],
            ENROLLMENT_SIZE=rnd.choice([180, 250, 320, 420, 550, 700, 900, 1200, 1600, 2100]),
            GRADE_LEVELS=rnd.choice(GRADE_BANDS),
            CURRICULUM_TYPE=rnd.choice(CURRICULA),
            CREATED_DATE=TODAY, LAST_MODIFIED=TODAY,
        ))
    return out


def make_teachers(n, schools, rnd):
    """Careers biased to a home country, so people genuinely re-cross paths."""
    by_country = collections.defaultdict(list)
    for s in schools:
        by_country[s["COUNTRY"]].append(s)
    countries = sorted(by_country)

    teachers, assignments = [], []
    used_names = set()
    aid = 0
    for i in range(1, n + 1):
        while True:
            fn, ln = rnd.choice(FIRST), rnd.choice(LAST)
            if (fn, ln) not in used_names:
                used_names.add((fn, ln)); break
        tid = f"T{i:04d}"
        spec = rnd.choice(SPECIALIZATIONS)

        n_post = rnd.choices([1, 2, 3, 4, 5], weights=[7, 20, 31, 26, 16])[0]
        year = rnd.randint(1996, 2021)
        home = rnd.choice(countries)
        country = home
        my_posts = []
        for p in range(n_post):
            if p and rnd.random() < 0.42:
                pass                                      # stay in country -> feeds 3-6
            else:
                country = home if rnd.random() < 0.28 else rnd.choice(countries)
            school = rnd.choice(by_country[country])
            length = rnd.choices([1, 2, 3, 4, 5, 6, 7], weights=[6, 14, 24, 22, 16, 10, 8])[0]
            start, end = year, year + length
            current = end >= THIS_YEAR
            aid += 1
            my_posts.append(dict(
                ASSIGNMENT_ID=f"ASG{aid:05d}", TEACHER_ID=tid, SCHOOL_ID=school["SCHOOL_ID"],
                POSITION_TITLE=weighted(rnd, ROLES),
                START_DATE=f"{start}-08-01",
                END_DATE=None if current else f"{end}-06-30",
                EMPLOYMENT_TYPE="Full-time", SALARY_RANGE="", SUPERVISOR_NAME="",
                IS_CURRENT_POSITION="Yes" if current else "No",
                CREATED_DATE=TODAY, LAST_MODIFIED=TODAY,
            ))
            if current:
                break
            year = end + rnd.choice([0, 0, 0, 1])
            if year > THIS_YEAR - 1:
                break
        assignments.extend(my_posts)
        yrs = sum(int((p["END_DATE"] or f"{THIS_YEAR}-06-30")[:4]) - int(p["START_DATE"][:4])
                  for p in my_posts)
        teachers.append(dict(
            TEACHER_ID=tid, FIRST_NAME=fn, LAST_NAME=ln, FULL_NAME=f"{fn} {ln}",
            EMAIL=f"{fn.lower()}.{ln.lower()}{i}@6degrees.demo",
            NATIONALITY=weighted(rnd, NATIONALITIES),
            CERTIFICATION_LEVEL=rnd.choice(["Bachelor's + PGCE", "Master's in Education",
                                            "Master's in Subject Area", "Doctorate"]),
            SPECIALIZATION=spec, YEARS_EXPERIENCE=yrs, STATUS="Active",
            HIRE_DATE=min(p["START_DATE"] for p in my_posts),
            CREATED_DATE=TODAY, LAST_MODIFIED=TODAY,
        ))
    return teachers, assignments


def add_beta_group(schools, teachers, assignments):
    """Seed the six real members from data/beta_group.json onto this geography."""
    if not SEED_FILE.exists():
        return [], [], []
    seed = json.loads(SEED_FILE.read_text())
    by_name = {s["SCHOOL_NAME"].lower(): s for s in schools}

    # beta_group.json refers to schools by the OLD SCH0xx ids, so map through these names
    OLD_ID_TO_NAME = {
        "SCH001": "american school of dubai",
        "SCH006": "american community school of abu dhabi",
        "SCH019": "international community school addis ababa",
        "SCH020": "sandford international school",
        "SCH021": "denver international school",
        "SCH025": "american school bombay",
        "SCH032": "jakarta intercultural school",
    }
    bt, ba, missing = [], [], []
    aid = 90000
    for p in seed["people"]:
        name = f'{p["first"]} {p["last_initial"]}.' if p.get("last_initial") else p["first"]
        posts = p.get("postings", [])
        starts = sorted(x["start"] for x in posts if x.get("start"))
        yrs = 0
        for x in posts:
            sid = x["school_id"]
            nm = OLD_ID_TO_NAME.get(sid)
            school = by_name.get(nm) if nm else None
            if school is None:
                missing.append((p["id"], sid, nm))
                continue
            end = x.get("end")
            yrs += (int((end or TODAY)[:4]) - int(x["start"][:4])) if x.get("start") else 0
            aid += 1
            ba.append(dict(
                ASSIGNMENT_ID=f"ASG{aid}", TEACHER_ID=p["id"], SCHOOL_ID=school["SCHOOL_ID"],
                POSITION_TITLE=x.get("role", "Faculty"), START_DATE=x.get("start"),
                END_DATE=x.get("end"), EMPLOYMENT_TYPE="Full-time", SALARY_RANGE="",
                SUPERVISOR_NAME="", IS_CURRENT_POSITION="Yes" if x.get("current") else "No",
                DETAILS_CONFIRMED=bool(x.get("confirmed")), CREATED_DATE=TODAY, LAST_MODIFIED=TODAY,
            ))
        bt.append(dict(
            TEACHER_ID=p["id"], FIRST_NAME=p["first"],
            LAST_NAME=(p["last_initial"] + ".") if p.get("last_initial") else "",
            FULL_NAME=name, EMAIL="",          # no email for real people, ever
            NATIONALITY=p.get("nationality", ""), CERTIFICATION_LEVEL="",
            SPECIALIZATION=p.get("specialization", ""), YEARS_EXPERIENCE=yrs,
            STATUS="Active", HIRE_DATE=starts[0] if starts else "",
            IS_BETA_GROUP=True,
            DETAILS_CONFIRMED=all(x.get("confirmed") for x in posts) if posts else False,
            CREATED_DATE=TODAY, LAST_MODIFIED=TODAY,
        ))
    return bt, ba, missing


def compute_colleagueships(teachers, assignments, schools):
    """Only pairs that share a country can relate at all, which keeps this tractable."""
    sch = {s["SCHOOL_ID"]: s for s in schools}
    post = collections.defaultdict(list)
    for a in assignments:
        post[a["TEACHER_ID"]].append(a)

    countries_of = {t["TEACHER_ID"]: {sch[a["SCHOOL_ID"]]["COUNTRY"] for a in post[t["TEACHER_ID"]]}
                    for t in teachers}
    by_country = collections.defaultdict(list)
    for tid, cs in countries_of.items():
        for c in cs:
            by_country[c].append(tid)

    cand = set()
    for tids in by_country.values():
        tids = sorted(tids)
        for i in range(len(tids)):
            for j in range(i + 1, len(tids)):
                cand.add((tids[i], tids[j]))

    out = []
    n = 0
    for a_id, b_id in sorted(cand):
        best = None
        for pa in post[a_id]:
            sa = sch[pa["SCHOOL_ID"]]
            for pb in post[b_id]:
                sb = sch[pb["SCHOOL_ID"]]
                r = relate(pa, sa, pb, sb)
                if r and (best is None or r[0] < best[0][0]):
                    best = (r, pa, pb)
        if not best:
            continue
        (deg, ctype, cid, clabel, same), pa, pb = best
        n += 1
        out.append(dict(
            COLLEAGUESHIP_ID=f"COL{n:06d}", TEACHER_A_ID=a_id, TEACHER_B_ID=b_id, DEGREE=deg,
            SHARED_CONTEXT_TYPE=ctype, SHARED_CONTEXT_ID=cid, SHARED_CONTEXT_LABEL=clabel,
            TIME_RELATION="same time" if same else "different time",
            OVERLAP_YEARS=overlap_years(pa, pb) if same else "",
            # Acknowledgement is not something a generator can know. See module docstring.
            VERIFIED="unverified", COMPUTED_AT=TODAY,
        ))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--teachers", type=int, default=1200)
    ap.add_argument("--schools-per-city", type=int, default=3)
    ap.add_argument("--seed", type=int, default=20260912)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rnd = random.Random(args.seed)
    pool = load_school_pool(args.schools_per_city)
    schools = finish_schools(pool, rnd)
    teachers, assignments = make_teachers(args.teachers, schools, rnd)
    bt, ba, missing = add_beta_group(schools, teachers, assignments)
    teachers += bt
    assignments += ba
    cols = compute_colleagueships(teachers, assignments, schools)

    cities = {(s["COUNTRY"], s["CITY"]) for s in schools}
    countries = {s["COUNTRY"] for s in schools}
    percountry = collections.defaultdict(set)
    for c, city in cities:
        percountry[c].add(city)
    multi = sum(1 for v in percountry.values() if len(v) > 1)
    dist = collections.Counter(c["DEGREE"] for c in cols)

    print(f"schools        {len(schools)}")
    print(f"cities         {len(cities)}")
    print(f"countries      {len(countries)}  ({multi} with 2+ cities -> can produce degree 5/6)")
    print(f"teachers       {len(teachers)}  (incl. {len(bt)} beta group)")
    print(f"postings       {len(assignments)}   ({len(assignments)/len(schools):.1f} per school)")
    print(f"colleagueships {len(cols)}")
    tot = sum(dist.values()) or 1
    for g in range(1, 7):
        print(f"   degree {g}: {dist[g]:6}  ({100*dist[g]/tot:4.1f}%)")
    if missing:
        print("\n  !! beta postings whose school was not found:")
        for m in missing:
            print(f"     {m}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    payload = dict(
        generated_at=TODAY,
        counts=dict(schools=len(schools), teachers=len(teachers),
                    assignments=len(assignments), colleagueships=len(cols)),
        schools=schools, teachers=teachers, assignments=assignments, colleagueships=cols,
    )
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"\nwrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
