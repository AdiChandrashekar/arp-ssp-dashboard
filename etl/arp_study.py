"""Build the ARP form-filling study data from the redacted monthly exports.

Usage:
    python etl/arp_study.py [exports_dir] [out_file]

Defaults: exports_dir = data/exports, out_file = web/public/study/data.json

Profiles how each ARP fills in the classroom-observation form, item by item:
how often they mark each practice as seen (against the average for the same
form, grade and month, so grade mix doesn't count), how much their answers
vary between classrooms, how often they use the in-between options, how
often they end the Grade 4-8 form at "no lesson plan", what they record for
attendance, and whether school facts stay the same when they return to a
school. ARPs are then sorted into three recording styles with published rules.
"""

import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402  (shares the export reader and column checks)

ROOT = build.ROOT
EXPORTS = sys.argv[1] if len(sys.argv) > 1 else build.EXPORTS_DIR
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "web", "public", "study", "data.json")
SPOT = os.path.join(ROOT, "data", "spot", "spot.csv.gz")
LEVELS = ["saksham", "madhyam", "pragatisheel", "zero"]

YES = {"हाँ", "हां"}
MIN_VISITS, MIN_FLN = 60, 30

# Items: id, label, group, (Maths column, Hindi column) or column, answer -> value rule.
# Graded answers score the top option 1, in-between options between 0 and 1.
FLN_ITEMS = [
    ("guide_avail", "Teacher has the Sandarshika", (15, 61), "yn"),
    ("guide_used", "Teacher referred to the Sandarshika", (42, 129), "yn"),
    ("tlm", "Teaching material used", (43, 130), [("हाँ", 1), ("शिक्षक द्वारा", 1), ("नहीं", 0)]),
    ("peer", "Peer learning in pairs or groups", (46, 133), "yn"),
    ("diary", "Teacher diary filled", (47, 134), "yn"),
    ("particip", "Most children participating", (48, 135), [("अधिकांश", 1), ("कुछ", .5), ("बहुत कम", 0), ("शिक्षक ने", 0)]),
    ("tracker", "Weekly assessment tracker filled", (49, 137), [("1.", 1), ("2.", .67), ("3.", .33), ("4.", 0)]),
    ("nipun", "NIPUN Talika updated", (50, 136), [("हाँ", 1), ("नहीं", 0)]),
    ("remedial", "Remedial work with Group A", (51, 138), [("हाँ", 1), ("आंशिक", .5), ("नहीं", 0)]),
    ("wb_avail", "Most children have workbooks", (52, 139), "yn"),
    ("wb_done", "All children did last week's worksheets", (54, 141), [("सभी", 1), ("कुछ", .5), ("किसी", 0)]),
    ("wb_checked", "Teacher checked all workbooks", (55, 142), [("सभी", 1), ("कुछ", .5), ("किसी", 0)]),
    ("fluency", "Reading fluency recorded (Hindi only)", (None, 143), [("हाँ", 1), ("शिक्षक ने कुछ", .5), ("नहीं", 0)]),
]
GRADED = ["particip", "tracker", "remedial", "wb_done", "wb_checked", "fluency"]
G_ITEMS = [
    ("lp_ready", "Lesson plan ready (“no” ends the form)", 185), ("lp_followed", "Teaching followed the plan", 186),
    ("lp_lo", "Learning outcomes in the plan", 187), ("g_tlm", "Teaching material used", 188),
    ("prior", "Checked prior knowledge", 189), ("activity", "Effective methods used", 192),
    ("group_work", "Group work", 194), ("equal_opp", "All children given a chance", 196),
    ("check_und", "Checked understanding during class", 198), ("learn_level", "Assessed children's learning level", 202),
]
FACT_ITEMS = [("library", "Active library", 174), ("sports", "Children use sports material", 179),
              ("eco", "Eco & Youth Club formed", 180), ("timetable", "Timetable made and followed", 183),
              ("syllabus", "Monthly syllabus on track", 184)]
NUMS = dict(cls_enr=153, cls_pres=154, enr=155, pres=158, tpos=168, tpres=171)

