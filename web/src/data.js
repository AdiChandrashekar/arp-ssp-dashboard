// Loads the district data built by etl/build.py (index.json + one file per
// district) and provides the shared filtering and aggregation logic every page uses.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// no-cache: revalidate every load so a data refresh shows up immediately
async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`)
  return res.json()
}

export function loadIndex() {
  return getJson('data/index.json')
}

const districtCache = new Map()
export function loadDistrict(entry) {
  if (!districtCache.has(entry.slug)) {
    districtCache.set(
      entry.slug,
      getJson(`data/${entry.file}`).then(decode, (e) => {
        districtCache.delete(entry.slug)
        throw e
      }),
    )
  }
  return districtCache.get(entry.slug)
}

function decode(raw) {
  const { meta, mentors, schools, teachers } = raw
  const f = Object.fromEntries(meta.visitFields.map((name, i) => [name, i]))
  const kpiIndex = Object.fromEntries(meta.kpis.map((k, i) => [k.id, i]))
  const flnScoreIdx = meta.kpis.map((k, i) => (k.inScore && k.group === 'fln' ? i : -1)).filter((i) => i >= 0)
  const upScoreIdx = meta.kpis.map((k, i) => (k.inScore && k.group === 'upper' ? i : -1)).filter((i) => i >= 0)

  const visits = raw.visits.map((r, id) => {
    const k = r[f.kpis]
    const school = schools[r[f.school]]
    const subject = r[f.subject] == null ? null : meta.subjects[r[f.subject]]
    return {
      id,
      date: r[f.date],
      month: r[f.date].slice(0, 7),
      mentor: r[f.mentor],
      school: r[f.school],
      block: school.block,
      stype: school.type,
      ssp: !!school.ssp,
      // visit made by the ARP who adopted this school under SSP
      ownArp: !!school.ssp && school.sspArp === r[f.mentor],
      grade: r[f.grade],
      subject,
      form: r[f.form],
      minutes: r[f.minutes],
      clsEnr: r[f.cls_enr],
      clsPres: r[f.cls_pres],
      stuEnr: r[f.stu_enr],
      stuPres: r[f.stu_pres],
      tchPos: r[f.tch_pos],
      tchPres: r[f.tch_pres],
      cwsnEnr: r[f.cwsn_enr],
      cwsnPres: r[f.cwsn_pres],
      teacher: r[f.teacher] == null ? null : teachers[r[f.teacher]],
      k,
      flnScore: score(k, flnScoreIdx),
      upScore: score(k, upScoreIdx),
    }
  })

  const months = [...new Set(visits.map((v) => v.month))].sort()
  const blocks = [...new Set(schools.map((s) => s.block))].sort()
  const sspSchools = schools.filter((s) => s.ssp)
  // adopting ARP (mentor id) -> their adopted schools
  const adoptedBy = new Map()
  for (const s of sspSchools) {
    if (s.sspArp == null) continue
    if (!adoptedBy.has(s.sspArp)) adoptedBy.set(s.sspArp, [])
    adoptedBy.get(s.sspArp).push(s)
  }
  const spot = decodeSpot(raw.spot || [], meta.spotFields, schools)
  const spotMonths = [...new Set(spot.map((r) => r.month))].sort()
  // school id -> month -> spot rows, for joining visits to the assessment done that month
  const spotBySchool = new Map()
  for (const r of spot) {
    if (!spotBySchool.has(r.school)) spotBySchool.set(r.school, new Map())
    const byMonth = spotBySchool.get(r.school)
    if (!byMonth.has(r.month)) byMonth.set(r.month, [])
    byMonth.get(r.month).push(r)
  }
  return { meta, mentors, schools, visits, months, blocks, kpiIndex, sspSchools, adoptedBy, spot, spotMonths, spotBySchool }
}

function decodeSpot(rows, fields, schools) {
  if (!fields) return []
  const f = Object.fromEntries(fields.map((name, i) => [name, i]))
  return rows.map((r) => {
    const school = schools[r[f.school]]
    return {
      month: r[f.month],
      school: r[f.school],
      block: school.block,
      stype: school.type,
      ssp: !!school.ssp,
      cls: r[f.cls],
      n: r[f.assessed],
      saksham: r[f.saksham],
      madhyam: r[f.madhyam], // null before Apr 2026: the level didn't exist yet
      pragatisheel: r[f.pragatisheel],
      zero: r[f.zero],
    }
  })
}

// Share of applicable KPIs answered "yes", 0-100. null if none applied.
function score(k, idx) {
  let yes = 0
  let n = 0
  for (const i of idx) {
    const c = k[i]
    if (c === '1') { yes++; n++ } else if (c === '0') n++
  }
  return n ? (yes / n) * 100 : null
}

// ---------- Periods (Indian financial year: Apr-Mar) ----------

export function monthLabel(m) {
  const [y, mm] = m.split('-')
  return `${MONTH_NAMES[+mm - 1]} ${y}`
}

export function monthShort(m) {
  const [y, mm] = m.split('-')
  return `${MONTH_NAMES[+mm - 1]} ${y.slice(2)}`
}

function fyStart(m) {
  const [y, mm] = m.split('-').map(Number)
  return mm >= 4 ? y : y - 1
}

export function fyOf(m) {
  const s = fyStart(m)
  return `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`
}

export function quarterOf(m) {
  const mm = +m.split('-')[1]
  const q = mm >= 4 ? Math.floor((mm - 4) / 3) + 1 : 4
  return `Q${q} ${fyOf(m)}`
}

export function periodKey(m, type) {
  if (type === 'month') return m
  if (type === 'quarter') return quarterOf(m)
  if (type === 'year') return fyOf(m)
  return 'all'
}

export function periodOptions(months, type) {
  if (type === 'all') return []
  const keys = []
  for (const m of [...months].reverse()) {
    const k = periodKey(m, type)
    if (!keys.includes(k)) keys.push(k)
  }
  return keys.map((k) => ({ value: k, label: type === 'month' ? monthLabel(k) : k }))
}

export function periodLabel(filters) {
  if (filters.ptype === 'all') return 'All time'
  return filters.ptype === 'month' ? monthLabel(filters.pval) : filters.pval
}

// "in Aug 2026" / "in Q2 FY 2026-27" / "across all months", for sentences.
export function inPeriod(filters) {
  return filters.ptype === 'all' ? 'across all months' : `in ${periodLabel(filters)}`
}

// First month shown on the ARP visits-per-month trend charts.
export const TREND_FROM = '2025-07'

// Every month from TREND_FROM to the latest data month, so months with no visits still get a point.
export function trendMonths(months) {
  const out = []
  const last = months[months.length - 1] || TREND_FROM
  let [y, mo] = TREND_FROM.split('-').map(Number)
  for (let key = TREND_FROM; key <= last; key = `${y}-${String(mo).padStart(2, '0')}`) {
    out.push(key)
    if (++mo > 12) {
      mo = 1
      y++
    }
  }
  return out
}

export function monthsInPeriod(months, filters) {
  return months.filter((m) => filters.ptype === 'all' || periodKey(m, filters.ptype) === filters.pval)
}

// ---------- Filters ----------

export const DEFAULT_FILTERS = {
  ptype: 'month',
  pval: null,
  block: '',
  stype: '',
  grade: '',
  subject: '',
  ssp: '',
}

export function applyFilters(visits, filters, { period = true } = {}) {
  return visits.filter((v) => {
    if (period && filters.ptype !== 'all' && periodKey(v.month, filters.ptype) !== filters.pval) return false
    if (filters.block && v.block !== filters.block) return false
    if (filters.stype && v.stype !== filters.stype) return false
    if (filters.grade && !gradeMatches(v.grade, filters.grade)) return false
    if (filters.subject && v.subject !== filters.subject) return false
    if (filters.ssp && !v.ssp) return false
    return true
  })
}

export const GRADE_OPTIONS = [
  { value: 'fln', label: 'Grades 1-3 (FLN)' },
  { value: 'upper', label: 'Grades 4-8' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((g) => ({ value: String(g), label: `Grade ${g}` })),
]

function gradeMatches(grade, sel) {
  if (sel === 'fln') return grade >= 1 && grade <= 3
  if (sel === 'upper') return grade >= 4
  return grade === +sel
}

// ---------- Aggregation ----------

export function mean(arr) {
  const xs = arr.filter((x) => x != null && !Number.isNaN(x))
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export function countBy(arr, fn) {
  const m = new Map()
  for (const x of arr) {
    const k = fn(x)
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

export function groupBy(arr, fn) {
  const m = new Map()
  for (const x of arr) {
    const k = fn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

// yes / (yes + no) for one KPI over a set of visits.
export function kpiRate(visits, idx) {
  let yes = 0
  let n = 0
  for (const v of visits) {
    const c = v.k[idx]
    if (c === '1') { yes++; n++ } else if (c === '0') n++
  }
  return { yes, n, pct: n ? (yes / n) * 100 : null }
}

// Ratio of sums (not mean of ratios) so big schools weigh proportionally.
export function attendance(visits, presKey, enrKey) {
  let p = 0
  let e = 0
  for (const v of visits) {
    if (v[presKey] != null && v[enrKey] > 0 && v[presKey] <= v[enrKey]) {
      p += v[presKey]
      e += v[enrKey]
    }
  }
  return e ? (p / e) * 100 : null
}

export function mentorSummary(visits, feedbackIdx) {
  const schools = new Set(visits.map((v) => v.school))
  const days = new Set(visits.map((v) => v.date))
  const fln = visits.filter((v) => v.form === 'FM' || v.form === 'FH')
  return {
    visits: visits.length,
    schools: schools.size,
    days: days.size,
    avgMin: mean(visits.map((v) => v.minutes)),
    flnShare: visits.length ? (fln.length / visits.length) * 100 : null,
    flnScore: mean(visits.map((v) => v.flnScore)),
    upScore: mean(visits.map((v) => v.upScore)),
    feedback: kpiRate(fln, feedbackIdx).pct,
    lastDate: visits.reduce((a, v) => (v.date > a ? v.date : a), ''),
  }
}

// ---------- SSP (School Support Programme) ----------

/**
 * Adopted-school coverage in a set of visits (already period/grade/subject filtered).
 * Returns totals plus a per-ARP breakdown: adopted schools, how many got any
 * visit, and how many were visited by the ARP who adopted them.
 */
export function sspCoverage(data, visits, { block = '', stype = '' } = {}) {
  const inScope = (s) => (!block || s.block === block) && (!stype || s.type === stype)
  const anyVisit = new Set()
  const ownVisit = new Set()
  for (const v of visits) {
    if (!v.ssp) continue
    anyVisit.add(v.school)
    if (v.ownArp) ownVisit.add(v.school)
  }
  const perArp = new Map()
  for (const [arp, list] of data.adoptedBy) {
    const adopted = list.filter(inScope)
    if (!adopted.length) continue
    perArp.set(arp, {
      adopted: adopted.length,
      visited: adopted.filter((s) => anyVisit.has(s.id)).length,
      own: adopted.filter((s) => ownVisit.has(s.id)).length,
    })
  }
  const schools = data.sspSchools.filter(inScope)
  return {
    schools: schools.length,
    visited: schools.filter((s) => anyVisit.has(s.id)).length,
    own: schools.filter((s) => ownVisit.has(s.id)).length,
    perArp,
    arpsFull: [...perArp.values()].filter((p) => p.own === p.adopted).length,
  }
}

// ---------- Spot assessments ----------
// When an ARP visits a school they assess a few students on the spot. The data
// comes per school per month (per class from Aug 2026), not per visit, and does
// not say which mentor did the assessment.

export const SPOT_LEVELS = [
  { key: 'saksham', label: 'Saksham', en: 'proficient', color: '#104281' },
  { key: 'madhyam', label: 'Madhyam', en: 'intermediate', color: '#5598e7' },
  { key: 'pragatisheel', label: 'Pragatisheel', en: 'progressing', color: '#b7d3f6' },
  { key: 'zero', label: 'Zero score', en: 'no correct answers', color: '#eb6834' },
]

// Same filters as visits. Spot rows have no subject; the class is known only
// from Aug 2026, so a grade filter keeps just the rows recorded with a class.
export function applySpotFilters(spot, filters, { period = true } = {}) {
  return spot.filter((r) => {
    if (period && filters.ptype !== 'all' && periodKey(r.month, filters.ptype) !== filters.pval) return false
    if (filters.block && r.block !== filters.block) return false
    if (filters.stype && r.stype !== filters.stype) return false
    if (filters.grade && (r.cls == null || !gradeMatches(r.cls, filters.grade))) return false
    if (filters.ssp && !r.ssp) return false
    return true
  })
}

// Students assessed and the share at each level (pooled over rows).
export function spotSummary(rows) {
  const out = { rows: rows.length, n: 0, schools: new Set(rows.map((r) => r.school)).size }
  for (const l of SPOT_LEVELS) out[l.key] = null // stays null if no row has the level (Madhyam before Apr 2026)
  for (const r of rows) {
    out.n += r.n
    for (const l of SPOT_LEVELS) if (r[l.key] != null) out[l.key] += r[l.key]
  }
  for (const l of SPOT_LEVELS) out[`${l.key}Pct`] = out.n && out[l.key] != null ? (out[l.key] / out.n) * 100 : null
  return out
}

// Spot rows behind one visit: same school and month, and the visit's grade when
// the rows have a class (Aug 2026 on) and one matches; otherwise the whole school-month.
export function spotForVisit(data, v) {
  const rows = data.spotBySchool.get(v.school)?.get(v.month)
  if (!rows) return null
  const same = rows.filter((r) => r.cls != null && r.cls === v.grade)
  return same.length ? same : rows
}

// Spot rows behind a set of visits, each row counted once.
export function spotForVisits(data, visits) {
  const out = new Set()
  for (const v of visits) for (const r of spotForVisit(data, v) || []) out.add(r)
  return [...out]
}

export function spotText(s) {
  return s && s.n ? `${s.saksham}/${s.n} Saksham` : '—'
}

// Every month from the first visit or spot month to the last, for trend charts.
export function allMonths(data) {
  const ms = [...new Set([...data.months, ...data.spotMonths])].sort()
  if (!ms.length) return []
  const out = []
  let [y, mo] = ms[0].split('-').map(Number)
  for (let key = ms[0]; key <= ms[ms.length - 1]; key = `${y}-${String(mo).padStart(2, '0')}`) {
    out.push(key)
    if (++mo > 12) {
      mo = 1
      y++
    }
  }
  return out
}

// ---------- Formatting ----------

export const fmt = {
  int: (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-IN')),
  pct: (x) => (x == null ? '—' : `${Math.round(x)}%`),
  pct1: (x) => (x == null ? '—' : `${x.toFixed(1)}%`),
  num1: (x) => (x == null ? '—' : x.toFixed(1)),
  date: (d) => {
    if (!d) return '—'
    const [y, m, dd] = d.split('-')
    return `${+dd} ${MONTH_NAMES[+m - 1]} ${y}`
  },
}

export function statusFor(pct, good = 80, warn = 60) {
  if (pct == null) return 'neutral'
  if (pct >= good) return 'good'
  if (pct >= warn) return 'warning'
  return 'critical'
}
