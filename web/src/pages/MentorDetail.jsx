import { useMemo, useState } from 'react'
import { applyFilters, countBy, fmt, groupBy, kpiRate, mean, mentorSummary, monthLabel, monthShort, monthsInPeriod, periodLabel, statusFor } from '../data.js'
import { Card, DataTable, Empty, Pill, Section, StatCard, Tabs } from '../components/ui.jsx'
import { BarList, ColumnChart, Heatmap, MonthCalendar } from '../components/charts.jsx'

const FORM_LABEL = { FM: 'FLN Maths', FH: 'FLN Hindi', G: 'Gr 4-8', O: 'Gr 1-3 other' }

export default function MentorDetail({ data, filters, setFilters, nav, id, back }) {
  const mentor = data.mentors[id]
  const isArp = mentor?.category === 'ARP'
  const target = data.meta.arpMonthlyTarget
  const [tab, setTab] = useState('visits')

  const m = useMemo(() => {
    if (!mentor) return null
    const mine = data.visits.filter((v) => v.mentor === id)
    const inPeriod = applyFilters(mine, filters)
    const allTime = applyFilters(mine, filters, { period: false })
    const months = monthsInPeriod(data.months, filters)
    const byMonth = countBy(allTime, (v) => v.month)
    // District comparison: all ARPs (or all non-ARPs) under the same filters
    const peers = applyFilters(data.visits, filters).filter((v) => (data.mentors[v.mentor].category === 'ARP') === isArp)
    return {
      inPeriod,
      allTime,
      months,
      periodTarget: target * months.length,
      byMonth,
      sum: mentorSummary(inPeriod, data.kpiIndex.feedback),
      peers,
      dayCounts: countBy(inPeriod, (v) => v.date),
      gs: countBy(inPeriod, (v) => `${v.grade}|${v.subject}`),
      stypes: countBy(inPeriod, (v) => v.stype),
    }
  }, [data, filters, id, mentor, isArp, target])

  if (!mentor) return <Empty>Mentor not found.</Empty>

  const pl = periodLabel(filters)
  const { sum } = m
  const progress = m.periodTarget ? (sum.visits / m.periodTarget) * 100 : null
  const schoolRows = [...groupBy(m.inPeriod, (v) => v.school)].map(([sid, vs]) => {
    const s = data.schools[sid]
    return {
      ...s,
      visits: vs.length,
      grades: [...new Set(vs.map((v) => v.grade).filter(Boolean))].sort(),
      last: vs.reduce((a, v) => (v.date > a ? v.date : a), ''),
    }
  })
  const repeatSchools = schoolRows.filter((s) => s.visits > 1).length

  return (
    <div>
      <div className="page-head">
        <div className="crumbs">
          <a href="#" onClick={(e) => { e.preventDefault(); nav(back) }}>{isArp ? 'ARP Visits' : 'DIET Mentors & SRGs'}</a> / {mentor.name}
        </div>
        <h1>{mentor.name}</h1>
        <div className="page-meta">
          <Pill>{mentor.designation}</Pill> <Pill>{mentor.block} block</Pill> <span className="muted">· {pl}</span>
        </div>
      </div>

      <div className="stats">
        <StatCard
          label="Visits"
          value={fmt.int(sum.visits)}
          sub={isArp ? `target ${m.periodTarget} · ${fmt.pct(progress)} achieved` : `in ${pl}`}
          status={isArp ? statusFor(progress, 100, 50) : 'neutral'}
        />
        <StatCard label="Schools visited" value={fmt.int(sum.schools)} sub={`${repeatSchools} visited more than once`} />
        <StatCard label="Days in the field" value={fmt.int(sum.days)} sub={`avg ${fmt.int(sum.avgMin)} min per visit`} />
        <StatCard label="Grades 1-3 FLN share" value={fmt.pct(sum.flnShare)} sub="of visits were FLN Hindi/Maths classes" />
        <StatCard label="FLN practice score" value={fmt.pct(sum.flnScore)} sub={`in classrooms this mentor observed · peers ${fmt.pct(avg(m.peers, 'flnScore'))}`} />
        <StatCard label="Gr 4-8 lesson plan ready" value={fmt.pct(kpiRate(m.inPeriod, data.kpiIndex.lp_ready).pct)} sub={`peers ${fmt.pct(kpiRate(m.peers, data.kpiIndex.lp_ready).pct)} · practice score ${fmt.pct(sum.upScore)}`} />
        <StatCard label="Feedback to teacher" value={fmt.pct(sum.feedback)} sub="FLN visits with a feedback session" />
      </div>

      <div className={filters.ptype === 'month' ? 'grid-2' : ''}>
        <Card title="Visits per month" sub={isArp ? `Target ${target} per month · click a month to open it` : 'Click a month to open it'}>
          <ColumnChart
            data={data.months.map((mo) => ({
              key: mo,
              label: monthShort(mo),
              value: m.byMonth.get(mo) || 0,
              tip: `${monthLabel(mo)}: ${m.byMonth.get(mo) || 0} visits`,
            }))}
            reference={isArp ? { value: target, label: `Target ${target}` } : undefined}
            selectedKey={filters.ptype === 'month' ? filters.pval : null}
            onSelect={(mo) => setFilters({ ptype: 'month', pval: mo })}
          />
        </Card>
        {filters.ptype === 'month' && (
          <Card title={`Field days · ${monthLabel(filters.pval)}`} sub="Darker = more visits that day">
            <MonthCalendar month={filters.pval} counts={m.dayCounts} />
          </Card>
        )}
      </div>

      <div className="grid-2">
        <Card title="Grades and subjects observed" sub={pl}>
          <Heatmap
            rowHeader="Grade"
            rows={[1, 2, 3, 4, 5, 6, 7, 8].map((g) => ({ key: g, label: `Grade ${g}` }))}
            cols={data.meta.subjects.map((s) => ({ key: s, label: s }))}
            max={Math.max(1, ...m.gs.values())}
            cell={(g, s) => {
              const n = m.gs.get(`${g}|${s}`)
              return n ? { value: n, text: n, tip: `Grade ${g} ${s}: ${n}` } : null
            }}
          />
        </Card>
        <Card title="Visits by school type" sub={`${pl} · click to filter`}>
          <StypeBars stypes={m.stypes} total={m.inPeriod.length} onSelect={(t) => setFilters({ stype: t })} />
        </Card>
      </div>

      <KpiProfile data={data} visits={m.inPeriod} peers={m.peers} />

      {data.adoptedBy.has(id) && <AdoptedSchools data={data} id={id} filters={filters} nav={nav} />}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'visits', label: `Visit log (${m.inPeriod.length})` },
          { value: 'schools', label: `Schools (${schoolRows.length})` },
        ]}
      />
      {tab === 'visits' ? (
        <Section>
          <DataTable
            csvName={`${mentor.name}-visits-${pl}.csv`}
            rows={m.inPeriod}
            searchText={(v) => `${data.schools[v.school].name} ${v.teacher || ''} ${v.subject || ''}`}
            initialSort={{ key: 'date', dir: 'desc' }}
            onRowClick={(v) => nav('schools', v.school)}
            columns={[
              { key: 'date', label: 'Date', value: (v) => v.date, render: (v) => fmt.date(v.date) },
              { key: 'school', label: 'School', value: (v) => data.schools[v.school].name, render: (v) => <span className="link">{data.schools[v.school].name}</span> },
              { key: 'udise', label: 'UDISE', value: (v) => data.schools[v.school].udise },
              { key: 'stype', label: 'Type', value: (v) => v.stype },
              { key: 'grade', label: 'Grade', value: (v) => v.grade, align: 'right' },
              { key: 'subject', label: 'Subject', value: (v) => v.subject },
              { key: 'form', label: 'Form', value: (v) => FORM_LABEL[v.form] },
              { key: 'teacher', label: 'Teacher observed', value: (v) => v.teacher },
              { key: 'minutes', label: 'Minutes', value: (v) => v.minutes, align: 'right', render: (v) => fmt.int(v.minutes) },
              { key: 'cls', label: 'Class present', value: (v) => (v.clsEnr ? v.clsPres / v.clsEnr : null), align: 'right', render: (v) => (v.clsEnr ? `${v.clsPres ?? '—'} / ${v.clsEnr}` : '—'), csv: (v) => `${v.clsPres ?? ''}/${v.clsEnr ?? ''}` },
              { key: 'score', label: 'Practice score', value: (v) => v.flnScore ?? v.upScore, align: 'right', render: (v) => fmt.pct(v.flnScore ?? v.upScore) },
            ]}
          />
        </Section>
      ) : (
        <Section>
          <DataTable
            csvName={`${mentor.name}-schools-${pl}.csv`}
            rows={schoolRows}
            searchText={(s) => `${s.name} ${s.udise}`}
            initialSort={{ key: 'visits', dir: 'desc' }}
            onRowClick={(s) => nav('schools', s.id)}
            columns={[
              { key: 'name', label: 'School', value: (s) => s.name, render: (s) => <span className="link">{s.name}</span> },
              { key: 'udise', label: 'UDISE', value: (s) => s.udise },
              { key: 'block', label: 'Block', value: (s) => s.block },
              { key: 'type', label: 'Type', value: (s) => s.type },
              { key: 'visits', label: 'Visits', value: (s) => s.visits, align: 'right' },
              { key: 'grades', label: 'Grades observed', value: (s) => s.grades.join(', '), render: (s) => <GradeChips grades={s.grades} /> },
              { key: 'last', label: 'Last visit', value: (s) => s.last, render: (s) => fmt.date(s.last) },
            ]}
          />
        </Section>
      )}
    </div>
  )
}

