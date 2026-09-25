"""Build dashboard data from the mentor-app observation exports.

Usage:
    python etl/build.py [raw_dir] [out_dir]

Defaults: raw_dir = data/raw, out_dir = web/public/data

Reads every *.xlsx in raw_dir (one export per month), cleans it and writes
compact JSON for the web app. Personal data not needed by the dashboard
(teacher / mentor mobile numbers, teacher HRMS code, student names, free text)
is dropped here and never reaches the published files.
"""

import difflib
import glob
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORTS_DIR = os.path.join(ROOT, "data", "exports")  # redacted CSVs pushed by the Apps Script exporter
LOCAL_RAW_DIR = os.path.join(ROOT, "data", "raw")  # raw .xlsx downloads (git-ignored), for local runs
RAW_DIR = sys.argv[1] if len(sys.argv) > 1 else (
    EXPORTS_DIR if glob.glob(os.path.join(EXPORTS_DIR, "**", "*.csv*"), recursive=True) else LOCAL_RAW_DIR)
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "web", "public", "data")
TRACKER = os.environ.get("SSP_TRACKER", os.path.join(ROOT, "data", "ssp", "tracker.xlsx"))
# Committed extract of the tracker (programme districts only), used when the
# .xlsx isn't available, e.g. in GitHub Actions.
TRACKER_EXTRACT = os.path.join(ROOT, "data", "ssp", "ssp_schools.csv.gz")

def norm(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(s))).strip()


YES = {unicodedata.normalize("NFC", v) for v in ("हाँ", "हां", "han", "yes", "Yes", "हा")}
NO = {unicodedata.normalize("NFC", v) for v in ("नहीं", "नही", "no", "No")}

# Column positions in the export, with the start of the expected header text.
# The header check makes a changed export fail loudly instead of silently
# mapping answers to the wrong KPI.
COL = {
    "district": (1, "District Name"),
    "block": (2, "Block Name"),
    "area": (3, "AreaType"),
    "school": (4, "School Name"),
    "udise": (5, "Udise Code"),
    "stype": (6, "SchoolType"),
    "mentor": (7, "Mentor Name"),
    "mobile": (8, "Mobile No"),
    "desig": (9, "Designation"),
    "date": (10, "InspectionDate"),
    "time": (11, "TimeSpent"),
    "grade": (13, "Awalokit Kaksha"),
    "subject": (14, "Awalokit Subject"),
    "teacher": (149, "शिक्षक का नाम"),
    "cls_enr": (153, "अवलोकित कक्षा में नामांकित"),
    "cls_pres": (154, "अवलोकित कक्षा में उपस्थित"),
    "stu_enr": (155, "विद्यालय में कुल नामांकित बच्चों"),
    "stu_pres": (158, "विद्यालय में कुल बच्चों की भौतिक"),
    "cwsn_enr": (162, "विद्यालय में कुल दिव्यांग नामांकित बच्चों"),
    "cwsn_pres": (165, "विद्यालय में कुल दिव्यांग बच्चों की भौतिक"),
    "tch_pos": (168, "विद्यालय में कुल कार्यरत (in-position) शिक्षकों"),
    "tch_pres": (171, "विद्यालय में कुल उपस्थित शिक्षकों"),
    "fln_math_marker": (15, "अवलोकन के समय शिक्षक के पास संदर्शिका"),
    "fln_hindi_marker": (61, "शिक्षक के पास कक्षा अवलोकन के दौरान संदर्शिका"),
    "other12_marker": (204, "1. क्या शिक्षक पढ़ाने के लिए शिक्षण योजना"),
}

SUBJECTS = {
    "हिन्दी": "Hindi",
    "गणित": "Maths",
    "अंग्रेजी": "English",
    "विज्ञान": "Science",
    "सामाजिक विषय": "Social Studies",
    "हमारा परिवेश": "EVS",
    "अन्य": "Other",
}


def yes_no(v):
    if v in YES:
        return 1
    if v in NO:
        return 0
    return None


def starts(prefix, na_prefixes=()):
    """1 if the answer starts with prefix, None if it starts with an N/A prefix, else 0."""
    prefix, na_prefixes = norm(prefix), [norm(p) for p in na_prefixes]

    def rule(v):
        if v is None:
            return None
        if any(v.startswith(p) for p in na_prefixes):
            return None
        return 1 if v.startswith(prefix) else 0

    return rule


