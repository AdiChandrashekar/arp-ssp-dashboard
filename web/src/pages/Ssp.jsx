import { Fragment, useMemo, useState } from 'react'
import { applyFilters, applySpotFilters, fmt, groupBy, kpiRate, mean, monthLabel, monthShort, SPOT_LEVELS, spotSummary, sspCoverage, statusFor } from '../data.js'
import { Card, DataTable, Empty, Section, StatCard, Tabs } from '../components/ui.jsx'
import { Heatmap, LevelBar, LineChart, seqColor } from '../components/charts.jsx'

const FORM_LABEL = { FM: 'FLN Maths', FH: 'FLN Hindi', G: 'Gr 4-8', O: 'Gr 1-3 other' }

// What a school x month cell is coloured by.
function metricOptions(data) {
  return [
    { value: 'visits', label: 'Number of visits' },
    { value: 'own', label: 'Visited by own ARP' },
    { value: 'fln', label: 'FLN practice score' },
    { value: 'up', label: 'Gr 4-8 practice score' },
    { value: 'spot', label: 'Spot assessment · % Saksham' },
    ...data.meta.kpis.filter((k) => k.group !== 'school').map((k) => ({ value: k.id, label: `${k.group === 'fln' ? 'FLN' : 'Gr 4-8'} · ${k.label}` })),
  ]
}

// The school-month's spot assessment (all classes) behind a cell's visits.
function cellSpot(data, vs) {
  return spotSummary(data.spotBySchool.get(vs[0].school)?.get(vs[0].month) || [])
}

function cellValue(data, metric, vs) {
  if (!vs?.length) return null
  if (metric === 'spot') {
    const sp = cellSpot(data, vs)
    return sp.n ? { value: sp.sakshamPct / 100, text: String(Math.round(sp.sakshamPct)) } : { value: null, text: '–' }
  }
  if (metric === 'visits') return { value: Math.min(vs.length, 3) / 3, text: String(vs.length) }
  if (metric === 'own') {
    const own = vs.some((v) => v.ownArp)
    return { value: own ? 1 : 0.25, text: own ? '★' : '·' }
  }
  if (metric === 'fln' || metric === 'up') {
    const x = mean(vs.map((v) => (metric === 'fln' ? v.flnScore : v.upScore)))
    return x == null ? { value: null, text: '–' } : { value: x / 100, text: String(Math.round(x)) }
  }
  const r = kpiRate(vs, data.kpiIndex[metric])
  return r.pct == null ? { value: null, text: '–' } : { value: r.pct / 100, text: r.n === 1 ? (r.yes ? '✓' : '✗') : String(Math.round(r.pct)) }
}

function cellNumber(data, metric, vs) {
  if (!vs?.length) return null
  if (metric === 'spot') return cellSpot(data, vs).sakshamPct
  if (metric === 'visits') return vs.length
  if (metric === 'own') return vs.some((v) => v.ownArp) ? 1 : 0
  if (metric === 'fln') return mean(vs.map((v) => v.flnScore))
  if (metric === 'up') return mean(vs.map((v) => v.upScore))
  return kpiRate(vs, data.kpiIndex[metric]).pct
}