function avg(visits, key) {
  const xs = visits.map((v) => v[key]).filter((x) => x != null)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export function GradeChips({ grades }) {
  return (
    <span className="chips">
      {grades.map((g) => (
        <span key={g} className={`chip ${g <= 3 ? 'chip-fln' : ''}`}>G{g}</span>
      ))}
    </span>
  )
}

function StypeBars({ stypes, total, onSelect }) {
  return (
    <BarList
      data={['PS', 'UPS', 'Composite'].map((t) => ({
        key: t,
        label: { PS: 'Primary (PS)', UPS: 'Upper Primary (UPS)', Composite: 'Composite' }[t],
        value: stypes.get(t) || 0,
        max: Math.max(1, total),
        sub: fmt.pct(((stypes.get(t) || 0) / Math.max(1, total)) * 100),
      }))}
      valueFormat={(v) => fmt.int(v)}
      onSelect={onSelect}
    />
  )
}

function KpiProfile({ data, visits, peers }) {
  const fln = data.meta.kpis.filter((k) => k.group === 'fln')
  const rows = fln
    .map((k) => {
      const i = data.kpiIndex[k.id]
      const r = kpiRate(visits, i)
      const p = kpiRate(peers, i)
      return { key: k.id, label: k.label, value: r.pct, sub: `n=${r.n} · peers ${fmt.pct(p.pct)}` }
    })
    .filter((r) => r.value != null)
  return (
    <Card title="FLN classroom practices observed" sub="% of this mentor's Grade 1-3 Hindi/Maths observations · compared with peers under the same filters">
      {rows.length ? <BarList data={rows} /> : <Empty>No FLN classroom observations in this selection.</Empty>}
    </Card>
  )
}

// This ARP's SSP-adopted schools, month by month since the programme start:
// who visited each one, in which grades, and the practice score recorded.
function AdoptedSchools({ data, id, filters, nav }) {
  const months = data.months.filter((mo) => mo >= data.meta.sspFrom)
  const adopted = data.adoptedBy.get(id)
  const visits = applyFilters(data.visits, { ...filters, ssp: '' }, { period: false }).filter((v) => v.month >= data.meta.sspFrom && v.ssp)
  const bySm = groupBy(visits, (v) => `${v.school}|${v.month}`)
  return (
    <Card
      title={`Adopted schools (SSP) · ${adopted.length}`}
      sub="Each cell: visits that month · ★ = this ARP visited · grades observed · FLN / Gr 4-8 practice score"
    >
      <div className="heatmap-wrap">
        <table className="heatmap matrix">
          <thead>
            <tr>
              <th className="hm-rowhead">School</th>
              {months.map((mo) => (
                <th key={mo} className="hm-colhead">{monthShort(mo)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {adopted.map((s) => (
              <tr key={s.id}>
                <th className="hm-rowhead">
                  <a href="#" onClick={(e) => { e.preventDefault(); nav('schools', s.id) }}>{s.name}</a>
                </th>
                {months.map((mo) => {
                  const vs = bySm.get(`${s.id}|${mo}`)
                  if (!vs) return <td key={mo} className="hm-cell matrix-cell"><span className="mc-empty">—</span></td>
                  const own = vs.some((v) => v.ownArp)
                  const sc = mean(vs.map((v) => v.flnScore ?? v.upScore))
                  const others = [...new Set(vs.filter((v) => !v.ownArp).map((v) => data.mentors[v.mentor].name))]
                  return (
                    <td
                      key={mo}
                      className={`hm-cell matrix-cell${own ? ' own-cell' : ''}`}
                      title={`${vs.length} visit(s)${others.length ? ` · also visited by ${others.join(', ')}` : ''}`}
                    >
                      <div className="mc-main">
                        {vs.length}
                        {own && <sup>★</sup>} <span className="muted">{fmt.pct(sc)}</span>
                      </div>
                      <div className="mc-grades">{[...new Set(vs.map((v) => v.grade).filter(Boolean))].sort().map((g) => `G${g}`).join(' ')}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
