import { useMemo, useState } from 'react'
import { applyFilters, fmt, groupBy, mean, periodLabel } from '../data.js'
import { DataTable, Section, StatCard, Tabs } from '../components/ui.jsx'
import { GradeChips } from './MentorDetail.jsx'

export default function Schools({ data, filters, nav }) {
  const [view, setView] = useState('all')

  const m = useMemo(() => {
    const universe = data.schools.filter((s) => (!filters.block || s.block === filters.block) && (!filters.stype || s.type === filters.stype))
    const inPeriod = groupBy(applyFilters(data.visits, filters), (v) => v.school)
    const allTime = groupBy(applyFilters(data.visits, { ...filters, grade: '', subject: '' }, { period: false }), (v) => v.school)
    const rows = universe.map((s) => {
      const vs = inPeriod.get(s.id) || []
      const all = allTime.get(s.id) || []
      return {
        ...s,
        visits: vs.length,
        allVisits: all.length,
        grades: [...new Set(vs.map((v) => v.grade).filter(Boolean))].sort(),
        mentors: new Set(vs.map((v) => v.mentor)).size,
        last: vs.reduce((a, v) => (v.date > a ? v.date : a), ''),
        lastEver: all.reduce((a, v) => (v.date > a ? v.date : a), ''),
        fln: mean(vs.map((v) => v.flnScore)),
        up: mean(vs.map((v) => v.upScore)),
      }
    })
    return { rows }
  }, [data, filters])

  const pl = periodLabel(filters)
  const visited = m.rows.filter((r) => r.visits > 0)
  const notVisited = m.rows.filter((r) => r.visits === 0)
  const three = visited.filter((r) => r.visits >= 3).length
  const shown = view === 'not' ? notVisited : view === 'visited' ? visited : m.rows

  return (
    <div>
      <div className="page-head">
        <div className="crumbs">Dashboard / Schools</div>
        <h1>Schools · {pl}</h1>
      </div>

      <div className="stats">
        <StatCard label="Schools" value={fmt.int(m.rows.length)} sub="that received at least one visit since Jul 2025" />
        <StatCard label="Visited" value={fmt.int(visited.length)} sub={`${fmt.pct((visited.length / Math.max(1, m.rows.length)) * 100)} of schools · ${pl}`} />
        <StatCard label="Not visited" value={fmt.int(notVisited.length)} sub={`in ${pl}`} status={notVisited.length === 0 ? 'good' : 'neutral'} onClick={() => setView('not')} />
        <StatCard label="Visited 3+ times" value={fmt.int(three)} sub={`in ${pl}`} />
        <StatCard label="Visits per visited school" value={fmt.num1(visited.length ? visited.reduce((a, r) => a + r.visits, 0) / visited.length : null)} />
      </div>

      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: 'all', label: `All schools (${m.rows.length})` },
          { value: 'visited', label: `Visited (${visited.length})` },
          { value: 'not', label: `Not visited (${notVisited.length})` },
        ]}
      />
      <Section sub="The school list is built from the visit data, so a school never visited since July 2025 will not appear. Click a school to see every visit.">
        <DataTable
          key={view}
          csvName={`schools-${view}-${pl}.csv`}
          rows={shown}
          searchText={(s) => `${s.name} ${s.udise} ${s.block}`}
          onRowClick={(s) => nav('schools', s.id)}
          initialSort={view === 'not' ? { key: 'lastEver', dir: 'asc' } : { key: 'visits', dir: 'desc' }}
          columns={[
            { key: 'name', label: 'School', value: (s) => s.name, render: (s) => <span className="link">{s.name}</span> },
            { key: 'udise', label: 'UDISE', value: (s) => s.udise },
            { key: 'block', label: 'Block', value: (s) => s.block },
            { key: 'type', label: 'Type', value: (s) => s.type },
            { key: 'visits', label: `Visits (${pl})`, value: (s) => s.visits, align: 'right' },
            { key: 'grades', label: 'Grades observed', value: (s) => s.grades.join(', '), render: (s) => <GradeChips grades={s.grades} />, sortable: false },
            { key: 'mentors', label: 'Mentors', value: (s) => s.mentors, align: 'right' },
            { key: 'allVisits', label: 'Visits (all time)', value: (s) => s.allVisits, align: 'right' },
            { key: 'last', label: view === 'not' ? 'Last visit ever' : 'Last visit', value: (s) => (view === 'not' ? s.lastEver : s.last) || null, render: (s) => fmt.date(view === 'not' ? s.lastEver : s.last) },
            { key: 'lastEver', label: 'Last visit ever', value: (s) => s.lastEver || null, render: (s) => fmt.date(s.lastEver) },
            { key: 'fln', label: 'FLN score', value: (s) => s.fln, align: 'right', render: (s) => fmt.pct(s.fln) },
            { key: 'up', label: 'Gr 4-8 score', value: (s) => s.up, align: 'right', render: (s) => fmt.pct(s.up) },
          ].filter((c) => !(view !== 'not' && c.key === 'lastEver') && !(view === 'not' && c.key === 'last'))}
        />
      </Section>
    </div>
  )
}