# Recording styles, applied in order, on answer variety alone: the one trait that
# is both very stable for an ARP and about the ARP rather than their schools.
# Other behaviours are shown as markers (BADGES), not styles.
LOW_VARIETY, HIGH_VARIETY = 0.35, 0.65
TYPES = [
    dict(id="uniform", label="Uniform",
         rule=f"Near-identical Grade 1–3 FLN forms: answer variety below {LOW_VARIETY}"),
    dict(id="mixed", label="Mixed", rule=f"Answer variety between {LOW_VARIETY} and {HIGH_VARIETY}"),
    dict(id="varied", label="Varied",
         rule=f"Answer variety of {HIGH_VARIETY} or more: answers change from classroom to classroom"),
    dict(id="few", label="Too little data", rule=f"Fewer than {MIN_VISITS} visits or {MIN_FLN} Grade 1–3 FLN forms"),
]
BADGES = [
    dict(id="gate", label="Ends most Grade 4–8 forms at “no lesson plan”", metric="noPlan", op=">=", value=0.5),
    dict(id="nopartial", label="Almost never uses in-between answers", metric="partial", op="<", value=0.05),
    dict(id="allpresent", label="Marks every teacher present on 85%+ of visits", metric="allPresent", op=">=", value=0.85),
    dict(id="contra", label="Contradicts an earlier answer 40%+ of the time it could", metric="contradictions", op=">=", value=0.4),
    dict(id="factflip", label="Changes fixed school facts on 15%+ of revisits", metric="factFlip", op=">=", value=0.15),
    dict(id="repeat", label="Returns to the same teachers on 35%+ of visits", metric="teacherRepeat", op=">=", value=0.35),
    dict(id="allsaksham", label="Marks every child Saksham in 35%+ of spot tests", metric="spotAllSaksham", op=">=", value=0.35),
    dict(id="over5", label="Tests more than 5 children in 25%+ of spot tests", metric="spotOver5", op=">=", value=0.25),
    dict(id="early", label="Two-thirds or more of FLN observations in the first period", metric="firstPeriod", op=">=", value=0.67),
]


def rule_fn(spec):
    if spec == "yn":
        return lambda v: 1.0 if v in YES else (0.0 if isinstance(v, str) and v.startswith("नहीं") else np.nan)

    def f(v):
        if not isinstance(v, str):
            return np.nan
        for pre, val in spec:
            if v.startswith(pre):
                return float(val)
        return np.nan  # e.g. "not applicable"
    return f


def frame(raw):
    raw = raw.drop_duplicates(subset=[c for c in raw.columns if c != 0]).reset_index(drop=True)
    num = lambda c: pd.to_numeric(raw[c], errors="coerce")  # noqa: E731
    d = pd.DataFrame({
        "district": raw[1].map(lambda s: build.title(s) if isinstance(s, str) else s),
        "block": raw[2], "udise": raw[5].fillna("").str.zfill(11), "name": raw[7], "mob": raw[8],
        "desig": raw[9].fillna(""), "date": pd.to_datetime(raw[10], format="%d/%m/%Y", errors="coerce"),
        "grade": raw[13].str.extract(r"(\d)")[0].astype(float), "teacher": raw[149],
        "minutes": raw[11].str.extract(r"(\d+)\s*minutes?")[0].astype(float),
    })
    d = d[d.date.notna()]
    raw = raw.loc[d.index]
    d["arp"] = d.desig.str.upper().str.startswith("ARP")
    d["mkey"] = d.district + "|" + d.mob.fillna("?")
    d["skey"] = d.district + "|" + d.udise
    d["month"] = d.date.dt.strftime("%Y-%m")
    d["form"] = np.where(raw[15].notna(), "FM", np.where(raw[61].notna(), "FH",
                np.where(raw[204].isna() & (d.grade >= 3), "G", "O")))
    yn = rule_fn("yn")
    for k, _, (cm, ch), spec in FLN_ITEMS:
        f = rule_fn(spec)
        m = raw[cm].map(f) if cm is not None else np.nan
        d[k] = np.where(d.form == "FM", m, np.where(d.form == "FH", raw[ch].map(f), np.nan))
    for k, _, c in G_ITEMS:
        d[k] = np.where(d.form == "G", raw[c].map(yn), np.nan)
    for k, _, c in FACT_ITEMS:
        f = (lambda v: np.nan if not isinstance(v, str) else float("और उसके" in v)) if k == "timetable" else yn
        d[k] = raw[c].map(f)
    d["feedback"] = np.where(d.form == "FM", raw[57].map(yn), np.where(d.form == "FH", raw[145].map(yn), np.nan))
    for k, c in NUMS.items():
        d[k] = num(c)
    d["all_present"] = (d.tpres == d.tpos).astype(float).where(d.tpos > 0)
    d["class_full"] = (d.cls_pres == d.cls_enr).astype(float).where(d.cls_enr > 0)
    d["round5"] = (d.pres % 5 == 0).astype(float).where(d.pres > 0)
    # Sandarshika week marked "other" (only asked when the teacher has the Sandarshika).
    week = pd.Series(np.where(d.form == "FM", raw[17], np.where(d.form == "FH", raw[63], None)), index=d.index)
    d["week_other"] = week.map(lambda v: float(v.startswith("अन्य")) if isinstance(v, str) else np.nan)
    # Lesson period the observation fell in (Hindi and Maths forms record it).
    period = pd.Series(np.where(d.form == "FM", raw[19], np.where(d.form == "FH", raw[65], None)), index=d.index)
    d["first_period"] = period.map(lambda v: float(v.strip().endswith("1")) if isinstance(v, str) else np.nan)
    # Designation of the teacher observed.
    desig = raw[151]
    d["head_teacher"] = desig.map(lambda v: float(v.startswith("प्रधान")) if isinstance(v, str) else np.nan)
    d["shiksha_mitra"] = desig.map(lambda v: float(v.startswith("शिक्षा")) if isinstance(v, str) else np.nan)
    return d


