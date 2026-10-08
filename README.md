# ARP Visit Monitoring Dashboard

A static dashboard for tracking ARP / DIET Mentor / SRG school visits and the classroom-practice KPIs recorded during them. It is built from the monthly mentor-app observation exports (currently Basti, Jul 2025 – Aug 2026).

**Pages**

- **Overview**: visits, ARPs meeting the 30-visit monthly target, schools covered, practice scores, block comparison, what grades/subjects were observed.
- **ARP Visits**: every ARP against target, plus a month-by-month grid. Click an ARP for their full visit log, field-day calendar, grade × subject mix, the schools they visited and the practices they observed compared with peers.
- **DIET Mentors & SRGs**: the same view with no target.
- **Schools**: visits each school received, grades observed and schools not visited in the period. Click a school for its grade × month grid, attendance and visit log.
- **Academic KPIs**: FLN (Gr 1-3), Grades 4-8 and school-level KPIs, with block and month-by-month heatmaps.
- **Definitions**: how every number is calculated.

Filters (period, block, school type, grade, subject) apply to every page and are kept in the URL, so any view can be shared as a link.

## How the data gets here

```
UP SSD Data (Workspace Drive, view-only)          year / month / DISTRICT.xlsx
   │  Apps Script exporter (apps-script/), runs nightly as your Workspace account
   │  • only the 10 programme districts • new or changed files only
   │  • blanks phone numbers, HRMS codes, student names and free-text remarks;
   │    mentor mobile -> salted hash (the mentor ID) • stops if a header moves
   ▼
data/exports/<YYYY-MM>/<DISTRICT>.csv.gz          one commit per run
   │  GitHub Action (.github/workflows/build-data.yml)
   ▼
etl/build.py  ->  web/public/data/index.json + districts/<district>.json
```

The raw files never leave Workspace. Only redacted CSVs reach GitHub.

**SSP tracker.** `NIPUN SSP Adoption - Mentor Tracker.xlsx` provides the district list, each district's full school list, SSP adoption and each school's adopting ARP. Put it at `data/ssp/tracker.xlsx` (git-ignored) and run the build locally. That refreshes `data/ssp/ssp_schools.csv.gz`, the committed extract that the GitHub Action uses. Commit that file when the tracker changes.

Fixes that haven't reached the source tracker yet (a missing UDISE code, a school an ARP added or dropped) go in `data/ssp/corrections.csv` (actions `set_udise`, `add`, `remove`). The build applies them on top of the tracker and prints a note for any that no longer match, e.g. once the source sheet has been fixed.

**Spot assessments.** The "Mentor Spot Raw Data" workbooks (one sheet per month, every UP district) hold the results of the quick student assessments mentors do on a visit. The results are counted per school per month, and per class from Aug 2026. Import them with:

```bash
python etl/import_spot.py "Aug_26 onwards _ Mentor Spot Raw Data.xlsx" ...
```

This keeps the programme districts and writes `data/spot/spot.csv.gz`, the committed extract that the build reads. Months in the new workbooks replace the same months in the extract, and other months are kept, so a new monthly file can be imported on its own. Commit the extract; the GitHub Action rebuilds the data.

### Exporter setup (once)

1. Create a GitHub fine-grained token with access to **only this repository** and **Contents: Read and write**.
2. Open the script (`apps-script/.clasp.json` has its ID) → Project Settings → Script properties → add `GITHUB_TOKEN`.
3. Run `setup()` from the editor and approve the permissions. This creates a nightly trigger (02:00 IST) and starts the first export. The first export chains itself until every month is done.
4. `status()` shows what's waiting and `resetState()` forces a full re-export. The logs are under Executions.

To change the code: edit `apps-script/Code.js`, then run `clasp push` from `apps-script/`.

### Running the build locally

```bash
pip install -r etl/requirements.txt
python etl/build.py                 # reads data/exports (or data/raw/*.xlsx if there are no exports)
python etl/build.py path/to/files   # any folder of .xlsx / .csv / .csv.gz exports
```

The build checks each column's header and stops if the export layout has changed.

## Running locally

```bash
cd web
npm install
npm run dev
```

## Building for hosting

```bash
cd web
npm run build
```

**GitHub Pages.** `.github/workflows/deploy-pages.yml` builds `web/` and publishes it to https://adichandrashekar.github.io/arp-ssp-dashboard/ on every push to `main` that changes `web/`, and after each data rebuild. Turn it on once under Settings → Pages → Source: **GitHub Actions**. The site is public: anyone with the link can see it.

Or upload `web/dist/` to any static host (Firebase Hosting, Netlify, GitHub Pages, S3…). The build uses relative paths, so it also works from a sub-folder.

## Privacy

`etl/build.py` removes teacher and mentor mobile numbers, teacher HRMS codes, student names and free-text remarks. Only the cleaned `dashboard.json` is published. Teacher and school names remain. Raw exports are git-ignored.

## Project layout

```
etl/build.py              Excel exports -> web/public/data/dashboard.json (KPI definitions live here)
web/src/data.js           loading, filters, periods, aggregation
web/src/pages/            one file per page
web/src/components/       stat cards, table, charts
```
