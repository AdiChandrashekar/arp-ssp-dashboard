"""Build the ARP rating-behaviour study data from the dashboard's district files.

Usage:
    python etl/arp_study.py [data_dir] [out_file]

Defaults: data_dir = web/public/data, out_file = web/public/study/data.json

Reads the district JSON written by etl/build.py and profiles how each ARP
fills in the observation form:
  - generosity: how many points higher (or lower) the ARP scores classrooms
    than other raters who saw the same school in the same quarter, anchored so
    DIET mentors and SRGs average zero (a rater-effects model),
  - variety: how often the ARP's answer to each FLN question changes from
    visit to visit (0 = same answer every time),
  - spot assessments, effort and coverage.
ARPs are then sorted into rating-style types with simple, published rules.
"""

import glob
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "web", "public", "data")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "web", "public", "study", "data.json")

FLN_ITEMS = ["guide_avail", "guide_used", "tlm", "peer", "particip", "diary", "tracker", "nipun_table",
             "remedial", "wb_avail", "wb_done", "wb_checked", "fluency"]

# Type rules, applied in this order. Thresholds sit at natural breaks in the
# 2025-26 data (see the study page's method notes).
MIN_VISITS, MIN_SHARED = 60, 10
LOW_VARIETY, HIGH_VARIETY = 0.35, 0.5
ALL_CLEAR_SPOT = 0.30
STRICT_GENEROSITY = 0.05
TYPES = [
    dict(id="allclear", label="All-clear",
         rule="Near-identical, mostly-yes forms, and 30% or more of spot assessments report every child Saksham"),
    dict(id="boxtick", label="Box-ticking",
         rule="Near-identical, mostly-yes forms (answer variety below 0.35)"),
    dict(id="discerning", label="Discerning",
         rule="Answers vary (variety 0.5 or more) and scores are within 5 points of, or below, DIET/SRG"),
    dict(id="mixed", label="In between", rule="Everyone else"),
]


