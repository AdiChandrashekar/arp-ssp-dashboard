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
  return { meta, mentors, schools, visits, months, blocks, kpiIndex, sspSchools, adoptedBy }
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
