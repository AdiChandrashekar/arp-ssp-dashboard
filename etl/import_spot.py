"""Import mentor spot-assessment workbooks into data/spot/spot.csv.gz.

Usage:
    python etl/import_spot.py "Jan_26 onwards _ Mentor Spot Raw Data_ School Wise.xlsx" ...

When an ARP visits a school they do a quick spot assessment of a few students.
The state shares these as workbooks with one sheet per month ("Mentor_July25",
"Apr26", "Sept26"...), one row per school (per class from Aug 2026), covering
all 75 districts. This keeps the programme districts only and writes one
committed extract that etl/build.py reads. Months in the new workbooks replace
the same months already in the extract; other months are kept, so each new
monthly file can be imported on its own.

Columns change over time: School_Name appears from Nov 2025, Madhyamstudent
from Apr 2026 and Class from Aug 2026. The level counts always add up to
StudentAssessed.
"""

import os
import re
import sys

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "spot", "spot.csv.gz")
TRACKER_EXTRACT = os.path.join(ROOT, "data", "ssp", "ssp_schools.csv.gz")

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
LEVELS = {"Sakshamstudent": "saksham", "Madhyamstudent": "madhyam", "Pragtisheelstudent": "pragatisheel", "ZeroScorer": "zero"}
FIELDS = ["district_key", "month", "udise", "cls", "assessed", "saksham", "madhyam", "pragatisheel", "zero"]


def district_key(name):
    return re.sub(r"[^A-Z]", "", str(name).upper())


def sheet_month(sheet):
    """'Mentor_July25' / 'Apr26' / 'Sept26' -> '2025-07' / '2026-04' / '2026-09'."""
    m = re.fullmatch(r"(?:Mentor_)?([A-Za-z]+?)_?(\d{2})", sheet.strip())
    if not m or m.group(1)[:3].lower() not in MONTHS:
        raise SystemExit(f"Can't tell the month from sheet name '{sheet}'")
    return f"20{m.group(2)}-{MONTHS[m.group(1)[:3].lower()]:02d}"


def read_sheet(xl, sheet, wanted):
    d = pd.read_excel(xl, sheet)
    d = d.loc[:, [c for c in d.columns if not str(c).startswith("Unnamed")]]
    need = {"District", "UDISE", "StudentAssessed", "Sakshamstudent", "Pragtisheelstudent", "ZeroScorer"}
    if missing := need - set(d.columns):
        raise SystemExit(f"{sheet}: missing columns {sorted(missing)}")
    d = d[d["District"].map(district_key).isin(wanted)].copy()
    # Mostly numbers (leading zero lost); the odd one is text or has a typo ('090901052s9').
    d["u"] = d["UDISE"].map(lambda v: re.sub(r"\.0$", "", str(v).strip()) if pd.notna(v) else "")
    if (bad := ~d["u"].str.fullmatch(r"\d{10,11}")).any():
        print(f"  NOTE {sheet}: {int(bad.sum())} rows with a missing or malformed UDISE dropped")
        d = d[~bad]
    out = pd.DataFrame({
        "district_key": d["District"].map(district_key),
        "month": sheet_month(sheet),
        "udise": d["u"].str.zfill(11),
        "cls": d["Class"].astype("Int64") if "Class" in d else pd.array([pd.NA] * len(d), dtype="Int64"),
        "assessed": d["StudentAssessed"].astype(int),
    })
    for src, dst in LEVELS.items():
        out[dst] = d[src].astype("Int64") if src in d else pd.array([pd.NA] * len(d), dtype="Int64")
    bad = out["assessed"] != out[list(LEVELS.values())].fillna(0).sum(axis=1)
    if bad.any():
        raise SystemExit(f"{sheet}: {int(bad.sum())} rows where the levels don't add up to StudentAssessed")
    # The 2025 sheets repeat some school rows exactly; one school-month (or school-class-month) is one record.
    dupes = out.duplicated(["udise", "cls"], keep=False)
    exact = out.duplicated(keep="first")
    if (dupes & ~out.duplicated(keep=False)).any():
        print(f"  NOTE {sheet}: {int((dupes & ~out.duplicated(keep=False)).sum())} rows repeat a school with different numbers; kept all")
    out = out[~exact]
    print(f"  {sheet} -> {out['month'].iat[0] if len(out) else '?'}: {len(out)} rows ({int(exact.sum())} exact duplicates dropped)")
    return out


def main(paths):
    if not paths:
        raise SystemExit(__doc__)
    wanted = set(pd.read_csv(TRACKER_EXTRACT, dtype=str)["district_key"].unique())
    frames = []
    for p in paths:
        xl = pd.ExcelFile(p)
        print(os.path.basename(p))
        frames += [read_sheet(xl, s, wanted) for s in xl.sheet_names]
    new = pd.concat(frames, ignore_index=True)
    if os.path.exists(OUT):
        old = pd.read_csv(OUT, dtype={"district_key": str, "month": str, "udise": str})
        old = old[~old["month"].isin(set(new["month"]))]
        new = pd.concat([old, new], ignore_index=True)
    new = new.astype({c: "Int64" for c in FIELDS[3:]}).sort_values(["month", "district_key", "udise", "cls"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    new[FIELDS].to_csv(OUT, index=False, compression="gzip")
    print(f"wrote {OUT}: {len(new)} rows, {new['month'].min()} to {new['month'].max()}")
    print(new.groupby("district_key").size().to_string())


if __name__ == "__main__":
    main(sys.argv[1:])