export default function Ssp({ data, filters, nav }) {
  const { meta, mentors, schools } = data
  const months = data.months.filter((m) => m >= meta.sspFrom)
  const latest = months[months.length - 1]
  const [focus, setFocus] = useState(null)
  const [metric, setMetric] = useState('fln')
  const [arp, setArp] = useState('')
  const [q, setQ] = useState('')
  const [cell, setCell] = useState(null) // { school, month }
  const [view, setView] = useState('matrix')
  const [cmpA, setCmpA] = useState(null)
  const [cmpB, setCmpB] = useState(null)
  const fm = focus && months.includes(focus) ? focus : latest
  const monthA = cmpA && months.includes(cmpA) ? cmpA : months[Math.max(0, months.length - 2)]
  const monthB = cmpB && months.includes(cmpB) ? cmpB : latest

  const m = useMemo(() => {
    const f = { ...filters, ptype: 'all', ssp: '' }
    const all = applyFilters(data.visits, f, { period: false }).filter((v) => v.month >= meta.sspFrom)
    const sspV = all.filter((v) => v.ssp)
    const otherV = all.filter((v) => !v.ssp)
    const sspByMonth = groupBy(sspV, (v) => v.month)
    const otherByMonth = groupBy(otherV, (v) => v.month)
    const bySchoolMonth = groupBy(sspV, (v) => `${v.school}|${v.month}`)
    const coverage = months.map((mo) => sspCoverage(data, sspByMonth.get(mo) || [], filters))
    const spot = applySpotFilters(data.spot, { ...filters, ptype: 'all', ssp: '' }).filter((r) => r.month >= meta.sspFrom)
    const spotSsp = groupBy(spot.filter((r) => r.ssp), (r) => r.month)
    const spotOther = groupBy(spot.filter((r) => !r.ssp), (r) => r.month)
    const inScope = data.sspSchools.filter((s) => (!filters.block || s.block === filters.block) && (!filters.stype || s.type === filters.stype))
    return { sspV, otherV, sspByMonth, otherByMonth, bySchoolMonth, coverage, inScope, spotSsp, spotOther }
  }, [data, filters, meta.sspFrom, months])

  if (!data.sspSchools.length) return <Empty>No ARP Focus Schools for {meta.district} in the tracker.</Empty>
  if (!months.length) return <Empty>No visits since {monthLabel(meta.sspFrom)} yet.</Empty>

  const fi = months.indexOf(fm)
  const cov = m.coverage[fi]
  const fSsp = m.sspByMonth.get(fm) || []
  const fOther = m.otherByMonth.get(fm) || []
  const pct = (a, b) => (b ? (a / b) * 100 : null)
  const arpName = (s) => (s.sspArp != null ? mentors[s.sspArp].name : s.sspArpName || 'Unmatched ARP')

  // ---- school x month matrix rows, grouped by adopting ARP ----
  const needle = q.trim().toLowerCase()
  const shownSchools = m.inScope
    .filter((s) => !arp || String(s.sspArp) === arp)
    .filter((s) => !needle || `${s.name} ${s.udise} ${arpName(s)}`.toLowerCase().includes(needle))
  const groups = [...groupBy(shownSchools, (s) => arpName(s))].sort((a, b) => a[0].localeCompare(b[0]))
  const metricLabel = metricOptions(data).find((o) => o.value === metric)?.label

  const cellVisits = cell ? m.bySchoolMonth.get(`${cell.school}|${cell.month}`) || [] : []

  // ---- month comparison ----
  const cmpRows = m.inScope.map((s) => {
    const a = cellNumber(data, metric, m.bySchoolMonth.get(`${s.id}|${monthA}`))
    const b = cellNumber(data, metric, m.bySchoolMonth.get(`${s.id}|${monthB}`))
    return {
      ...s,
      arp: arpName(s),
      a,
      b,
      change: a != null && b != null ? b - a : null,
      visitsA: (m.bySchoolMonth.get(`${s.id}|${monthA}`) || []).length,
      visitsB: (m.bySchoolMonth.get(`${s.id}|${monthB}`) || []).length,
    }
  })
  const comparable = cmpRows.filter((r) => r.change != null)
  const up = comparable.filter((r) => r.change > 0).length
  const down = comparable.filter((r) => r.change < 0).length
  const fmtMetric = (x) => (x == null ? '—' : metric === 'visits' ? String(x) : metric === 'own' ? (x ? 'Yes' : 'No') : fmt.pct(x))

  const adoptingArps = [...data.adoptedBy.keys()].map((id) => mentors[id]).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      <div className="page-head">
        <div className="crumbs">Dashboard / ARP Focus Schools</div>
        <h1>ARP Focus Schools · {meta.district}</h1>
        <div className="page-meta">
          <span className="pill pill-ssp">ARP-adopted schools</span>
          <span className="muted">
            {monthLabel(months[0])} – {monthLabel(latest)} · click a month on any chart to focus the cards on it
          </span>
        </div>
      </div>

      <div className="narrative">
        In <strong>{monthLabel(fm)}</strong>, {cov.visited} of {cov.schools} adopted schools got a visit and{' '}
        <strong>{cov.own}</strong> were visited by the ARP who adopted them ({fmt.pct(pct(cov.own, cov.schools))}). {cov.arpsFull} of {cov.perArp.size} ARPs
        visited every school they adopted. FLN practice score in adopted schools was <strong>{fmt.pct(mean(fSsp.map((v) => v.flnScore)))}</strong> against{' '}
        {fmt.pct(mean(fOther.map((v) => v.flnScore)))} in other schools.
      </div>

      <div className="stats">
        <StatCard label="Adopted schools" value={fmt.int(m.inScope.length)} sub={`by ${adoptingArps.length} ARPs · ${data.sspSchools.filter((s) => s.po).length} also PO-adopted`} />
        <StatCard
          className="stat-spot"
          label={`Spot · Saksham · ${monthShort(fm)}`}
          value={fmt.pct(spotSummary(m.spotSsp.get(fm) || []).sakshamPct)}
          sub={`${fmt.int(spotSummary(m.spotSsp.get(fm) || []).n)} students in focus schools · other schools ${fmt.pct(spotSummary(m.spotOther.get(fm) || []).sakshamPct)}`}
        >
          <LevelBar s={spotSummary(m.spotSsp.get(fm) || [])} levels={SPOT_LEVELS} wide />
        </StatCard>
        <StatCard label={`Visited · ${monthShort(fm)}`} value={`${cov.visited} / ${cov.schools}`} sub={`${fmt.pct(pct(cov.visited, cov.schools))} got any visit`} status={statusFor(pct(cov.visited, cov.schools), 90, 70)} />
        <StatCard label={`By own ARP · ${monthShort(fm)}`} value={`${cov.own} / ${cov.schools}`} sub={`${fmt.pct(pct(cov.own, cov.schools))} of adopted schools`} status={statusFor(pct(cov.own, cov.schools), 90, 70)} />
        <StatCard label="ARPs covering all schools" value={`${cov.arpsFull} / ${cov.perArp.size}`} sub={`visited every adopted school in ${monthShort(fm)}`} />
        <StatCard label="Visits to adopted schools" value={fmt.int(fSsp.length)} sub={`${fmt.pct(pct(fSsp.filter((v) => v.ownArp).length, fSsp.length))} made by the adopting ARP`} />
        <StatCard label="FLN score · focus vs others" value={fmt.pct(mean(fSsp.map((v) => v.flnScore)))} sub={`other schools ${fmt.pct(mean(fOther.map((v) => v.flnScore)))}`} />
      </div>

      <Card className="card-spot" title="Spot assessments · students at Saksham level" sub="Share of students assessed by visiting mentors who were Saksham, in ARP Focus Schools and other schools · click a month to focus the cards on it">
        <LineChart
          xs={months.map((mo) => ({ key: mo, label: monthShort(mo) }))}
          series={[
            { key: 'ssp', label: 'ARP Focus Schools', short: 'Focus', values: months.map((mo) => spotSummary(m.spotSsp.get(mo) || []).sakshamPct), notes: months.map((mo) => `(${fmt.int(spotSummary(m.spotSsp.get(mo) || []).n)} students)`) },
            { key: 'other', label: 'Other schools', short: 'other', values: months.map((mo) => spotSummary(m.spotOther.get(mo) || []).sakshamPct), notes: months.map((mo) => `(${fmt.int(spotSummary(m.spotOther.get(mo) || []).n)} students)`) },
          ]}
          selectedKey={fm}
          onSelect={setFocus}
        />
      </Card>

      <div className="grid-2">
        <Card title="Adopted-school coverage, month by month" sub="% of adopted schools with at least one visit, and with a visit from their own ARP">
          <LineChart
            xs={months.map((mo) => ({ key: mo, label: monthShort(mo) }))}
            series={[
              { key: 'any', label: 'Visited by anyone', short: 'any', values: m.coverage.map((c) => pct(c.visited, c.schools)), notes: m.coverage.map((c) => `(${c.visited}/${c.schools})`) },
              { key: 'own', label: 'Visited by own ARP', short: 'own', values: m.coverage.map((c) => pct(c.own, c.schools)), notes: m.coverage.map((c) => `(${c.own}/${c.schools})`) },
            ]}
            selectedKey={fm}
            onSelect={setFocus}
          />
        </Card>
        <Card title="FLN practice score · adopted vs other schools" sub="Average across Grade 1-3 Hindi & Maths observations each month">
          <LineChart
            xs={months.map((mo) => ({ key: mo, label: monthShort(mo) }))}
            series={[
              { key: 'ssp', label: 'ARP Focus Schools', short: 'Focus', values: months.map((mo) => mean((m.sspByMonth.get(mo) || []).map((v) => v.flnScore))) },
              { key: 'other', label: 'Other schools', short: 'other', values: months.map((mo) => mean((m.otherByMonth.get(mo) || []).map((v) => v.flnScore))) },
            ]}
            selectedKey={fm}
            onSelect={setFocus}
          />
        </Card>
      </div>


      <Card title="Classroom practices in adopted schools, month by month" sub="% of observations in ARP Focus Schools · last column: difference from other schools in the focused month (percentage points)">
        <Heatmap
          rowHeader="KPI"
          rows={data.meta.kpis.filter((k) => k.group !== 'school').map((k) => ({ key: k.id, label: `${k.group === 'fln' ? 'FLN' : 'Gr 4-8'} · ${k.label}` }))}
          cols={[...months.map((mo) => ({ key: mo, label: monthShort(mo) })), { key: 'delta', label: `vs others · ${monthShort(fm)}` }]}
          cell={(kid, mo) => {
            const idx = data.kpiIndex[kid]
            if (mo === 'delta') {
              const a = kpiRate(fSsp, idx)
              const b = kpiRate(fOther, idx)
              if (a.n < 5 || b.n < 5) return null
              const d = a.pct - b.pct
              return { value: null, text: `${d > 0 ? '+' : ''}${Math.round(d)}`, tip: `Focus ${fmt.pct(a.pct)} vs others ${fmt.pct(b.pct)}` }
            }
            const r = kpiRate(m.sspByMonth.get(mo) || [], idx)
            return r.n < 5 ? null : { value: r.pct, text: Math.round(r.pct), tip: `${monthShort(mo)}: ${fmt.pct(r.pct)} (n=${r.n})` }
          }}
          legend={{ low: '0%', high: '100%', label: 'Blank = fewer than 5 observations' }}
        />
      </Card>

      <Card title="Adopting ARPs · own visits to adopted schools each month" sub="Cell = adopted schools the ARP visited themselves / schools adopted · click a row to show only that ARP's schools below">
        <Heatmap
          rowHeader="ARP"
          rows={adoptingArps
            .filter((a) => m.coverage.some((c) => c.perArp.has(a.id)))
            .map((a) => ({ key: a.id, label: a.name, title: `${a.name} · ${a.block}` }))}
          cols={months.map((mo) => ({ key: mo, label: monthShort(mo) }))}
          cell={(id, mo) => {
            const c = m.coverage[months.indexOf(mo)].perArp.get(id)
            if (!c) return null
            return { value: (c.own / c.adopted) * 100, text: `${c.own}/${c.adopted}`, tip: `${c.own} of ${c.adopted} visited by this ARP · ${c.visited} by anyone` }
          }}
          onRowClick={(id) => {
            setArp(String(id))
            setView('matrix')
            document.getElementById('ssp-schools')?.scrollIntoView({ behavior: 'smooth' })
          }}
          legend={{ low: 'none', high: 'all adopted schools' }}
        />
      </Card>

      <div id="ssp-schools" />
      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: 'matrix', label: 'Schools × months' },
          { value: 'compare', label: 'Compare two months' },
        ]}
      />

      <div className="toolbar">
        <label className="field">
          <span className="field-label">Colour cells by</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {metricOptions(data).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Adopting ARP</span>
          <select value={arp} onChange={(e) => setArp(e.target.value)}>
            <option value="">All ARPs</option>
            {adoptingArps.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        {view === 'matrix' ? (
          <label className="field">
            <span className="field-label">Search</span>
            <input className="search" placeholder="School, UDISE or ARP" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        ) : (
          <>
            <label className="field">
              <span className="field-label">From</span>
              <select value={monthA} onChange={(e) => setCmpA(e.target.value)}>
                {months.map((mo) => <option key={mo} value={mo}>{monthLabel(mo)}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <select value={monthB} onChange={(e) => setCmpB(e.target.value)}>
                {months.map((mo) => <option key={mo} value={mo}>{monthLabel(mo)}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      {view === 'matrix' ? (
        <div className="grid-matrix">
          <Card title={`Adopted schools · ${metricLabel}`} sub="Grades observed shown under each cell · S = students Saksham in that month's spot assessment · ★ = visited by own ARP · click a cell for the visits behind it">
            <div className="heatmap-wrap matrix-wrap">
              <table className="heatmap matrix">
                <thead>
                  <tr>
                    <th className="hm-rowhead">School</th>
                    {months.map((mo) => (
                      <th key={mo} className={`hm-colhead${mo === fm ? ' col-focus' : ''}`}>{monthShort(mo)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([name, list]) => (
                    <Fragment key={name}>
                      <tr className="group-row">
                        <th colSpan={months.length + 1}>
                          {name} <span className="muted">· {list[0].block} · {list.length} schools</span>
                        </th>
                      </tr>
                      {list.map((s) => (
                        <tr key={s.id}>
                          <th className="hm-rowhead">
                            <a href="#" onClick={(e) => { e.preventDefault(); nav('schools', s.id) }} title={`${s.name} · ${s.udise}`}>
                              {s.name}
                            </a>
                            {s.po ? <span className="muted small"> · PO</span> : null}
                          </th>
                          {months.map((mo) => {
                            const vs = m.bySchoolMonth.get(`${s.id}|${mo}`)
                            const c = cellValue(data, metric, vs)
                            const col = c?.value != null ? seqColor(c.value) : null
                            const grades = vs ? [...new Set(vs.map((v) => v.grade).filter(Boolean))].sort() : []
                            const own = vs?.some((v) => v.ownArp)
                            const selected = cell && cell.school === s.id && cell.month === mo
                            return (
                              <td
                                key={mo}
                                className={`hm-cell matrix-cell${vs ? ' clickable' : ''}${selected ? ' selected' : ''}`}
                                style={col ? { background: col.bg, color: col.fg } : undefined}
                                onClick={vs ? () => setCell({ school: s.id, month: mo }) : undefined}
                                title={vs ? `${vs.length} visit(s) · grades ${grades.join(', ') || '—'}${own ? ' · own ARP visited' : ''}` : 'No visit'}
                              >
                                {vs ? (
                                  <>
                                    <div className="mc-main">{c?.text}{own && metric !== 'own' ? <sup>★</sup> : null}</div>
                                    <div className="mc-grades">{grades.map((g) => `G${g}`).join(' ')}</div>
                                    {metric !== 'spot' && (() => {
                                      const sp = cellSpot(data, vs)
                                      return sp.n ? <div className="spot-cell" title={`Spot assessment: ${sp.saksham} of ${sp.n} students Saksham`}>S {sp.saksham}/{sp.n}</div> : null
                                    })()}
                                  </>
                                ) : (
                                  <span className="mc-empty">—</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {!groups.length && <Empty>No adopted schools match.</Empty>}
            </div>
          </Card>
          <Card title={cell ? `${schools[cell.school].name} · ${monthLabel(cell.month)}` : 'Visit details'} sub={cell ? `Adopted by ${arpName(schools[cell.school])}` : 'Click a cell in the grid'} className="detail-card">
            {cell ? <VisitDetails data={data} visits={cellVisits} nav={nav} spot={data.spotBySchool.get(cell.school)?.get(cell.month) || []} /> : <Empty>Select a school-month to see which ARP visited, in which grade, and what they recorded.</Empty>}
          </Card>
        </div>
      ) : (
        <Section
          sub={`${metricLabel}: ${monthLabel(monthA)} → ${monthLabel(monthB)} · ${comparable.length} schools had a reading in both months: ${up} up, ${down} down, ${comparable.length - up - down} unchanged`}
        >
          <DataTable
            key={`${metric}|${monthA}|${monthB}`}
            csvName={`ssp-compare-${metric}-${monthA}-${monthB}.csv`}
            rows={cmpRows.filter((r) => !arp || String(r.sspArp) === arp)}
            searchText={(r) => `${r.name} ${r.udise} ${r.arp}`}
            initialSort={{ key: 'change', dir: 'asc' }}
            onRowClick={(r) => nav('schools', r.id)}
            columns={[
              { key: 'name', label: 'School', value: (r) => r.name, render: (r) => <span className="link">{r.name}</span> },
              { key: 'udise', label: 'UDISE', value: (r) => r.udise },
              { key: 'arp', label: 'Adopted by', value: (r) => r.arp },
              { key: 'visitsA', label: `Visits ${monthShort(monthA)}`, value: (r) => r.visitsA, align: 'right' },
              { key: 'a', label: monthShort(monthA), value: (r) => r.a, align: 'right', render: (r) => fmtMetric(r.a) },
              { key: 'visitsB', label: `Visits ${monthShort(monthB)}`, value: (r) => r.visitsB, align: 'right' },
              { key: 'b', label: monthShort(monthB), value: (r) => r.b, align: 'right', render: (r) => fmtMetric(r.b) },
              {
                key: 'change',
                label: 'Change',
                value: (r) => r.change,
                align: 'right',
                render: (r) =>
                  r.change == null ? (
                    <span className="muted">{r.a == null && r.b == null ? 'no reading' : r.a == null ? `new in ${monthShort(monthB)}` : `none in ${monthShort(monthB)}`}</span>
                  ) : (
                    <span className={r.change > 0 ? 'delta-up' : r.change < 0 ? 'delta-down' : ''}>
                      {r.change > 0 ? '▲ +' : r.change < 0 ? '▼ ' : ''}
                      {metric === 'visits' || metric === 'own' ? r.change : `${Math.round(r.change)} pts`}
                    </span>
                  ),
              },
            ]}
          />
        </Section>
      )}
    </div>
  )
}

function VisitDetails({ data, visits, nav, spot }) {
  const kpis = data.meta.kpis
  const sp = spotSummary(spot)
  return (
    <div className="visit-details">
      <div className="vd">
        <div className="vd-head"><b>Spot assessment</b></div>
        {sp.n ? (
          <>
            <div className="vd-score">
              <b>{sp.saksham}</b> of {sp.n} students Saksham ({fmt.pct(sp.sakshamPct)}) <LevelBar s={sp} levels={SPOT_LEVELS} />
            </div>
            <div className="vd-sub muted">
              {SPOT_LEVELS.filter((l) => sp[l.key] != null).map((l) => `${l.label} ${sp[l.key]}`).join(' · ')}
              {spot.some((r) => r.cls != null) && ` · classes ${[...new Set(spot.map((r) => r.cls))].sort().join(', ')}`}
            </div>
          </>
        ) : (
          <div className="vd-sub muted">None recorded this month.</div>
        )}
      </div>
      {visits
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((v) => {
          const mentor = data.mentors[v.mentor]
          const answered = kpis.map((k, i) => ({ k, c: v.k[i] })).filter((x) => x.c !== '-' && x.k.group !== 'school')
          return (
            <div key={v.id} className="vd">
              <div className="vd-head">
                <b>{fmt.date(v.date)}</b> · Grade {v.grade ?? '—'} {v.subject} · {FORM_LABEL[v.form]}
              </div>
              <div className="vd-sub">
                <a href="#" onClick={(e) => { e.preventDefault(); nav(mentor.category === 'ARP' ? 'arps' : 'mentors', mentor.id) }}>{mentor.name}</a>{' '}
                <span className="muted">({mentor.designation})</span>
                {v.ownArp && <span className="own-tag"> ★ own ARP</span>}
                {v.teacher && <span className="muted"> · teacher {v.teacher}</span>}
              </div>
              <div className="vd-score">
                Practice score <b>{fmt.pct(v.flnScore ?? v.upScore)}</b>
                {v.clsEnr ? <span className="muted"> · class {v.clsPres ?? '—'}/{v.clsEnr} present</span> : null}
              </div>
              <ul className="vd-kpis">
                {answered.map(({ k, c }) => (
                  <li key={k.id} className={c === '1' ? 'yes' : 'no'}>
                    <span aria-hidden>{c === '1' ? '✓' : '✗'}</span> {k.label}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
    </div>
  )
}
