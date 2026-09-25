import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_FILTERS, GRADE_OPTIONS, loadData, periodKey, periodOptions } from './data.js'
import { Select } from './components/ui.jsx'
import Overview from './pages/Overview.jsx'
import Mentors from './pages/Mentors.jsx'
import MentorDetail from './pages/MentorDetail.jsx'
import Schools from './pages/Schools.jsx'
import SchoolDetail from './pages/SchoolDetail.jsx'
import Kpis from './pages/Kpis.jsx'
import About from './pages/About.jsx'

const NAV = [
  { path: 'overview', label: 'Overview', icon: '◧' },
  { path: 'arps', label: 'ARP Visits', icon: '◉' },
  { path: 'mentors', label: 'DIET Mentors & SRGs', icon: '◎' },
  { path: 'schools', label: 'Schools', icon: '▦' },
  { path: 'kpis', label: 'Academic KPIs', icon: '▤' },
  { path: 'about', label: 'Definitions', icon: 'ⓘ' },
]

const FILTER_KEYS = ['ptype', 'pval', 'block', 'stype', 'grade', 'subject']

// Route + filters both live in the hash so any view can be shared as a link:
// #/arps/12?ptype=month&pval=2026-08&block=Gaur
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = h.split('?')
  const parts = path.split('/').filter(Boolean)
  const params = Object.fromEntries(new URLSearchParams(query))
  return { page: parts[0] || 'overview', id: parts[1] ?? null, params }
}

function buildHash(page, id, filters) {
  const q = new URLSearchParams()
  for (const k of FILTER_KEYS) {
    if (filters[k] && filters[k] !== DEFAULT_FILTERS[k]) q.set(k, filters[k])
  }
  const qs = q.toString()
  return `#/${page}${id != null ? `/${id}` : ''}${qs ? `?${qs}` : ''}`
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    loadData().then(setData, (e) => setError(e.message))
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const filters = useMemo(() => {
    const f = { ...DEFAULT_FILTERS }
    for (const k of FILTER_KEYS) if (route.params[k] != null) f[k] = route.params[k]
    if (data && f.ptype !== 'all') {
      const opts = periodOptions(data.months, f.ptype)
      if (!opts.some((o) => o.value === f.pval)) f.pval = opts[0]?.value ?? null
    }
    return f
  }, [route.params, data])

  const nav = (page, id = null, nextFilters = filters) => {
    window.location.hash = buildHash(page, id, nextFilters)
    window.scrollTo(0, 0)
  }
  const setFilters = (patch) => {
    const next = { ...filters, ...patch }
    window.location.hash = buildHash(route.page, route.id, next)
  }

  if (error) return <div className="fatal">Could not load dashboard data: {error}</div>
  if (!data) return <div className="loading">Loading visit data…</div>

  const props = { data, filters, setFilters, nav }
  let body
  switch (route.page) {
    case 'arps':
      body = route.id != null ? <MentorDetail {...props} id={+route.id} back="arps" /> : <Mentors {...props} category="ARP" />
      break
    case 'mentors':
      body = route.id != null ? <MentorDetail {...props} id={+route.id} back="mentors" /> : <Mentors {...props} category="other" />
      break
    case 'schools':
      body = route.id != null ? <SchoolDetail {...props} id={+route.id} /> : <Schools {...props} />
      break
    case 'kpis':
      body = <Kpis {...props} />
      break
    case 'about':
      body = <About {...props} />
      break
    default:
      body = <Overview {...props} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ARP Visit Monitoring</div>
        <div className="topbar-meta">
          District {data.meta.district} · data to {new Date(data.meta.dateTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </header>
      <div className="layout">
        <nav className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-title">Dashboard</div>
            <div className="sidebar-sub">School visits & classroom practice · {data.meta.district}</div>
          </div>
          {NAV.map((n) => (
            <a
              key={n.path}
              href={buildHash(n.path, null, filters)}
              className={`nav-item${route.page === n.path ? ' active' : ''}`}
            >
              <span className="nav-icon" aria-hidden>{n.icon}</span>
              {n.label}
            </a>
          ))}
        </nav>
        <main className="main">
          {route.page !== 'about' && <FilterBar data={data} filters={filters} setFilters={setFilters} />}
          {body}
        </main>
      </div>
    </div>
  )
}

function FilterBar({ data, filters, setFilters }) {
  const periodOpts = periodOptions(data.months, filters.ptype)
  const active = ['block', 'stype', 'grade', 'subject'].some((k) => filters[k])
  return (
    <div className="filterbar">
      <Select
        label="Period"
        value={filters.ptype}
        onChange={(ptype) => {
          const opts = periodOptions(data.months, ptype)
          // Keep the same point in time when switching granularity.
          const latest = filters.ptype === 'month' && filters.pval ? filters.pval : data.months[data.months.length - 1]
          const pval = ptype === 'all' ? null : periodKey(latest, ptype)
          setFilters({ ptype, pval: opts.some((o) => o.value === pval) ? pval : opts[0]?.value })
        }}
        options={[
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter (FY)' },
          { value: 'year', label: 'Year (FY)' },
          { value: 'all', label: 'All time' },
        ]}
      />
      {filters.ptype !== 'all' && (
        <Select label=" " value={filters.pval} onChange={(pval) => setFilters({ pval })} options={periodOpts} />
      )}
      <Select label="Block" value={filters.block} onChange={(block) => setFilters({ block })} placeholder="All blocks" options={data.blocks.map((b) => ({ value: b, label: b }))} />
      <Select
        label="School type"
        value={filters.stype}
        onChange={(stype) => setFilters({ stype })}
        placeholder="All types"
        options={[
          { value: 'PS', label: 'Primary (PS)' },
          { value: 'UPS', label: 'Upper Primary (UPS)' },
          { value: 'Composite', label: 'Composite' },
        ]}
      />
      <Select label="Grade" value={filters.grade} onChange={(grade) => setFilters({ grade })} placeholder="All grades" options={GRADE_OPTIONS} />
      <Select label="Subject" value={filters.subject} onChange={(subject) => setFilters({ subject })} placeholder="All subjects" options={data.meta.subjects.map((s) => ({ value: s, label: s }))} />
      {active && (
        <button className="btn btn-ghost" onClick={() => setFilters({ block: '', stype: '', grade: '', subject: '' })}>
          Clear filters
        </button>
      )}
    </div>
  )
}