def load(data_dir):
    vis, ments, schs, spots = [], [], [], []
    for f in sorted(glob.glob(os.path.join(data_dir, "districts", "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        dist = d["meta"]["district"]
        if not d["visits"]:
            continue
        kpis = d["meta"]["kpis"]
        v = pd.DataFrame(d["visits"], columns=d["meta"]["visitFields"])
        codes = np.array([list(k) for k in v["kpis"]])
        for i, k in enumerate(kpis):
            v[k["id"]] = np.where(codes[:, i] == "1", 1.0, np.where(codes[:, i] == "0", 0.0, np.nan))
        score_cols = [k["id"] for k in kpis if k["inScore"]]
        v["score"] = v[score_cols].mean(axis=1)
        v["n_items"] = v[score_cols].notna().sum(axis=1)
        v["district"] = dist
        vis.append(v.drop(columns=["kpis"]))
        m = pd.DataFrame(d["mentors"]); m["district"] = dist; ments.append(m)
        s = pd.DataFrame(d["schools"]); s["district"] = dist; schs.append(s)
        if d.get("spot"):
            sp = pd.DataFrame(d["spot"], columns=d["meta"]["spotFields"]); sp["district"] = dist; spots.append(sp)
    return pd.concat(vis), pd.concat(ments), pd.concat(schs), pd.concat(spots)


def rater_effects(df, iters=40):
    """score = cell (school x quarter x form group) + rater effect, over cells seen by 2+ raters.

    Rater effects are anchored so the DIET mentors' and SRGs' average is 0, so
    an ARP's effect reads as "points above an independent observer".
    """
    nr = df.groupby("cell").mkey.nunique()
    df = df[df.cell.isin(nr[nr >= 2].index)]
    independents = df.loc[df.category != "ARP", "mkey"].unique()
    r = pd.Series(0.0, index=df.mkey.unique())
    for _ in range(iters):
        c = (df.score - df.mkey.map(r)).groupby(df.cell).mean()
        r = (df.score - df.cell.map(c)).groupby(df.mkey).mean()
        r -= r[r.index.isin(independents)].mean()
    return r, df.groupby("mkey").size(), df


def split_half(df, rng):
    halves = {c: rng.integers(2) for c in df.cell.unique()}
    h = df.cell.map(halves)
    (r0, n0, _), (r1, n1, _) = rater_effects(df[h == 0]), rater_effects(df[h == 1])
    j = pd.concat([r0, r1, n0, n1], axis=1, keys=["a", "b", "na", "nb"]).dropna()
    j = j[(j.na >= 10) & (j.nb >= 10)]
    return round(float(j.a.corr(j.b)), 3)


def classify(r):
    if r.n_obs < MIN_VISITS or not r.shared_n >= MIN_SHARED or pd.isna(r.variety):
        return "few"
    if r.variety < LOW_VARIETY:
        return "allclear" if r.spot_allsak >= ALL_CLEAR_SPOT else "boxtick"
    if r.variety >= HIGH_VARIETY and r.generosity <= STRICT_GENEROSITY:
        return "discerning"
    return "mixed"


def r2(x, n=3):
    return None if x is None or pd.isna(x) else round(float(x), n)


def main():
    v, m, s, sp = load(DATA_DIR)
    v = v.merge(m[["district", "id", "category", "name", "block"]].rename(columns={"id": "mentor", "block": "home_block"}),
                on=["district", "mentor"])
    v["mkey"] = v.district + "|" + v.mentor.astype(str)
    v["skey"] = v.district + "|" + v.school.astype(str)
    s["skey"] = s.district + "|" + s.id.astype(str)
    v = v.merge(s[["skey", "block", "ssp"]], on="skey", how="left")
    v["d"] = pd.to_datetime(v.date)
    v["month"] = v.date.str[:7]
    v["fg"] = np.where(v.form.isin(["FM", "FH"]), "FLN", np.where(v.form == "G", "G", "O"))
    v["ok"] = v.fg.isin(["FLN", "G"]) & (v.n_items >= 5)
    v["cell"] = v.skey + "|" + v.d.dt.year.astype(str) + "Q" + v.d.dt.quarter.astype(str) + "|" + v.fg
    print(f"  {len(v)} visits, {v.mkey.nunique()} mentors")

    rated = v[v.ok]
    gen, shared_n, cells = rater_effects(rated)
    reliability = {"generosity": split_half(cells, np.random.default_rng(7))}

    a = v[v.category == "ARP"].copy()
    fl = a[a.ok & (a.fg == "FLN")]
    g = a[a.ok & (a.fg == "G")]
    ga = a[a.fg == "G"]
    P = pd.DataFrame(index=a.mkey.unique())
    P["generosity"] = gen
    P["shared_n"] = shared_n
    p = fl.groupby("mkey")[FLN_ITEMS].mean()
    P["variety"] = (4 * p * (1 - p)).mean(axis=1)
    P["fln_allyes"] = fl.assign(x=fl.score.eq(1)).groupby("mkey").x.mean()
    P["g_allyes"] = g.assign(x=g.score.eq(1)).groupby("mkey").x.mean()
    P["no_plan"] = ga.assign(x=ga.lp_ready.eq(0)).groupby("mkey").x.mean()
    P["fln_score"] = fl.groupby("mkey").score.mean()
    P["n_obs"] = a.groupby("mkey").size()
    pm = a.groupby(["mkey", "month"]).size()
    P["months"] = pm.groupby("mkey").size()
    P["visits_pm"] = pm.groupby("mkey").mean()
    P["target_share"] = (pm >= 30).groupby("mkey").mean()
    P["schools"] = a.groupby("mkey").skey.nunique()
    P["adopted_share"] = a.groupby("mkey").ssp.mean()
    P["minutes"] = a.groupby("mkey").minutes.median()
    a["att"] = (a.stu_pres / a.stu_enr).where((a.stu_enr > 0) & (a.stu_pres <= a.stu_enr * 1.2))
    P["attendance"] = a.groupby("mkey").att.mean()

    # Spot assessments: each school-month goes to the ARP who visited the school most that month.
    sp["skey"] = sp.district + "|" + sp.school.astype(str)
    gs = sp[sp.assessed > 0].groupby(["skey", "month"])[["assessed", "saksham"]].sum().reset_index()
    gs["sak"] = gs.saksham / gs.assessed
    gs = gs.merge(s[["skey", "block"]], on="skey")
    gs["sak_vs_block"] = gs.sak - gs.groupby([gs.skey.str.split("|").str[0] + "|" + gs.block.astype(str), "month"]).sak.transform("mean")
    top = (a.groupby(["skey", "month", "mkey"]).size().rename("k").reset_index()
           .sort_values("k").drop_duplicates(["skey", "month"], keep="last"))
    gs = gs.merge(top[["skey", "month", "mkey"]], on=["skey", "month"])
    P["spot_n"] = gs.groupby("mkey").size()
    P["spot_allsak"] = gs.assign(x=gs.sak.eq(1)).groupby("mkey").x.mean()
    P["spot_vs_block"] = gs.groupby("mkey").sak_vs_block.mean()
    P["type"] = P.apply(classify, axis=1)

    # Monthly rhythm: visits and the share of all-yes FLN forms.
    mon = a.groupby(["mkey", "month"]).agg(n=("date", "size")).join(
        fl.assign(x=fl.score.eq(1)).groupby(["mkey", "month"]).x.mean().rename("allyes"))

    # What independents see in the same schools, by the ARP's type: ARP and DIET/SRG ratings
    # in shared cells (same school, quarter, form group).
    cells = cells.copy()
    cells["type"] = cells.mkey.map(P.type)
    ind_cell = cells[cells.category != "ARP"].groupby("cell").score.mean()
    sharedc = cells[(cells.category == "ARP") & cells.cell.isin(ind_cell.index)].copy()
    sharedc["ind"] = sharedc.cell.map(ind_cell)
    by_type = sharedc.groupby("type").agg(arp=("score", "mean"), ind=("ind", "mean"), n=("score", "size"))

    mentors = m.assign(mkey=m.district + "|" + m.id.astype(str)).set_index("mkey")
    arps = []
    for k, r in P.sort_values("generosity", ascending=False).iterrows():
        mt = mentors.loc[k]
        mm = mon.loc[k] if k in mon.index.get_level_values(0) else None
        arps.append(dict(
            id=k, name=mt["name"], district=mt["district"], block=mt["block"], type=r.type,
            generosity=r2(r.generosity), sharedN=int(r.shared_n) if not pd.isna(r.shared_n) else 0,
            variety=r2(r.variety), flnAllYes=r2(r.fln_allyes), gAllYes=r2(r.g_allyes), noPlan=r2(r.no_plan),
            flnScore=r2(r.fln_score), visits=int(r.n_obs), months=int(r.months), visitsPerMonth=r2(r.visits_pm, 1),
            targetShare=r2(r.target_share), schools=int(r.schools), adoptedShare=r2(r.adopted_share),
            minutes=r2(r.minutes, 0), attendance=r2(r.attendance), spotN=int(r.spot_n) if not pd.isna(r.spot_n) else 0,
            spotAllSaksham=r2(r.spot_allsak), spotVsBlock=r2(r.spot_vs_block),
            monthly=[] if mm is None else [[mo, int(x.n), r2(x.allyes, 2)] for mo, x in mm.iterrows()],
        ))

    typed = P[P.type != "few"].copy()
    ind = v[v.category != "ARP"]
    # How much of each style measure is shared by ARPs of the same block, against what
    # random grouping into blocks of the same sizes would give.
    typed["bkey"] = [mentors.loc[k, "district"] + "|" + mentors.loc[k, "block"] for k in typed.index]
    def share_by(col, key):
        x = typed.dropna(subset=[col])
        gm = x.groupby(key)[col].transform("mean")
        return r2(1 - ((x[col] - gm) ** 2).sum() / ((x[col] - x[col].mean()) ** 2).sum(), 2)
    k = typed.bkey.nunique()
    by_block = dict(generosity=share_by("generosity", "bkey"), variety=share_by("variety", "bkey"),
                    chance=r2((k - 1) / (len(typed) - 1), 2), blocks=int(k))
    out = dict(
        meta=dict(
            generatedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            dateFrom=v.date.min(), dateTo=v.date.max(), visits=int(len(v)), arpVisits=int(len(a)),
            independentVisits=int(len(ind)), independents=int(ind.mkey.nunique()), districts=sorted(v.district.unique()),
            reliability=reliability, minVisits=MIN_VISITS, minShared=MIN_SHARED,
            thresholds=dict(lowVariety=LOW_VARIETY, highVariety=HIGH_VARIETY, allClearSpot=ALL_CLEAR_SPOT,
                            strictGenerosity=STRICT_GENEROSITY),
            types=TYPES + [dict(id="few", label="Too little data", rule=f"Fewer than {MIN_VISITS} visits or {MIN_SHARED} shared-school comparisons")],
            arpGenerosityMean=r2(typed.generosity.mean()),
            byBlock=by_block,
            corr=dict(generosity_visits=r2(typed.generosity.corr(typed.visits_pm), 2),
                      generosity_spot=r2(typed.generosity.corr(typed.spot_allsak), 2),
                      variety_allyes=r2(typed.variety.corr(typed.fln_allyes), 2)),
        ),
        byType={t: dict(arp=r2(x.arp), ind=r2(x.ind), n=int(x.n)) for t, x in by_type.iterrows()},
        arps=arps,
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> {OUT}: {len(arps)} ARPs; types {P.type.value_counts().to_dict()}; reliability {reliability}")
    print(f"  by type (ARP vs DIET/SRG in shared cells): {out['byType']}")


if __name__ == "__main__":
    main()
