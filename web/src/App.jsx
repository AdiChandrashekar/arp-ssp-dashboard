import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_FILTERS, GRADE_OPTIONS, loadDistrict, loadIndex, periodKey, periodOptions } from './data.js'
import { Empty, Select } from './components/ui.jsx'
import Overview from './pages/Overview.jsx'
import Mentors from './pages/Mentors.jsx'
import MentorDetail from './pages/MentorDetail.jsx'
import Schools from './pages/Schools.jsx'
import SchoolDetail from './pages/SchoolDetail.jsx'
import Kpis from './pages/Kpis.jsx'
import Ssp from './pages/Ssp.jsx'
import About from './pages/About.jsx'

const NAV = [
  { path: 'overview', label: 'Overview', icon: '◧' },
  { path: 'arps', label: 'ARP Visits', icon: '◉' },
  { path: 'mentors', label: 'DIET Mentors & SRGs', icon: '◎' },
  { path: 'schools', label: 'Schools', icon: '▦' },
  { path: 'kpis', label: 'Academic KPIs', icon: '▤' },
  { path: 'ssp', label: 'SSP Deep Dive', icon: '★' },
  { path: 'about', label: 'Definitions', icon: 'ⓘ' },
]

const FILTER_KEYS = ['d', 'ptype', 'pval', 'block', 'stype', 'grade', 'subject', 'ssp']

// Route + filters both live in the hash so any view can be shared as a link:
// #/arps/12?d=basti&ptype=month&pval=2026-08&ssp=1
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
  const [index, setIndex] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    loadIndex().then(setIndex, (e) => setError(e.message))
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Default district: the first one that has visit data.
  const district = useMemo(() => {
    if (!index) return null
    const wanted = index.districts.find((d) => d.slug === route.params.d)
    return wanted || index.districts.find((d) => d.visits > 0) || index.districts[0]
  }, [index, route.params.d])

  useEffect(() => {
    if (!district) return
    let live = true
    loadDistrict(district).then((d) => live && setData(d), (e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [district])

  const filters = useMemo(() => {
    const f = { ...DEFAULT_FILTERS, d: district?.slug }
    for (const k of FILTER_KEYS) if (route.params[k] != null) f[k] = route.params[k]
    if (district) f.d = district.slug
    if (data && f.ptype !== 'all') {
      const opts = periodOptions(data.months, f.ptype)
      if (!opts.some((o) => o.value === f.pval)) f.pval = opts[0]?.value ?? null
    }
    return f
  }, [route.params, data, district])

  const nav = (page, id = null, nextFilters = filters) => {
    window.location.hash = buildHash(page, id, nextFilters)
    window.scrollTo(0, 0)
  }
  const setFilters = (patch) => {
    const next = { ...filters, ...patch }
    // A new district has different blocks, mentors and schools: drop what no longer applies.
    if (patch.d && patch.d !== filters.d) {
      next.block = ''
      window.location.hash = buildHash(route.id != null ? route.page : route.page, null, next)
      return
    }
    window.location.hash = buildHash(route.page, route.id, next)
  }

  if (error) return <div className="fatal">Could not load dashboard data: {error}</div>
  if (!index || !data || data.meta.district !== district.name) return <div className="loading">Loading {district?.name || ''} visit data…</div>

  const props = { data, filters, setFilters, nav }
  let body
  if (!data.visits.length && route.page !== 'about') {
    body = (
      <Empty>
        No visit data for {district.name} yet. {data.sspSchools.length ? `${data.sspSchools.length} SSP-adopted schools are listed in the tracker.` : ''}
      </Empty>
    )
  } else {
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
      case 'ssp':
        body = <Ssp {...props} />
        break
      case 'about':
        body = <About {...props} />
        break
      default:
        body = <Overview {...props} />
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ARP Visit Monitoring</div>
        <div className="topbar-meta">
          {district.name}
          {data.meta.dateTo && ` · data to ${new Date(data.meta.dateTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
        </div>
      </header>
      <div className="layout">
        <nav className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-title">Dashboard</div>
            <div className="sidebar-sub">School visits & classroom practice · {district.name}</div>
          </div>
          {NAV.map((n) => (
            <a key={n.path} href={buildHash(n.path, null, filters)} className={`nav-item${route.page === n.path ? ' active' : ''}`}>
              <span className="nav-icon" aria-hidden>{n.icon}</span>
              {n.label}
            </a>
          ))}
        </nav>
        <main className="main">
          {route.page !== 'about' && <FilterBar index={index} data={data} filters={filters} setFilters={setFilters} page={route.page} />}
          {body}
        </main>
      </div>
    </div>
  )
}

function FilterBar({ index, data, filters, setFilters, page }) {
  const periodOpts = periodOptions(data.months, filters.ptype)
  const active = ['block', 'stype', 'grade', 'subject'].some((k) => filters[k])
  const onSspPage = page === 'ssp'
  return (
    <div className={`filterbar${filters.ssp || onSspPage ? ' filterbar-ssp' : ''}`}>
      <Select
        label="District"
        value={filters.d}
        onChange={(d) => setFilters({ d })}
        options={index.districts.map((d) => ({ value: d.slug, label: d.visits ? d.name : `${d.name} (no visits yet)` }))}
      />
      {!onSspPage && (
        <>
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
          {filters.ptype !== 'all' && <Select label=" " value={filters.pval} onChange={(pval) => setFilters({ pval })} options={periodOpts} />}
        </>
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
      {!onSspPage && (
        <label className={`toggle${filters.ssp ? ' on' : ''}`} title="Show only schools adopted by ARPs under the School Support Programme">
          <input type="checkbox" checked={!!filters.ssp} onChange={(e) => setFilters({ ssp: e.target.checked ? '1' : '' })} />
          <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
          <span className="toggle-label">SSP schools only</span>
        </label>
      )}
      {active && (
        <button className="btn btn-ghost" onClick={() => setFilters({ block: '', stype: '', grade: '', subject: '' })}>
          Clear filters
        </button>
      )}
    </div>
  )
}