def spot_summary(spot, sg, P):
    """System-wide spot-assessment figures for the spot page."""
    tot = lambda x: [int(x.assessed.sum())] + [int(x[k].sum()) for k in LEVELS]  # noqa: E731
    by_month = [[m] + tot(x) + [int(len(x))] for m, x in sg.groupby("month")]
    names = {build.district_key(n): n for n in P.district.dropna().unique()}
    by_dist = {names.get(dk, dk): {m: r3(x.saksham.sum() / x.assessed.sum()) for m, x in g.groupby("month")}
               for dk, g in sg.groupby("district_key")}
    cls = spot[spot.cls.notna()]
    by_class = {int(c): tot(x) for c, x in cls.groupby("cls")}
    # Does a school's result carry over to the next month? Same scale only (April 2026 on).
    s = sg[sg.month >= "2026-04"].sort_values(["skey2", "month"]).copy()
    s["prev"] = s.groupby("skey2").saksham_s.shift()
    s["prev_m"] = s.groupby("skey2").mkey.shift()
    k = s.dropna(subset=["prev", "mkey", "prev_m"])
    same, diff = k[k.mkey == k.prev_m], k[k.mkey != k.prev_m]
    rng = np.random.default_rng(5)
    x = sg.dropna(subset=["mkey"]).copy()
    halves = {u: rng.integers(2) for u in x.skey2.unique()}
    x["h"] = x.skey2.map(halves)
    rel = {}
    for col, key in [("saksham_s", "spotSaksham"), ("sak_vs_block", "spotVsBlock"), ("all_sak", "spotAllSaksham"), ("over5", "spotOver5")]:
        hh = x.groupby(["mkey", "h"])[col].agg(["mean", "count"]).unstack()
        hh = hh[(hh["count"] >= 10).all(axis=1)]
        rel[key] = r3(hh["mean"][0].corr(hh["mean"][1]), 2)
    typed = P[P.type != "few"]
    return dict(
        byMonth=by_month, byDistrict=by_dist, byClass=by_class,
        schoolMonths=int(len(sg)), children=int(sg.assessed.sum()), attributed=r3(sg.mkey.notna().mean()),
        assessed5=r3((sg.assessed == 5).mean()),
        carryOver=dict(sameArp=r3(same.saksham_s.corr(same.prev), 2), otherArp=r3(diff.saksham_s.corr(diff.prev), 2), pairs=int(len(k))),
        reliability=rel,
        corr=dict(allSak_flnLean=r3(typed.spotAllSaksham.corr(typed.flnLean), 2), allSak_variety=r3(typed.spotAllSaksham.corr(typed.variety), 2),
                  vsBlock_flnLean=r3(typed.spotVsBlock.corr(typed.flnLean), 2)),
    )


