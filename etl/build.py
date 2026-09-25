"""Build dashboard data from the mentor-app observation exports.

Usage:
    python etl/build.py [raw_dir] [out_dir]

Defaults: raw_dir = data/raw, out_dir = web/public/data

Reads every *.xlsx in raw_dir (one export per month), cleans it and writes
compact JSON for the web app. Personal data not needed by the dashboard
(teacher / mentor mobile numbers, teacher HRMS code, student names, free text)
is dropped here and never reaches the published files.
"""

import glob
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw")
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "web", "public", "data")

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


def main():
    files = sorted(glob.glob(os.path.join(RAW_DIR, "*.xlsx")))
    if not files:
        raise SystemExit(f"No .xlsx files in {RAW_DIR}")

    frames = []
    for f in files:
        d = pd.read_excel(f, dtype=str, header=None)
        headers = list(d.iloc[0])
        check_headers(headers, os.path.basename(f))
        d = d.iloc[1:].reset_index(drop=True)
        d["_file"] = os.path.basename(f)
        frames.append(d)
        print(f"  {os.path.basename(f)}: {len(d)} rows")
    raw = pd.concat(frames, ignore_index=True)
    raw = raw.map(clean_str)
    raw = raw.astype(object).where(raw.notna(), None)  # blanks as None, not NaN

    def col(key):
        return raw[COL[key][0]]

    # Several monthly exports repeat rows at month boundaries; drop exact duplicates.
    before = len(raw)
    raw = raw.drop_duplicates(subset=[c for c in raw.columns if c not in ("_file", 0)]).reset_index(drop=True)
    if len(raw) != before:
        print(f"  dropped {before - len(raw)} duplicate rows")

    udise = col("udise").fillna("").str.zfill(11)  # some exports lost the leading zero
    dates = pd.to_datetime(col("date"), format="%d/%m/%Y", errors="coerce")
    bad = dates.isna().sum()
    if bad:
        print(f"  WARNING: {bad} rows with unparseable dates dropped")

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
    for i, (m, g) in enumerate(sorted(mentor_rows.groupby("mob"), key=lambda x: -len(x[1]))):
        mentor_id[m] = i
        desig = g["desig"].mode().iat[0]
        mentors.append(dict(
            id=i,
            name=title(g["name"].mode().iat[0]),
            designation=desig,
            category=mentor_category(desig),
            block=g["block"].mode().iat[0],
        ))

    # ---- Schools: keyed by UDISE ----
    school_rows = pd.DataFrame({"u": udise, "name": col("school"), "block": col("block"), "type": col("stype"), "area": col("area")})
    schools = []
    school_id = {}
    for i, (u, g) in enumerate(sorted(school_rows.groupby("u"), key=lambda x: x[0])):
        school_id[u] = i
        schools.append(dict(
            id=i, udise=u, name=title(g["name"].mode().iat[0]), block=g["block"].mode().iat[0],
            type={"PS": "PS", "Ups": "UPS", "Composite": "Composite"}.get(g["type"].mode().iat[0], g["type"].mode().iat[0]),
            area="Urban" if g["area"].mode().iat[0] == "U" else "Rural",
        ))

    # ---- KPI values per observation ----
    kpi_vals = {}
    for k in KPIS:
        vals = pd.Series([None] * len(raw), index=raw.index, dtype="object")
        for f_key, (pos, _) in k["cols"].items():
            mask = pd.Series(True, index=raw.index) if f_key == "*" else form.eq(f_key)
            vals[mask] = raw.loc[mask, pos].map(lambda v: k["rule"](None if pd.isna(v) else v))
        kpi_vals[k["id"]] = vals

    subj_codes = list(SUBJECTS.values())
    # Compact row layout: teacher names are interned into a list, and all KPI
    # answers for a visit are packed into one string ("1" yes, "0" no, "-" n/a)
    # in the order of meta.kpis.
    visit_fields = ["date", "mentor", "school", "grade", "subject", "form", "minutes",
                    "cls_enr", "cls_pres", "stu_enr", "stu_pres", "tch_pos", "tch_pres", "cwsn_enr", "cwsn_pres",
                    "teacher", "kpis"]
    teachers, teacher_id = [], {}
    visits = []
    for idx in raw.index:
        if pd.isna(dates[idx]):
            continue
        g = grade_num[idx]
        subj = SUBJECTS.get(raw.at[idx, COL["subject"][0]])
        tname = raw.at[idx, COL["teacher"][0]]
        if tname:
            tname = title(tname)
            if tname not in teacher_id:
                teacher_id[tname] = len(teachers)
                teachers.append(tname)
        kpi_str = "".join(kpi_char(kpi_vals[k["id"]][idx]) for k in KPIS)
        assert len(kpi_str) == len(KPIS)
        row = [
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
        ]
        visits.append(row)
    visits.sort(key=lambda r: (r[0], r[1]))

    meta = dict(
        generatedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        district=title(col("district").mode().iat[0]),
        sourceFiles=[os.path.basename(f) for f in files],
        dateFrom=visits[0][0],
        dateTo=visits[-1][0],
        arpMonthlyTarget=30,
        subjects=subj_codes,
        forms={"FM": "FLN Maths (Gr 1-3)", "FH": "FLN Hindi (Gr 1-3)", "G": "Grades 4-8", "O": "Gr 1-3 other subjects"},
        kpis=[dict(id=k["id"], group=k["group"], label=k["label"], forms=list(k["cols"].keys()),
                   inScore=k["group"] in ("fln", "upper") and k["id"] not in SCORE_EXCLUDE) for k in KPIS],
        visitFields=visit_fields,
    )

    os.makedirs(OUT_DIR, exist_ok=True)
    payload = dict(meta=meta, mentors=mentors, schools=schools, teachers=teachers, visits=visits)
    out = os.path.join(OUT_DIR, "dashboard.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {out}: {len(visits)} visits, {len(mentors)} mentors, {len(schools)} schools, "
          f"{os.path.getsize(out) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
