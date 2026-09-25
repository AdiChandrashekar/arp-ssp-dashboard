import { useMemo, useState } from 'react'
import { applyFilters, countBy, fmt, groupBy, mentorSummary, monthShort, monthsInPeriod, periodLabel, sspCoverage, statusFor } from '../data.js'
import { Card, DataTable, Meter, Section, StatCard, Tabs } from '../components/ui.jsx'
import { Heatmap } from '../components/charts.jsx'

export default function Mentors({ data, filters, nav, category }) {
  const isArp = category === 'ARP'
  const target = data.meta.arpMonthlyTarget
  const [view, setView] = useState('table')
  const feedbackIdx = data.kpiIndex.feedback

  const m = useMemo(() => {
    const roster = data.mentors.filter(
      (x) =>
        (isArp ? x.category === 'ARP' : x.category !== 'ARP') &&
        (!filters.block || x.block === filters.block) &&
        (!filters.ssp || !isArp || data.adoptedBy.has(x.id)),
    )
    const ids = new Set(roster.map((x) => x.id))
    const inPeriod = applyFilters(data.visits, filters).filter((v) => ids.has(v.mentor))
    const allTime = applyFilters(data.visits, filters, { period: false }).filter((v) => ids.has(v.mentor))
    const months = monthsInPeriod(data.months, filters)
    const periodTarget = target * months.length
    const byMentor = groupBy(inPeriod, (v) => v.mentor)
    const cov = sspCoverage(data, applyFilters(data.visits, filters), { stype: filters.stype })
    const rows = roster.map((a) => {
      const vs = byMentor.get(a.id) || []
      const c = cov.perArp.get(a.id)
      return {
        ...a,
        ...mentorSummary(vs, feedbackIdx),
        progress: periodTarget ? (vs.length / periodTarget) * 100 : null,
        adopted: c?.adopted ?? 0,
        adoptedVisited: c?.visited ?? 0,
        adoptedOwn: c?.own ?? 0,
        ownPct: c ? (c.own / c.adopted) * 100 : null,
      }
    })
    const monthCounts = countBy(allTime, (v) => `${v.mentor}|${v.month}`)
    return { roster, rows, inPeriod, periodTarget, monthCounts, cov }
  }, [data, filters, isArp, target, feedbackIdx])

  const pl = periodLabel(filters)
  const active = m.rows.filter((r) => r.visits > 0).length
  const meeting = m.rows.filter((r) => r.visits >= m.periodTarget).length
  const below50 = m.rows.filter((r) => r.visits < m.periodTarget / 2).length
  const base = isArp ? 'arps' : 'mentors'

  const columns = [
    { key: 'name', label: isArp ? 'ARP' : 'Mentor', value: (r) => r.name, render: (r) => <span className="link">{r.name}</span> },
    ...(!isArp ? [{ key: 'designation', label: 'Designation', value: (r) => r.designation }] : []),
    { key: 'block', label: 'Block', value: (r) => r.block },
    { key: 'visits', label: 'Visits', value: (r) => r.visits, align: 'right' },
    ...(isArp && filters.ssp
      ? [
          { key: 'adopted', label: 'Adopted', value: (r) => r.adopted, align: 'right' },
          {
            key: 'ownPct',
            label: 'Adopted visited by self',
            value: (r) => r.ownPct,
            csv: (r) => `${r.adoptedOwn}/${r.adopted}`,
            render: (r) => (
              <span className="meter-cell">
                <Meter value={r.ownPct} status={statusFor(r.ownPct, 100, 60)} />
                <span className="num">{r.adoptedOwn} / {r.adopted}</span>
              </span>
            ),
          },
          { key: 'adoptedVisited', label: 'Visited by anyone', value: (r) => r.adoptedVisited, align: 'right', render: (r) => `${r.adoptedVisited} / ${r.adopted}` },
        ]
      : []),
    ...(isArp && !filters.ssp
      ? [{
          key: 'progress',
          label: `vs target ${m.periodTarget}`,
          value: (r) => r.progress,
          csv: (r) => Math.round(r.progress),
          render: (r) => (
            <span className="meter-cell">
              <Meter value={r.progress} status={statusFor(r.progress, 100, 50)} />
              <span className="num">{fmt.pct(r.progress)}</span>
            </span>
          ),
        }]
      : []),
    { key: 'schools', label: 'Schools', value: (r) => r.schools, align: 'right' },
    { key: 'days', label: 'Days in field', value: (r) => r.days, align: 'right' },
    { key: 'flnShare', label: 'Gr 1-3 FLN share', value: (r) => r.flnShare, align: 'right', render: (r) => fmt.pct(r.flnShare) },
    { key: 'avgMin', label: 'Avg min / visit', value: (r) => r.avgMin, align: 'right', render: (r) => fmt.int(r.avgMin) },
    { key: 'flnScore', label: 'FLN score', value: (r) => r.flnScore, align: 'right', render: (r) => fmt.pct(r.flnScore) },
    { key: 'upScore', label: 'Gr 4-8 score', value: (r) => r.upScore, align: 'right', render: (r) => fmt.pct(r.upScore) },
    { key: 'feedback', label: 'Feedback given', value: (r) => r.feedback, align: 'right', render: (r) => fmt.pct(r.feedback) },
    { key: 'lastDate', label: 'Last visit', value: (r) => r.lastDate || null, render: (r) => fmt.date(r.lastDate) },
  ]

  return (
    <div>
      <div className="page-head">
        <div className="crumbs">Dashboard / {isArp ? 'ARP Visits' : 'DIET Mentors & SRGs'}</div>
        <h1>{isArp ? 'ARP visits' : 'DIET Mentor & SRG visits'} · {pl}</h1>
        {filters.ssp && <div className="page-meta"><span className="pill pill-ssp">SSP schools only</span> <span className="muted">visits to ARP-adopted schools; ARPs who adopted schools</span></div>}
      </div>

      <div className="stats">
        <StatCard label={isArp ? 'ARPs on roster' : 'Mentors'} value={m.roster.length} sub={filters.block ? `${filters.block} block` : 'who appear in the data'} />
        <StatCard label="Active" value={`${active} / ${m.roster.length}`} sub={`${m.roster.length - active} with no visit in ${pl}`} />
        <StatCard label="Visits" value={fmt.int(m.inPeriod.length)} sub={`${fmt.num1(m.roster.length ? m.inPeriod.length / m.roster.length : null)} per ${isArp ? 'ARP' : 'mentor'}`} />
        {isArp && filters.ssp && (
          <>
            <StatCard label="Adopted schools visited by own ARP" value={`${m.cov.own} / ${m.cov.schools}`} sub={fmt.pct((m.cov.own / Math.max(1, m.cov.schools)) * 100)} status={statusFor((m.cov.own / Math.max(1, m.cov.schools)) * 100, 90, 70)} />
            <StatCard label="ARPs who visited all their schools" value={`${m.cov.arpsFull} / ${m.cov.perArp.size}`} sub={`in ${pl}`} />
          </>
        )}
        {isArp && !filters.ssp && (
          <>
            <StatCard label={`Met target (${m.periodTarget})`} value={`${meeting}`} sub={`${fmt.pct((meeting / Math.max(1, m.roster.length)) * 100)} of ARPs`} status={statusFor((meeting / Math.max(1, m.roster.length)) * 100, 80, 50)} />
            <StatCard label="Below half of target" value={`${below50}`} sub={`fewer than ${Math.ceil(m.periodTarget / 2)} visits`} status={below50 === 0 ? 'good' : below50 <= 5 ? 'warning' : 'critical'} />
          </>
        )}
      </div>

      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: 'table', label: `${isArp ? 'ARP' : 'Mentor'}-wise table` },
          { value: 'months', label: 'Month-by-month' },
        ]}
      />

      {view === 'table' ? (
        <Section sub={`${pl} · school type, grade and subject filters apply to visit counts · click a name to see all their visits`}>
          <DataTable
            csvName={`${base}-${pl}.csv`}
            rows={m.rows}
            columns={columns}
            searchText={(r) => `${r.name} ${r.block}`}
            onRowClick={(r) => nav(base, r.id)}
            initialSort={{ key: 'visits', dir: 'desc' }}
          />
        </Section>
      ) : (
        <Card
          title="Visits per month"
          sub={`Every ${isArp ? 'ARP' : 'mentor'}, all months · ${isArp ? `cells at or above ${target} are the darkest shade · ` : ''}click a row to open`}
        >
          <Heatmap
            rowHeader={isArp ? 'ARP' : 'Mentor'}
            rows={[...m.rows].sort((a, b) => a.block.localeCompare(b.block) || a.name.localeCompare(b.name)).map((r) => ({ key: r.id, label: r.name, title: `${r.name} · ${r.block}` }))}
            cols={data.months.map((mo) => ({ key: mo, label: monthShort(mo) }))}
            max={isArp ? target : Math.max(1, ...m.monthCounts.values())}
            cell={(id, mo) => {
              const n = m.monthCounts.get(`${id}|${mo}`)
              return n ? { value: Math.min(n, isArp ? target : n), text: n, tip: `${n} visits` } : { value: null, text: '·' }
            }}
            onRowClick={(id) => nav(base, id)}
            legend={{ low: '1', high: isArp ? `${target}+` : fmt.int(Math.max(1, ...m.monthCounts.values())), label: 'Visits' }}
          />
        </Card>
      )}
    </div>
  )
}
