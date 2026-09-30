import { useMemo } from 'react'
import { applyFilters, attendance, countBy, fmt, groupBy, kpiRate, monthShort, periodLabel } from '../data.js'
import { Card, DataTable, Empty, Pill, Section, StatCard } from '../components/ui.jsx'
import { BarList, ColumnChart, Heatmap } from '../components/charts.jsx'

const FORM_LABEL = { FM: 'FLN Maths', FH: 'FLN Hindi', G: 'Gr 4-8', O: 'Gr 1-3 other' }

export default function SchoolDetail({ data, filters, nav, id }) {
  const school = data.schools[id]

  const m = useMemo(() => {
    if (!school) return null
    const mine = data.visits.filter((v) => v.school === id)
    // On a school page the school's own block/type are fixed; only grade/subject/period filters apply.
    const f = { ...filters, block: '', stype: '' }
    const allTime = applyFilters(mine, f, { period: false })
    const inPeriod = applyFilters(mine, f)
    const byMonth = groupBy(allTime, (v) => v.month)
    return {
      allTime,
      inPeriod,
      byMonth,
      gradeMonth: countBy(allTime, (v) => `${v.grade}|${v.month}`),
      mentors: countBy(allTime, (v) => v.mentor),
    }
  }, [data, filters, id, school])

  if (!school) return <Empty>School not found.</Empty>

  const pl = periodLabel(filters)
  const last = m.allTime.reduce((a, v) => (v.date > a ? v.date : a), '')
  const visitMonths = data.months.filter((mo) => m.byMonth.has(mo))
  const flnKpis = data.meta.kpis.filter((k) => k.group === 'fln' || k.group === 'upper')

  return (
    <div>
      <div className="page-head">
        <div className="crumbs">
          <a href="#" onClick={(e) => { e.preventDefault(); nav('schools') }}>Schools</a> / {school.name}
        </div>
        <h1>{school.name}</h1>
        <div className="page-meta">
          <Pill>UDISE {school.udise}</Pill> <Pill>{school.block} block</Pill> {school.type && <Pill>{school.type}</Pill>} {school.area && <Pill>{school.area}</Pill>}
          {school.ssp ? (
            <span className="pill pill-ssp">
              ARP Focus School · adopted by {school.sspArp != null ? data.mentors[school.sspArp].name : school.sspArpName || 'unknown ARP'}
            </span>
          ) : null}
          {school.po ? <Pill>PO-adopted</Pill> : null}
        </div>
      </div>

      <div className="stats">
        <StatCard label="Visits (all time)" value={fmt.int(m.allTime.length)} sub={`${m.inPeriod.length} in ${pl}`} />
        <StatCard label="Months with a visit" value={`${visitMonths.length} / ${data.months.length}`} sub="since Jul 2025" />
        <StatCard label="Mentors who visited" value={m.mentors.size} sub={[...m.mentors.keys()].map((mid) => data.mentors[mid].name).slice(0, 3).join(', ') + (m.mentors.size > 3 ? '…' : '')} />
        <StatCard label="Last visit" value={fmt.date(last)} />
        <StatCard label="Student attendance" value={fmt.pct(attendance(m.allTime, 'stuPres', 'stuEnr'))} sub="average across visits" />
        <StatCard label="Teacher attendance" value={fmt.pct(attendance(m.allTime, 'tchPres', 'tchPos'))} sub="average across visits" />
      </div>

      <div className="grid-2">
        <Card title="Grades observed, month by month" sub="Number of classroom observations · all time">
          {m.allTime.length ? (
            <Heatmap
              rowHeader="Grade"
              rows={[1, 2, 3, 4, 5, 6, 7, 8].map((g) => ({ key: g, label: `Grade ${g}` }))}
              cols={data.months.map((mo) => ({ key: mo, label: monthShort(mo) }))}
              max={3}
              cell={(g, mo) => {
                const n = m.gradeMonth.get(`${g}|${mo}`)
                return n ? { value: Math.min(n, 3), text: n, tip: `Grade ${g}, ${monthShort(mo)}: ${n}` } : null
              }}
            />
          ) : (
            <Empty />
          )}
        </Card>
        <Card title="Student attendance on visit days" sub="% of enrolled children present, by month">
          <ColumnChart
            data={data.months.map((mo) => {
              const vs = m.byMonth.get(mo) || []
              const a = attendance(vs, 'stuPres', 'stuEnr')
              return { key: mo, label: monthShort(mo), value: a ?? 0, tip: a == null ? `${monthShort(mo)}: no visit` : `${monthShort(mo)}: ${fmt.pct(a)} present` }
            })}
            valueFormat={(v) => `${Math.round(v)}%`}
          />
        </Card>
      </div>

      <Card title="Classroom practices observed in this school" sub={`% of applicable observations, ${pl}`}>
        <BarList
          data={flnKpis
            .map((k) => {
              const r = kpiRate(m.inPeriod, data.kpiIndex[k.id])
              return { key: k.id, label: `${k.group === 'fln' ? 'FLN' : 'Gr 4-8'} · ${k.label}`, value: r.pct, sub: `n=${r.n}` }
            })
            .filter((r) => r.value != null)}
        />
        {m.inPeriod.length === 0 && <Empty>No visits in {pl}.</Empty>}
      </Card>

      <Section title="Visit log" sub="All time · click a row to open the mentor">
        <DataTable
          csvName={`${school.name}-${school.udise}-visits.csv`}
          rows={m.allTime}
          searchText={(v) => `${data.mentors[v.mentor].name} ${v.teacher || ''} ${v.subject || ''}`}
          initialSort={{ key: 'date', dir: 'desc' }}
          onRowClick={(v) => nav(data.mentors[v.mentor].category === 'ARP' ? 'arps' : 'mentors', v.mentor)}
          columns={[
            { key: 'date', label: 'Date', value: (v) => v.date, render: (v) => fmt.date(v.date) },
            {
              key: 'mentor',
              label: 'Mentor',
              value: (v) => data.mentors[v.mentor].name,
              render: (v) => (
                <span className="link">
                  {data.mentors[v.mentor].name}
                  {v.ownArp && <span className="own-tag" title="The ARP who adopted this school"> ★ own ARP</span>}
                </span>
              ),
            },
            { key: 'desig', label: 'Designation', value: (v) => data.mentors[v.mentor].designation },
            { key: 'grade', label: 'Grade', value: (v) => v.grade, align: 'right' },
            { key: 'subject', label: 'Subject', value: (v) => v.subject },
            { key: 'form', label: 'Form', value: (v) => FORM_LABEL[v.form] },
            { key: 'teacher', label: 'Teacher observed', value: (v) => v.teacher },
            { key: 'cls', label: 'Class present', value: (v) => (v.clsEnr ? v.clsPres / v.clsEnr : null), align: 'right', render: (v) => (v.clsEnr ? `${v.clsPres ?? '—'} / ${v.clsEnr}` : '—'), csv: (v) => `${v.clsPres ?? ''}/${v.clsEnr ?? ''}` },
            { key: 'school', label: 'School present', value: (v) => (v.stuEnr ? v.stuPres / v.stuEnr : null), align: 'right', render: (v) => (v.stuEnr ? `${v.stuPres ?? '—'} / ${v.stuEnr}` : '—'), csv: (v) => `${v.stuPres ?? ''}/${v.stuEnr ?? ''}` },
            { key: 'tch', label: 'Teachers present', value: (v) => (v.tchPos ? v.tchPres / v.tchPos : null), align: 'right', render: (v) => (v.tchPos ? `${v.tchPres ?? '—'} / ${v.tchPos}` : '—'), csv: (v) => `${v.tchPres ?? ''}/${v.tchPos ?? ''}` },
            { key: 'score', label: 'Practice score', value: (v) => v.flnScore ?? v.upScore, align: 'right', render: (v) => fmt.pct(v.flnScore ?? v.upScore) },
          ]}
        />
      </Section>
    </div>
  )
}