def any_of(good, na_prefixes=()):
    good, na_prefixes = [norm(g) for g in good], [norm(p) for p in na_prefixes]
    def rule(v):
        if v is None:
            return None
        if any(v.startswith(p) for p in na_prefixes):
            return None
        return 1 if any(v.startswith(g) for g in good) else 0

    return rule


TLM_RULE = any_of(["हाँ, शिक्षण योजना", "शिक्षक द्वारा निर्मित"], na_prefixes=["लागू नहीं"])
NIPUN_TABLE_RULE = lambda v: None if v and v.startswith(norm("विभाग द्वारा")) else yes_no(v)  # noqa: E731

# KPI definitions. FLN KPIs are shared between the Maths and Hindi forms, each
# reading its own column. `cols` maps form -> (column position, header prefix).
KPIS = [
    # ---- FLN classroom (grades 1-3, Hindi & Maths) ----
    dict(id="guide_avail", group="fln", label="Teacher has the Sandarshika (guidebook)",
         cols={"FM": (15, "अवलोकन के समय शिक्षक के पास संदर्शिका"), "FH": (61, "शिक्षक के पास कक्षा अवलोकन के दौरान संदर्शिका")},
         rule=yes_no),
    dict(id="guide_used", group="fln", label="Teacher referred to the Sandarshika while teaching",
         cols={"FM": (42, "शिक्षण कार्य के दौरान शिक्षक ने संदर्शिका"), "FH": (129, "शिक्षण कार्य के दौरान शिक्षक द्वारा संदर्शिका")},
         rule=yes_no),
    dict(id="tlm", group="fln", label="TLM used (planned or teacher-made)",
         cols={"FM": (43, "क्या शिक्षक द्वारा शिक्षण योजना में प्रस्तावित"), "FH": (130, "क्या शिक्षक द्वारा शिक्षण योजना में प्रस्तावित")},
         rule=TLM_RULE),
    dict(id="peer", group="fln", label="Peer learning in pairs / small groups",
         cols={"FM": (46, "शिक्षक द्वारा अवधारणा पर बच्चों की समझ"), "FH": (133, "शिक्षक द्वारा अवधारणा पर बच्चों की समझ")},
         rule=yes_no),
    dict(id="particip", group="fln", label="Most children (>70%) participating",
         cols={"FM": (48, "शिक्षक द्वारा कराई जा रही गतिविधि में"), "FH": (135, "शिक्षक द्वारा कराई जा रही गतिविधि में")},
         rule=starts("अधिकांश")),
    dict(id="diary", group="fln", label="Teacher diary maintained",
         cols={"FM": (47, "क्या अवलोकित कक्षा के शिक्षक द्वारा शिक्षक डायरी"), "FH": (134, "क्या अवलोकित कक्षा के शिक्षक द्वारा शिक्षक डायरी")},
         rule=yes_no),
    dict(id="tracker", group="fln", label="Weekly assessment tracker filled & groups A/B formed",
         cols={"FM": (49, "शिक्षक साप्ताहिक आकलन ट्रैकर"), "FH": (137, "शिक्षक साप्ताहिक आकलन ट्रैकर")},
         rule=starts("1.")),
    dict(id="nipun_table", group="fln", label="NIPUN Talika updated",
         cols={"FM": (50, "क्या शिक्षक ने बच्चों के अधिगम स्तर"), "FH": (136, "क्या शिक्षक बच्चों के अधिगम स्तर")},
         rule=NIPUN_TABLE_RULE),
    dict(id="remedial", group="fln", label="Remedial teaching done with Group A",
         cols={"FM": (51, "पिछले सप्ताह शिक्षक ने सभी बच्चों"), "FH": (138, "पिछले कार्यदिवस में शिक्षक ने समूह A")},
         rule=lambda v: None if v is None else (1 if v in YES else 0)),  # "partial" counts as not done
    dict(id="wb_avail", group="fln", label="Most children have the workbook",
         cols={"FM": (52, "कक्षा में अधिकांश बच्चों के पास कार्यपुस्तिका"), "FH": (139, "कक्षा में अधिकांश बच्चों के पास कार्यपुस्तिका")},
         rule=yes_no),
    dict(id="wb_done", group="fln", label="All children completed last week's worksheets",
         cols={"FM": (54, "बच्चों द्वारा कार्यपुस्तिका के पिछले 1 सप्ताह"), "FH": (141, "बच्चों द्वारा कार्यपुस्तिका के पिछले 1 सप्ताह")},
         rule=starts("सभी")),
    dict(id="wb_checked", group="fln", label="Teacher checked all workbooks for last week",
         cols={"FM": (55, "शिक्षक द्वारा बच्चों की कार्यपुस्तिकाओं"), "FH": (142, "शिक्षक द्वारा बच्चों की कार्यपुस्तिकाओं")},
         rule=starts("सभी")),
    dict(id="fluency", group="fln", label="Oral reading fluency recorded for all children (Hindi)",
         cols={"FH": (143, "क्या पिछले 1 सप्ताह में शिक्षक द्वारा बच्चों की कार्यपुस्तिका के भाग 2")},
         rule=starts("हाँ")),
    dict(id="feedback", group="fln", label="Mentor held feedback session with teacher",
         cols={"FM": (57, "क्या आपने शिक्षक (जिनकी कक्षा का आपने अवलोकन किया है) के साथ फीडबैक"), "FH": (145, "क्या आपने शिक्षक (जिनकी कक्षा का आपने अवलोकन किया है) के साथ फीडबैक")},
         rule=yes_no),
    # ---- Grades 4-8 classroom ----
    dict(id="lp_ready", group="upper", label="Lesson plan prepared for today",
         cols={"G": (185, "क्या शिक्षक द्वारा आज की शिक्षण योजना")}, rule=yes_no),
    dict(id="lp_followed", group="upper", label="Teaching followed the lesson plan",
         cols={"G": (186, "1.1 यदि हाँ")}, rule=yes_no),
    dict(id="lp_lo", group="upper", label="Learning outcomes stated in plan",
         cols={"G": (187, "1.2 क्या शिक्षण योजना में लर्निंग")}, rule=yes_no),
    dict(id="g_tlm", group="upper", label="TLM used during teaching",
         cols={"G": (188, "1.3 क्या शिक्षण-अधिगम सामग्री")}, rule=yes_no),
    dict(id="prior", group="upper", label="Teacher checked prior knowledge",
         cols={"G": (189, "2. क्या शिक्षक पढ़ाए जा रहे")}, rule=yes_no),
    dict(id="activity", group="upper", label="Effective methods / activity-based teaching",
         cols={"G": (192, "4. क्या शिक्षक द्वारा प्रभावी")}, rule=yes_no),
    dict(id="group_work", group="upper", label="Group work with children",
         cols={"G": (194, "5. क्या शिक्षक द्वारा बच्चों के साथ समूह")}, rule=yes_no),
    dict(id="equal_opp", group="upper", label="Equal opportunity for all children",
         cols={"G": (196, "6. क्या शिक्षक सभी बच्चों को")}, rule=yes_no),
    dict(id="check_und", group="upper", label="Teacher checks understanding during class",
         cols={"G": (198, "7. क्या शिक्षक बीच-बीच में")}, rule=yes_no),
    dict(id="learn_level", group="upper", label="Teacher assesses current learning level",
         cols={"G": (202, "9. क्या शिक्षक द्वारा बच्चों के वर्तमान")}, rule=yes_no),
    # ---- School level (every visit) ----
    dict(id="library", group="school", label="Active library in school",
         cols={"*": (174, "क्या विद्यालय में सक्रिय पुस्तकालय")}, rule=yes_no),
    dict(id="timetable", group="school", label="Timetable available and followed",
         cols={"*": (183, "क्या विद्यालय में समय सारणी")}, rule=starts("विद्यालय में समय सारणी उपलब्ध है और")),
    dict(id="syllabus", group="school", label="Monthly syllabus completed (observed class)",
         cols={"*": (184, "क्या पाठ्यपुस्तक के आधार पर मासिक")}, rule=yes_no),
    dict(id="sports", group="school", label="Sports material in use",
         cols={"*": (179, "क्या विद्यालय में छात्रों द्वारा खेल कूद")}, rule=yes_no),
    dict(id="eco_club", group="school", label="Eco & Youth Club formed",
         cols={"*": (180, "क्या विद्यालय में 'इको व यूथ क्लब'")}, rule=yes_no),
]