def r3(x, n=3):
    return None if x is None or pd.isna(x) else round(float(x), n)


def main():
    raw, _ = build.read_exports(EXPORTS)
    d = frame(raw)
    fln_ids = [i[0] for i in FLN_ITEMS]
    g_ids = [i[0] for i in G_ITEMS]
    g_core = g_ids[1:]
    fact_ids = [i[0] for i in FACT_ITEMS]
    fl = d.form.isin(["FM", "FH"]) & d.grade.isin([1, 2, 3])
    gf = d.form == "G"

    # Lean: the answer minus the average answer on the same form, grade and month (all raters).
    for ids, mask, col in ((fln_ids, fl, "fln_lean"), (g_core, gf & (d.lp_ready == 1), "g_lean")):
        sub = d[mask]
        res = pd.DataFrame({k: sub[k] - sub.groupby(["form", "grade", "month"])[k].transform("mean") for k in ids})
        d.loc[mask, col] = res.mean(axis=1)
    d["fln_max"] = np.where(fl, (d[fln_ids].fillna(1) >= 1).all(axis=1), np.nan)
    d["g_max"] = np.where(gf & (d.lp_ready == 1), (d[g_core].fillna(1) >= 1).all(axis=1), np.nan)
    gr = [k for k in GRADED]
    d["partial"] = d[gr].apply(lambda s: s.between(0.01, 0.99)).sum(axis=1) / d[gr].notna().sum(axis=1).replace(0, np.nan)
    d.loc[~fl, "partial"] = np.nan
    d["tkey"] = d.skey + "|" + d.teacher.fillna("").str.lower().str.replace(r"\s+", "", regex=True)
    d = d.sort_values(["mkey", "date"])
    d["seen_teacher"] = (d.groupby(["mkey", "tkey"]).cumcount() > 0).astype(float)

    # Contradictions on FLN forms: an answer the earlier answer rules out.
    cpre = {"guide": (d.guide_avail == 0), "nipun": (d.tracker == 0), "remedial": (d.tracker == 0), "wb": (d.wb_done == 0)}
    chit = {"guide": cpre["guide"] & (d.guide_used == 1), "nipun": cpre["nipun"] & (d.nipun == 1),
            "remedial": cpre["remedial"] & (d.remedial == 1), "wb": cpre["wb"] & (d.wb_checked == 1)}
    d["contra_pre"] = np.where(fl, sum(v.astype(int) for v in cpre.values()), np.nan)
    d["contra_hit"] = np.where(fl, sum(v.astype(int) for v in chit.values()), np.nan)

    # Revisits by the same rater to the same school, 14-180 days apart: do fixed school facts stay put?
    v = d.sort_values(["mkey", "skey", "date"])
    g = v.groupby(["mkey", "skey"])
    gap = (v.date - g.date.shift()).dt.days
    rv = v[gap.between(14, 180)].copy()
    for k in fact_ids[:4]:
        rv["flip_" + k] = (rv[k] != g[k].shift().loc[rv.index]).astype(float).where(rv[k].notna() & g[k].shift().loc[rv.index].notna())
    rv["enr_same"] = (rv.enr == g.enr.shift().loc[rv.index]).astype(float)

    a = d[d.arp]
    af = a[fl.loc[a.index]]
    G = a.groupby("mkey")
    P = pd.DataFrame({
        "name": G.name.agg(lambda s: build.title(s.mode().iat[0])), "district": G.district.first(),
        "block": G.block.agg(lambda s: s.mode().iat[0]), "visits": G.size(), "months": G.month.nunique(),
        "flnForms": af.groupby("mkey").size(),
    })
    pm = a.groupby(["mkey", "month"]).size()
    P["visitsPerMonth"] = pm.groupby("mkey").mean()
    P["targetShare"] = (pm >= 30).groupby("mkey").mean()
    p = af.groupby("mkey")[fln_ids[:-1]].mean()
    P["variety"] = (4 * p * (1 - p)).clip(0, 1).mean(axis=1)
    P["flnLean"] = af.groupby("mkey").fln_lean.mean()
    P["flnAllYes"] = af.groupby("mkey").fln_max.mean()
    P["partial"] = af.groupby("mkey").partial.mean()
    ag = a[a.form == "G"]
    P["noPlan"] = ag.groupby("mkey").lp_ready.apply(lambda s: (s == 0).mean())
    P["gAllYes"] = ag[ag.lp_ready == 1].groupby("mkey").g_max.mean()
    P["gLean"] = ag.groupby("mkey").g_lean.mean()
    P["allPresent"] = G.all_present.mean()
    P["classFull"] = G.class_full.mean()
    P["round5"] = G.round5.mean()
    P["minutes"] = G.minutes.median()
    P["feedbackNo"] = G.feedback.apply(lambda s: (s == 0).sum() / max(s.notna().sum(), 1))
    P["teacherRepeat"] = G.seen_teacher.mean()
    P["schools"] = G.skey.nunique()
    P["flnShare"] = G.form.apply(lambda s: s.isin(["FM", "FH"]).mean())
    P["hindiShare"] = af.groupby("mkey").form.apply(lambda s: (s == "FH").mean())
    P["grade1Share"] = af.groupby("mkey").grade.apply(lambda s: (s == 1).mean())
    P["firstPeriod"] = af.groupby("mkey").first_period.mean()
    P["headTeacher"] = G.head_teacher.mean()
    P["shikshaMitra"] = G.shiksha_mitra.mean()
    P["weekOther"] = af.groupby("mkey").week_other.mean()
    cs = af.groupby("mkey")[["contra_pre", "contra_hit"]].sum()
    P["contradictions"] = (cs.contra_hit / cs.contra_pre.replace(0, np.nan)).where(cs.contra_pre >= 10)
    ra = rv[rv.mkey.isin(P.index)]
    flips = ra[["flip_" + k for k in fact_ids[:4]]].mean(axis=1)
    P["factFlip"] = flips.groupby(ra.mkey).mean()
    P["enrSame"] = ra.groupby("mkey").enr_same.mean()

    def style(r):
        if r.visits < MIN_VISITS or not r.flnForms >= MIN_FLN or pd.isna(r.variety):
            return "few"
        if r.variety < LOW_VARIETY:
            return "uniform"
        return "varied" if r.variety >= HIGH_VARIETY else "mixed"
    P["type"] = P.apply(style, axis=1)

    # ---- Spot assessments: children tested on a visit, counted per school and month.
    # The data has no assessor column, so each school-month goes to the ARP who
    # visited that school most often that month. Comparisons with the block use
    # the same month, so the April 2026 change of levels doesn't count.
    spot = pd.read_csv(SPOT, dtype={"udise": str, "month": str, "district_key": str})
    spot = spot[spot.assessed > 0]
    sg = spot.groupby(["district_key", "udise", "month"])[["assessed"] + LEVELS].sum().reset_index()
    sg["skey2"] = sg.district_key + "|" + sg.udise
    for k in LEVELS:
        sg[k + "_s"] = sg[k] / sg.assessed
    d["skey2"] = d.district.map(build.district_key) + "|" + d.udise
    blocks = d.groupby("skey2").block.agg(lambda s: s.mode().iat[0])
    sg["bkey"] = sg.district_key + "|" + sg.skey2.map(blocks).astype(str)
    sg["sak_vs_block"] = sg.saksham_s - sg.groupby(["bkey", "month"]).saksham_s.transform("mean")
    sg["all_sak"] = (sg.saksham == sg.assessed).astype(float)
    sg["over5"] = (sg.assessed > 5).astype(float)
    a2 = d[d.arp]
    top = (a2.groupby(["skey2", "month", "mkey"]).size().rename("k").reset_index()
           .sort_values("k").drop_duplicates(["skey2", "month"], keep="last"))
    sg = sg.merge(top[["skey2", "month", "mkey"]], on=["skey2", "month"], how="left")
    SG = sg.dropna(subset=["mkey"]).groupby("mkey")
    P["spotN"] = SG.size()
    P["spotSaksham"] = SG.saksham_s.mean()
    P["spotVsBlock"] = SG.sak_vs_block.mean()
    P["spotAllSaksham"] = SG.all_sak.mean()
    P["spotZero"] = SG.zero_s.mean()
    P["spotOver5"] = SG.over5.mean()
    for c in ["spotSaksham", "spotVsBlock", "spotAllSaksham", "spotZero", "spotOver5"]:
        P.loc[P.spotN.fillna(0) < 10, c] = np.nan
    spot_mon = sg.dropna(subset=["mkey"]).groupby(["mkey", "month"]).saksham_s.mean()

    # Item profile per ARP: mean answer on every item (FLN on Grade 1-3 forms).
    items_meta = ([dict(id=k, label=l, group="fln", graded=k in GRADED) for k, l, *_ in FLN_ITEMS]
                  + [dict(id=k, label=l, group="g", graded=False) for k, l, _ in G_ITEMS]
                  + [dict(id=k, label=l, group="school", graded=False) for k, l, _ in FACT_ITEMS])
    prof = pd.concat([af.groupby("mkey")[fln_ids].mean(), ag.groupby("mkey")[g_ids].mean(), G[fact_ids].mean()], axis=1)
    mon = (a.groupby(["mkey", "month"]).agg(n=("date", "size")).join(af.groupby(["mkey", "month"]).fln_max.mean().rename("allyes"))
           .join(spot_mon.rename("sak"), how="left"))

    arps = []
    ids = {}
    for k, r in P.sort_values(["district", "name"]).iterrows():
        sid = k.split("|")[0] + "-" + str(len(ids))
        ids[k] = sid
        mm = mon.loc[k] if k in mon.index.get_level_values(0) else None
        rec = dict(id=sid, name=r["name"], district=r.district, block=r.block, type=r.type)
        for c in P.columns.drop(["name", "district", "block", "type"]):
            rec[c] = int(r[c]) if c in ("visits", "months", "schools", "flnForms") and not pd.isna(r[c]) else r3(r[c])
        rec["items"] = [r3(prof.at[k, i["id"]]) if k in prof.index else None for i in items_meta]
        rec["monthly"] = [] if mm is None else [[mo, int(x.n), r3(x.allyes, 2), r3(x.sak, 2)] for mo, x in mm.iterrows()]
        arps.append(rec)

    # ---- system-wide numbers for the story and the FLN page ----
    typed = P[P.type != "few"].copy()
    typed["bkey"] = typed.district + "|" + typed.block

    def block_share(col):
        x = typed.dropna(subset=[col])
        gm = x.groupby("bkey")[col].transform("mean")
        return r3(1 - ((x[col] - gm) ** 2).sum() / ((x[col] - x[col].mean()) ** 2).sum(), 2)
    k = typed.bkey.nunique()

    rng = np.random.default_rng(7)
    mo = sorted(a.month.unique())
    half = a.month.map({m: i % 2 for i, m in enumerate(mo)})

    def split(col_fn):
        h0, h1 = col_fn(a[half == 0]), col_fn(a[half == 1])
        j = pd.concat([h0, h1], axis=1).dropna()
        return r3(j.iloc[:, 0].corr(j.iloc[:, 1]), 2)
    fl_a = lambda x: x[fl.loc[x.index]]  # noqa: E731
    reliability = dict(
        variety=split(lambda x: (lambda p: (4 * p * (1 - p)).mean(axis=1))(fl_a(x).groupby("mkey")[fln_ids[:-1]].mean())),
        flnLean=split(lambda x: fl_a(x).groupby("mkey").fln_lean.mean()),
        partial=split(lambda x: fl_a(x).groupby("mkey").partial.mean()),
        noPlan=split(lambda x: x[x.form == "G"].groupby("mkey").lp_ready.apply(lambda s: (s == 0).mean())),
        allPresent=split(lambda x: x.groupby("mkey").all_present.mean()),
        teacherRepeat=split(lambda x: x.groupby("mkey").seen_teacher.mean()),
        hindiShare=split(lambda x: fl_a(x).groupby("mkey").form.apply(lambda s: (s == "FH").mean())),
        minutes=split(lambda x: x.groupby("mkey").minutes.median()),
        firstPeriod=split(lambda x: fl_a(x).groupby("mkey").first_period.mean()),
        headTeacher=split(lambda x: x.groupby("mkey").head_teacher.mean()),
        shikshaMitra=split(lambda x: x.groupby("mkey").shiksha_mitra.mean()),
        weekOther=split(lambda x: fl_a(x).groupby("mkey").week_other.mean()),
    )

    # Fixed facts on revisits: observed changes vs what answering at random (at the rater's own yes-rate) would give.
    fobs, fexp = [], []
    for kf in fact_ids[:4]:
        pk = a.groupby("mkey")[kf].mean()
        x = rv[rv.arp]
        fobs.append(x["flip_" + kf].mean())
        fexp.append((2 * pk * (1 - pk)).reindex(x.mkey).mean())
    # Same ARP, same school, same grade and FLN form, consecutive visits: does the classroom lean repeat?
    f2 = af.copy()
    f2["cell"] = f2.skey + "|" + f2.form + "|" + f2.grade.astype(str)
    f2 = f2.sort_values(["mkey", "cell", "date"])
    f2["prev"] = f2.groupby(["mkey", "cell"]).fln_lean.shift()
    pr = f2.dropna(subset=["prev", "fln_lean"])
    pr = pr[pr.groupby("mkey").mkey.transform("size") >= 15]
    cc = pr.groupby("mkey").apply(lambda x: x.fln_lean.corr(x.prev)).dropna()
    # How much of the agreement between FLN items comes from who fills the form.
    X = af[["guide_used", "tlm", "peer", "diary", "particip", "tracker", "nipun", "remedial", "wb_done", "wb_checked", "mkey"]].dropna()
    cols = X.columns[:-1]
    tri = np.triu_indices(len(cols), 1)
    corr_raw = X[cols].corr().values[tri].mean()
    corr_within = (X[cols] - X.groupby("mkey")[cols].transform("mean")).corr().values[tri].mean()

    fla = a[fl.loc[a.index]]
    by_grade = {}
    for (form, grade), x in fla.groupby(["form", "grade"]):
        by_grade[f"{form}{int(grade)}"] = dict(n=int(len(x)), items=[r3(x[i].mean()) for i in fln_ids],
                                               partial=[r3(x[i].between(0.01, 0.99).sum() / max(x[i].notna().sum(), 1)) for i in fln_ids])
    options = {}
    for i in GRADED:
        vals = fla[i].dropna().round(2)
        options[i] = {f"{form}{int(gr)}": [[r3(val, 2), r3(c)] for val, c in x[i].dropna().round(2).value_counts(normalize=True).sort_index().items()]
                      for (form, gr), x in fla.groupby(["form", "grade"]) if x[i].notna().any()}
    contra = {key: dict(premise=int((cpre[key] & fl).sum()), hit=int((chit[key] & fl).sum())) for key in cpre}

    out = dict(
        meta=dict(
            generatedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            dateFrom=d.date.min().strftime("%Y-%m-%d"), dateTo=d.date.max().strftime("%Y-%m-%d"),
            visits=int(len(d)), arpVisits=int(len(a)), flnArpForms=int(len(fla)), districts=sorted(d.district.dropna().unique()),
            minVisits=MIN_VISITS, minFln=MIN_FLN, types=TYPES,
            thresholds=dict(lowVariety=LOW_VARIETY, highVariety=HIGH_VARIETY), badges=BADGES,
            items=items_meta, reliability=reliability,
            byBlock=dict(variety=block_share("variety"), allPresent=block_share("allPresent"),
                         chance=r3((k - 1) / (len(typed) - 1), 2), blocks=int(k)),
            facts=dict(observed=r3(np.nanmean(fobs)), expected=r3(np.nanmean(fexp)), revisits=int(rv.arp.sum())),
            classConsistency=dict(median=r3(cc.median(), 2), arps=int(len(cc))),
            itemCorr=dict(raw=r3(corr_raw, 2), withinArp=r3(corr_within, 2)),
            corr=dict(variety_allPresent=r3(typed.variety.corr(typed.allPresent), 2),
                      variety_noPlan=r3(typed.variety.corr(typed.noPlan), 2),
                      variety_visits=r3(typed.variety.corr(typed.visitsPerMonth), 2),
                      variety_partial=r3(typed.variety.corr(typed.partial), 2)),
        ),
        fln=dict(byGrade=by_grade, options=options, contradictions=contra),
        spot=spot_summary(spot, sg, P),
        arps=arps,
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> {OUT}: {len(arps)} ARPs; styles {P.type.value_counts().to_dict()}")
    print(f"  reliability {reliability}")
    print(f"  facts {out['meta']['facts']} classConsistency {out['meta']['classConsistency']} itemCorr {out['meta']['itemCorr']}")


if __name__ == "__main__":
    main()
