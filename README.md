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

## Updating the data each month

1. Put the monthly `.xlsx` exports in `data/raw/`. Keep all months there; the build reads every file and drops exact duplicates.
2. Rebuild the data file:
   ```bash
   pip install pandas openpyxl
   python etl/build.py
   ```
   This writes `web/public/data/dashboard.json`. The build checks each column's header text and stops with an error if the export layout has changed.
3. Commit the updated `dashboard.json` and redeploy.

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

Upload `web/dist/` to any static host (Firebase Hosting, Netlify, GitHub Pages, S3…). The build uses relative paths, so it also works from a sub-folder.

## Privacy

`etl/build.py` removes teacher and mentor mobile numbers, teacher HRMS codes, student names and free-text remarks. Only the cleaned `dashboard.json` is published. Teacher and school names remain. Raw exports are git-ignored.

## Project layout

```
etl/build.py              Excel exports -> web/public/data/dashboard.json (KPI definitions live here)
web/src/data.js           loading, filters, periods, aggregation
web/src/pages/            one file per page
web/src/components/       stat cards, table, charts
```