# KPIs left out of the composite practice scores. Feedback is a mentor action,
# not a classroom practice. "Lesson plan prepared" gates the rest of the Gr 4-8
# form (a "no" skips every other question), so including it would score those
# classrooms 0% - it is reported on its own instead.
SCORE_EXCLUDE = {"feedback", "lp_ready"}


def clean_str(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = norm(v)
    return s or None


def to_int(v):
    s = clean_str(v)
    if s is None:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def parse_minutes(s):
    s = clean_str(s)
    if not s:
        return None
    m = re.match(r"(\d+)\s*minutes?(?:\s*and\s*(\d+)\s*seconds?)?", s)
    if not m:
        return None
    return round(int(m.group(1)) + int(m.group(2) or 0) / 60, 1)


def check_headers(headers, fname):
    specs = list(COL.values()) + [c for k in KPIS for c in k["cols"].values()]
    for pos, prefix in specs:
        h = norm(headers[pos])
        if not h.startswith(norm(prefix)):
            raise SystemExit(f"{fname}: column {pos} is '{h[:60]}', expected it to start with '{prefix}'")


def check_content(d, fname):
    """For files with placeholder headers ("col_0"...), check the data sits where the build expects it."""
    rows = d.iloc[1:301]

    def share(col, pattern):
        vals = rows[col].dropna().astype(str).str.strip()
        vals = vals[vals != ""]
        return vals.str.match(pattern).mean() if len(vals) else 0

    checks = {
        "date (col 10)": share(COL["date"][0], r"\d{1,2}/\d{1,2}/\d{4}$") >= 0.95,
        "grade (col 13)": share(COL["grade"][0], "कक्षा") >= 0.9,
        "designation (col 9)": share(COL["desig"][0], r"(?i).*(ARP|S\s*R\s*G|DIET|Mentor)") >= 0.9,
        "UDISE (col 5)": share(COL["udise"][0], r"\d{10,11}$") >= 0.95,
    }
    failed = [k for k, ok in checks.items() if not ok]
    if failed:
        raise SystemExit(f"{fname}: placeholder headers and unexpected data in {', '.join(failed)}")


def mentor_category(desig):
    d = (desig or "").upper()
    if d.startswith("ARP"):
        return "ARP"
    if "DIET" in d:
        return "DIET Mentor"
    if d.replace(" ", "") == "SRG":
        return "SRG"
    return "Other"


def kpi_char(v):
    # pandas may hand back 1.0 / 0.0 / NaN for the 1 / 0 / None the rules return
    if v is None or pd.isna(v):
        return "-"
    return "1" if v == 1 else "0"


def title(name):
    return " ".join(w.capitalize() for w in name.split())


def district_key(name):
    """'KANPUR NAGAR', 'Kanpur Nagar', 'KANPUR_NAGAR' -> 'KANPURNAGAR'."""
    return re.sub(r"[^A-Z]", "", str(name).upper())


def slug(name):
    return re.sub(r"[^a-z]+", "-", str(name).lower()).strip("-")


def norm_udise(v):
    if not isinstance(v, str):
        return None
    s = re.sub(r"\.0$", "", v.strip())
    return s.zfill(11) if s.isdigit() else None


_DEV_VOWELS = dict(zip("अआइईउऊएऐओऔऋ", ["a", "a", "i", "i", "u", "u", "e", "ai", "o", "au", "ri"]))
_DEV_MATRAS = dict(zip("ािीुूेैोौृ", ["a", "i", "i", "u", "u", "e", "ai", "o", "au", "ri"]))
_DEV_CONS = dict(zip("कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह",
                     "k kh g gh n ch chh j jh n t th d dh n t th d dh n p ph b bh m y r l v sh sh s h".split()))


def devanagari_to_latin(s):
    """Rough transliteration, good enough to match 'गरिमा त्रिपाठी' to 'Garima Tripathi'."""
    out = []
    for i, ch in enumerate(s):
        nxt = s[i + 1] if i + 1 < len(s) else ""
        if ch in _DEV_CONS:
            out.append(_DEV_CONS[ch])
            # inherent 'a' unless a vowel sign / virama follows, or the word ends (schwa deletion)
            if nxt not in _DEV_MATRAS and nxt not in "़्" and nxt.strip() and nxt in _DEV_CONS.keys() | _DEV_VOWELS.keys() | {"ं", "ँ"}:
                out.append("a")
        elif ch in _DEV_MATRAS:
            out.append(_DEV_MATRAS[ch])
        elif ch in _DEV_VOWELS:
            out.append(_DEV_VOWELS[ch])
        elif ch in "ंँ":
            out.append("n")
        elif ch == "ः":
            out.append("h")
        elif ch in "़्":
            continue
        else:
            out.append(ch)
    return "".join(out)


def norm_person(name):
    s = devanagari_to_latin(str(name)).lower()
    s = re.sub(r"\b(dr|mr|mrs|ms|shri|smt)\b\.?", " ", s)
    s = " ".join(re.sub(r"[^a-z ]", " ", s).split())
    # collapse common spelling variants: aa/a, ee/i, oo/u, w/v
    for a, b in (("aa", "a"), ("ee", "i"), ("oo", "u"), ("w", "v")):
        s = s.replace(a, b)
    return s


def load_tracker(path):
    """SSP adoption tracker -> {district_key: {"name", "schools": {udise: {...}}}}.

    Sheet "SSP Adoption" lists every school in UP with adoption flags; one sheet
    per programme district names the ARP who adopted each school. The districts
    in scope are the ones with their own sheet.
    """
    xl = pd.ExcelFile(path)
    master = pd.read_excel(xl, "SSP Adoption", dtype=str)
    master["u"] = master["udise_code"].map(norm_udise)
    master["dk"] = master["district"].map(district_key)
    districts = {}
    for sheet in xl.sheet_names:
        if sheet in ("SSP Adoption", "Mentor_All"):
            continue
        dk = district_key(sheet)
        adopted = pd.read_excel(xl, sheet, dtype=str, usecols=range(4))
        adopted.columns = ["udise_code", "school_name", "mentor_name", "block"]
        adopted = adopted.dropna(subset=["udise_code"])
        adopted["u"] = adopted["udise_code"].map(norm_udise)
        arp_of = {r.u: clean_str(r.mentor_name) for r in adopted.itertuples() if isinstance(r.u, str)}
        schools = {}
        for r in master[master["dk"] == dk].itertuples():
            if not isinstance(r.u, str):
                continue
            schools[r.u] = dict(
                name=title(clean_str(r.school_name) or r.u),
                block=clean_str(r.block),
                ssp=1 if (r.mentor_ssp_adopted == "Yes" or r.u in arp_of) else 0,
                po=1 if r.is_po_ssp_adopted == "Yes" else 0,
                sspArpName=title(arp_of[r.u]) if arp_of.get(r.u) else None,
            )
        # adopted schools missing from the master list still count
        for r in adopted.itertuples():
            if isinstance(r.u, str) and r.u not in schools:
                schools[r.u] = dict(name=title(clean_str(r.school_name) or r.u), block=clean_str(r.block),
                                    ssp=1, po=0, sspArpName=title(arp_of[r.u]) if arp_of.get(r.u) else None)
        districts[dk] = dict(name=title(sheet.strip()), schools=schools)
        print(f"  tracker {sheet}: {len(schools)} schools, {sum(s['ssp'] for s in schools.values())} ARP-adopted")
    return districts


def save_tracker_extract(tracker, path):
    rows = [dict(district_key=dk, district=d["name"], udise=u, name=t["name"], block=t["block"],
                 ssp=t["ssp"], po=t["po"], arp=t.get("sspArpName") or "")
            for dk, d in tracker.items() for u, t in d["schools"].items()]
    pd.DataFrame(rows).to_csv(path, index=False, compression="gzip")


def load_tracker_extract(path):
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    tracker = {}
    for r in df.itertuples():
        d = tracker.setdefault(r.district_key, dict(name=r.district, schools={}))
        d["schools"][r.udise] = dict(name=r.name, block=r.block or None, ssp=int(r.ssp), po=int(r.po), sspArpName=r.arp or None)
    return tracker


def match_mentor(name, candidates, fuzzy=True):
    """Match a tracker ARP name to a mentor id from the visit data. candidates: {id: name}."""
    if not name:
        return None
    target = norm_person(name)
    normed = {i: norm_person(n) for i, n in candidates.items()}
    exact = [i for i, n in normed.items() if n == target]
    if len(exact) == 1:
        return exact[0]
    tset = set(target.split())
    subset = [i for i, n in normed.items() if tset and (tset <= set(n.split()) or set(n.split()) <= tset)]
    if len(subset) == 1:
        return subset[0]
    if not fuzzy:
        return None
    best, best_score = None, 0
    for i, n in normed.items():
        sc = difflib.SequenceMatcher(None, target, n).ratio()
        if sc > best_score:
            best, best_score = i, sc
    return best if best_score >= 0.85 else None


def read_exports(raw_dir):
    """Every .xlsx / .csv under raw_dir, in any folder layout (e.g. 2026/Aug 2026/BASTI.xlsx)."""
    files = sorted(glob.glob(os.path.join(raw_dir, "**", "*.xlsx"), recursive=True)
                   + glob.glob(os.path.join(raw_dir, "**", "*.csv"), recursive=True)
                   + glob.glob(os.path.join(raw_dir, "**", "*.csv.gz"), recursive=True))
    if not files:
        raise SystemExit(f"No .xlsx or .csv exports under {raw_dir}")
    frames = []
    for f in files:
        name = os.path.relpath(f, raw_dir)
        if f.endswith((".csv", ".csv.gz")):
            d = pd.read_csv(f, dtype=str, header=None, encoding="utf-8-sig", keep_default_na=False)
        else:
            d = pd.read_excel(f, dtype=str, header=None)
        if len(d) < 2:
            continue
        headers = list(d.iloc[0])
        if all(str(h).strip() == f"col_{i}" for i, h in enumerate(headers[:208])):
            check_content(d, name)  # 2025 backfill files have placeholder headers
        else:
            check_headers(headers, name)
        frames.append(d.iloc[1:, :208].reset_index(drop=True))
    raw = pd.concat(frames, ignore_index=True)
    print(f"  read {len(files)} files, {len(raw)} rows")
    raw = raw.map(clean_str)
    return raw.astype(object).where(raw.notna(), None)  # blanks as None, not NaN


def match_adopting_arps(schools, mentors, visit_udise, visit_mentor):
    """Set school["sspArp"] (a mentor id) for every adopted school.

    The tracker names each school's ARP in free text: spellings vary, some are
    initials or in Hindi, and two different ARPs can share a name in different
    blocks. So an adopting ARP is identified by (name, block), and matched by:
      1. exact / near-exact name among the ARPs working in that block,
      2. else whoever made most (>= 50%, >= 3) of the ARP visits to those schools,
      3. else a fuzzy name match anywhere in the district, if that ARP visited
         at least one of the schools.
    """
    arps = [m for m in mentors if m["category"] == "ARP"]
    bkey = lambda b: re.sub(r"\W", "", str(b or "").lower())
    visits = pd.DataFrame({"u": visit_udise, "m": visit_mentor})
    visits = visits[visits["m"].isin({m["id"] for m in arps})]
    groups = {}
    for s in schools:
        if s.get("ssp") and s.get("sspArpName"):
            groups.setdefault((s["sspArpName"], bkey(s["block"])), []).append(s)
    claimed = {}
    for (name, blk), group in sorted(groups.items()):
        adopted = {s["udise"] for s in group}
        counts = visits[visits["u"].isin(adopted)]["m"].value_counts()
        in_block = {m["id"]: m["name"] for m in arps if bkey(m["block"]) == blk}
        mid, how = match_mentor(name, in_block, fuzzy=False), "name"
        if mid is None and len(counts) and counts.iat[0] >= 3 and counts.iat[0] / counts.sum() >= 0.5:
            mid, how = int(counts.index[0]), f"visits {counts.iat[0]}/{counts.sum()}"
        if mid is None:
            cand = match_mentor(name, {m["id"]: m["name"] for m in arps})
            if cand is not None and cand in counts.index:
                mid, how = cand, "fuzzy name + visits"
        if mid is None:
            print(f"    WARNING: adopting ARP '{name}' ({group[0]['block']}) not found in visit data")
            continue
        for s in group:
            s["sspArp"] = mid
        if how != "name":
            print(f"    matched '{name}' ({group[0]['block']}) -> '{mentors[mid]['name']}' by {how}")
        claimed.setdefault(mid, []).append(name)
    for mid, names in claimed.items():
        if len(names) > 1:
            print(f"    NOTE: {names} all matched to '{mentors[mid]['name']}' - check the tracker")


def build_district(raw, tracked):
    """One district's visits + its tracker schools -> the district payload."""

    def col(key):
        return raw[COL[key][0]]

    # Monthly exports can repeat rows at month boundaries; drop exact duplicates (ignoring S.No.).
    raw = raw.drop_duplicates(subset=[c for c in raw.columns if c != 0]).reset_index(drop=True)

    udise = col("udise").fillna("").str.zfill(11)  # some exports lost the leading zero
    dates = pd.to_datetime(col("date"), format="%d/%m/%Y", errors="coerce")
    bad = int(dates.isna().sum())
    if bad:
        print(f"    WARNING: {bad} rows with unparseable dates dropped")

    form = pd.Series("O", index=raw.index)  # grade 1-3 other subjects, or unknown
    form[raw[COL["fln_math_marker"][0]].notna()] = "FM"
    form[raw[COL["fln_hindi_marker"][0]].notna()] = "FH"
    grade_num = col("grade").str.extract(r"(\d)")[0].astype("float")
    general = form.eq("O") & raw[COL["other12_marker"][0]].isna() & grade_num.ge(3)
    form[general] = "G"

    # ---- Mentors: keyed by mobile number (names are spelled inconsistently) ----
    mob = col("mobile").fillna("unknown")
    mentor_rows = pd.DataFrame({"mob": mob, "name": col("mentor"), "desig": col("desig"), "block": col("block")})
    mentors = []
    mentor_id = {}
    # Order by visits, then name, so IDs don't depend on the (hashed) mobile number.
    for i, (m, g) in enumerate(sorted(mentor_rows.groupby("mob"), key=lambda x: (-len(x[1]), x[1]["name"].mode().iat[0]))):
        mentor_id[m] = i
        desig = g["desig"].mode().iat[0]
        mentors.append(dict(
            id=i,
            name=title(g["name"].mode().iat[0]),
            designation=desig,
            category=mentor_category(desig),
            block=g["block"].mode().iat[0],
        ))

    # ---- Schools: every tracker school in the district, plus any other visited school ----
    visited = pd.DataFrame({"u": udise, "name": col("school"), "block": col("block"), "type": col("stype"), "area": col("area")})
    visit_info = {}
    for u, g in visited.groupby("u"):
        t = g["type"].mode()
        visit_info[u] = dict(
            name=title(g["name"].mode().iat[0]), block=g["block"].mode().iat[0],
            type={"PS": "PS", "Ups": "UPS", "Composite": "Composite"}.get(t.iat[0], t.iat[0]) if len(t) else None,
            area="Urban" if g["area"].mode().iat[0] == "U" else "Rural",
        )
    # Tracker block spellings differ in case/spacing; map them onto the visit data's spelling.
    block_names = {re.sub(r"\W", "", b.lower()): b for b in visited["block"].dropna().unique()}

    schools = []
    school_id = {}
    for i, u in enumerate(sorted(set(visit_info) | set(tracked))):
        v, t = visit_info.get(u), tracked.get(u, {})
        tb = t.get("block") or ""
        block = v["block"] if v else block_names.get(re.sub(r"\W", "", tb.lower()), title(tb or "Unknown"))
        s = dict(id=i, udise=u, name=v["name"] if v else t.get("name", u), block=block,
                 type=v["type"] if v else None, area=v["area"] if v else None,
                 ssp=t.get("ssp", 0), po=t.get("po", 0))
        if s["ssp"]:
            s["sspArpName"] = t.get("sspArpName")
            s["sspArp"] = None
        school_id[u] = i
        schools.append(s)
    match_adopting_arps(schools, mentors, udise, mob.map(mentor_id))

    # ---- KPI values per observation ----
    kpi_vals = {}
    for k in KPIS:
        vals = pd.Series([None] * len(raw), index=raw.index, dtype="object")
        for f_key, (pos, _) in k["cols"].items():
            mask = pd.Series(True, index=raw.index) if f_key == "*" else form.eq(f_key)
            vals[mask] = raw.loc[mask, pos].map(lambda v: k["rule"](None if pd.isna(v) else v))
        kpi_vals[k["id"]] = vals

    subj_codes = list(SUBJECTS.values())
    # Sorted, so the output doesn't depend on the order files were read in.
    teachers = sorted({title(t) for t in col("teacher").dropna()})
    teacher_id = {t: i for i, t in enumerate(teachers)}
    visits = []
    for idx in raw.index:
        if pd.isna(dates[idx]):
            continue
        g = grade_num[idx]
        subj = SUBJECTS.get(raw.at[idx, COL["subject"][0]])
        tname = raw.at[idx, COL["teacher"][0]]
        if tname:
            tname = title(tname)
        kpi_str = "".join(kpi_char(kpi_vals[k["id"]][idx]) for k in KPIS)
        assert len(kpi_str) == len(KPIS)
        visits.append([
            dates[idx].strftime("%Y-%m-%d"),
            mentor_id[mob[idx]],
            school_id[udise[idx]],
            None if pd.isna(g) else int(g),
            None if subj is None else subj_codes.index(subj),
            form[idx],
            parse_minutes(raw.at[idx, COL["time"][0]]),
        ] + [to_int(raw.at[idx, COL[c][0]]) for c in
             ["cls_enr", "cls_pres", "stu_enr", "stu_pres", "tch_pos", "tch_pres", "cwsn_enr", "cwsn_pres"]] + [
            teacher_id[tname] if tname else None,
            kpi_str,
        ])
    visits.sort(key=lambda r: (r[0], r[1]))
    return dict(mentors=mentors, schools=schools, teachers=teachers, visits=visits)


# Compact row layout: teacher names are interned into a list, and all KPI
# answers for a visit are packed into one string ("1" yes, "0" no, "-" n/a)
# in the order of meta.kpis.
VISIT_FIELDS = ["date", "mentor", "school", "grade", "subject", "form", "minutes",
                "cls_enr", "cls_pres", "stu_enr", "stu_pres", "tch_pos", "tch_pres", "cwsn_enr", "cwsn_pres",
                "teacher", "kpis"]


def main():
    if os.path.exists(TRACKER):
        tracker = load_tracker(TRACKER)
        save_tracker_extract(tracker, TRACKER_EXTRACT)
    elif os.path.exists(TRACKER_EXTRACT):
        tracker = load_tracker_extract(TRACKER_EXTRACT)
        print(f"  tracker: {TRACKER_EXTRACT} ({sum(len(d['schools']) for d in tracker.values())} schools)")
    else:
        tracker = {}
    print(f"  exports: {RAW_DIR}")
    if not tracker:
        print(f"  WARNING: no SSP tracker at {TRACKER}; building every district without SSP data")
    raw = read_exports(RAW_DIR)
    dkeys = raw[COL["district"][0]].map(district_key)

    wanted = list(tracker) if tracker else sorted(dkeys.dropna().unique())
    out_dir = os.path.join(OUT_DIR, "districts")
    os.makedirs(out_dir, exist_ok=True)
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    index = []
    for dk in wanted:
        part = raw[dkeys == dk].reset_index(drop=True)
        tracked = tracker[dk]["schools"] if dk in tracker else {}
        name = tracker[dk]["name"] if dk in tracker else title(part[COL["district"][0]].mode().iat[0])
        print(f"  {name}: {len(part)} rows")
        if len(part):
            built = build_district(part, tracked)
        else:  # no visit data yet: still publish the school list
            built = dict(mentors=[], teachers=[], visits=[], schools=[
                dict(id=i, udise=u, name=t["name"], block=title(t["block"] or "Unknown"), type=None, area=None,
                     ssp=t["ssp"], po=t["po"], **({"sspArpName": t["sspArpName"], "sspArp": None} if t["ssp"] else {}))
                for i, (u, t) in enumerate(sorted(tracked.items()))])
        v = built["visits"]
        meta = dict(
            generatedAt=generated,
            district=name,
            dateFrom=v[0][0] if v else None,
            dateTo=v[-1][0] if v else None,
            arpMonthlyTarget=30,
            sspFrom="2026-04",
            subjects=list(SUBJECTS.values()),
            forms={"FM": "FLN Maths (Gr 1-3)", "FH": "FLN Hindi (Gr 1-3)", "G": "Grades 4-8", "O": "Gr 1-3 other subjects"},
            kpis=[dict(id=k["id"], group=k["group"], label=k["label"], forms=list(k["cols"].keys()),
                       inScore=k["group"] in ("fln", "upper") and k["id"] not in SCORE_EXCLUDE) for k in KPIS],
            visitFields=VISIT_FIELDS,
        )
        fname = f"{slug(name)}.json"
        with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as fh:
            json.dump(dict(meta=meta, **built), fh, ensure_ascii=False, separators=(",", ":"))
        ssp = [s for s in built["schools"] if s.get("ssp")]
        index.append(dict(
            slug=slug(name), name=name, file=f"districts/{fname}", visits=len(v),
            schools=len(built["schools"]), sspSchools=len(ssp),
            sspArps=len({s.get("sspArpName") for s in ssp if s.get("sspArpName")}),
            dateTo=meta["dateTo"],
        ))
        print(f"    -> {fname}: {len(v)} visits, {len(built['mentors'])} mentors, "
              f"{len(built['schools'])} schools, {len(ssp)} SSP")
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(dict(generatedAt=generated, districts=index), fh, ensure_ascii=False, indent=1)
    old = os.path.join(OUT_DIR, "dashboard.json")
    if os.path.exists(old):
        os.remove(old)


if __name__ == "__main__":
    main()
