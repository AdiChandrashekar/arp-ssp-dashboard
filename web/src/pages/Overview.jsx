import { useMemo } from 'react'
import { applyFilters, attendance, countBy, fmt, groupBy, kpiRate, mean, monthShort, monthLabel, monthsInPeriod, inPeriod, periodLabel, statusFor } from '../data.js'
import { Card, DataTable, Section, StatCard } from '../components/ui.jsx'
import { BarList, ColumnChart, Heatmap } from '../components/charts.jsx'

export default function Overview({ data, filters, setFilters, nav }) {
  const { mentors, schools, meta } = data
  const target = meta.arpMonthlyTarget

  const m = useMemo(() => {
    const inPeriod = applyFilters(data.visits, filters)
    const allTime = applyFilters(data.visits, filters, { period: false })
    const months = monthsInPeriod(data.months, filters)
    const periodTarget = target * months.length

    const roster = mentors.filter((x) => x.category === 'ARP' && (!filters.block || x.block === filters.block))
    const rosterIds = new Set(roster.map((x) => x.id))
    const arpVisits = inPeriod.filter((v) => rosterIds.has(v.mentor))
    const perArp = countBy(arpVisits, (v) => v.mentor)
    const meeting = roster.filter((a) => (perArp.get(a.id) || 0) >= periodTarget).length
    const zero = roster.filter((a) => !perArp.get(a.id)).length

    const schoolUniverse = schools.filter((s) => (!filters.block || s.block === filters.block) && (!filters.stype || s.type === filters.stype))
    const schoolsVisited = new Set(inPeriod.map((v) => v.school))

    // Monthly series (period filter ignored so the trend is always visible)
    const byMonth = groupBy(allTime, (v) => v.month)
    const monthly = data.months.map((mo) => {
      const vs = byMonth.get(mo) || []
      const arp = vs.filter((v) => rosterIds.has(v.mentor))
      const active = new Set(arp.map((v) => v.mentor)).size
      return { mo, visits: vs.length, arpVisits: arp.length, active, perArp: active ? arp.length / active : 0 }
    })

    // Block table
    const byBlock = groupBy(inPeriod, (v) => v.block)
    const blockRows = data.blocks
      .filter((b) => !filters.block || b === filters.block)
      .map((b) => {
        const vs = byBlock.get(b) || []
        const bRoster = mentors.filter((x) => x.category === 'ARP' && x.block === b)
        const bPer = countBy(vs.filter((v) => bRoster.some((a) => a.id === v.mentor)), (v) => v.mentor)
        const bSchools = schools.filter((s) => s.block === b && (!filters.stype || s.type === filters.stype)).length
        return {
          block: b,
          arps: bRoster.length,
          visits: vs.length,
          perArp: bRoster.length ? [...bPer.values()].reduce((a, c) => a + c, 0) / bRoster.length : null,
          meeting: bRoster.length ? (bRoster.filter((a) => (bPer.get(a.id) || 0) >= periodTarget).length / bRoster.length) * 100 : null,
          schools: new Set(vs.map((v) => v.school)).size,
          bSchools,
          fln: mean(vs.map((v) => v.flnScore)),
          up: mean(vs.map((v) => v.upScore)),
          att: attendance(vs, 'stuPres', 'stuEnr'),
        }
      })
      .filter((r) => r.visits > 0 || r.arps > 0)

    // Grade x subject counts
    const gs = countBy(inPeriod, (v) => `${v.grade}|${v.subject}`)
    const stypes = countBy(inPeriod, (v) => v.stype)

    return {
      inPeriod, months, periodTarget, roster, arpVisits, perArp, meeting, zero,
      schoolUniverse, schoolsVisited, monthly, blockRows, gs, stypes,
      fln: mean(inPeriod.map((v) => v.flnScore)),
      up: mean(inPeriod.map((v) => v.upScore)),
      lpReady: kpiRate(inPeriod, data.kpiIndex.lp_ready).pct,
      avgMin: mean(inPeriod.map((v) => v.minutes)),
      stuAtt: attendance(inPeriod, 'stuPres', 'stuEnr'),
      tchAtt: attendance(inPeriod, 'tchPres', 'tchPos'),
    }
  }, [data, filters, mentors, schools, target])

  const pl = periodLabel(filters)
  const active = m.perArp.size
  const avgPerArp = m.roster.length ? m.arpVisits.length / m.roster.length : null
  const meetingPct = m.roster.length ? (m.meeting / m.roster.length) * 100 : null
  const topBlocks = [...m.blockRows].sort((a, b) => b.visits - a.visits)
  const hasFilters = filters.stype || filters.grade || filters.subject

  return (
    <div>
      <div className="page-head">
        <div className="crumbs">Dashboard / Overview</div>
        <h1>{filters.block ? `${filters.block} block` : data.meta.district} · {pl}</h1>
      </div>

      <div className="narrative">
        <strong>{fmt.int(m.inPeriod.length)}</strong> classroom visits {inPeriod(filters)}
        {m.inPeriod.length > 0 && (
          <>
            , {fmt.int(m.arpVisits.length)} of them by ARPs. <strong>{m.meeting} of {m.roster.length}</strong> ARPs reached the target of{' '}
            {m.periodTarget} visits{m.months.length > 1 ? ` (${target} × ${m.months.length} months)` : ''}; {m.zero} made no visit.
            {' '}{fmt.int(m.schoolsVisited.size)} of {fmt.int(m.schoolUniverse.length)} schools were visited.
          </>
        )}
        {hasFilters && <span className="muted"> ARP target counts use only the visits matching the school type / grade / subject filters.</span>}
      </div>

      <div className="stats">
        <StatCard label="Total visits" value={fmt.int(m.inPeriod.length)} sub={`${fmt.int(m.arpVisits.length)} by ARPs · ${fmt.int(m.inPeriod.length - m.arpVisits.length)} by DIET/SRG`} />
        <StatCard label="Active ARPs" value={`${active} / ${m.roster.length}`} sub={`${m.zero} ARPs with no visit`} status={statusFor(m.roster.length ? (active / m.roster.length) * 100 : null, 95, 80)} />
        <StatCard label={`ARPs meeting target (${m.periodTarget})`} value={fmt.pct(meetingPct)} sub={`${m.meeting} of ${m.roster.length} ARPs`} status={statusFor(meetingPct, 80, 50)} onClick={() => nav('arps')} />
        <StatCard label="Visits per ARP" value={fmt.num1(avgPerArp)} sub={`target ${m.periodTarget} in ${pl}`} status={statusFor(avgPerArp == null ? null : (avgPerArp / m.periodTarget) * 100, 100, 75)} />
        <StatCard label="Schools visited" value={`${fmt.int(m.schoolsVisited.size)}`} sub={`of ${fmt.int(m.schoolUniverse.length)} schools (${fmt.pct((m.schoolsVisited.size / Math.max(1, m.schoolUniverse.length)) * 100)})`} onClick={() => nav('schools')} />
        <StatCard label="FLN practice score" value={fmt.pct(m.fln)} sub="Grades 1-3 Hindi & Maths classrooms" status={statusFor(m.fln, 80, 65)} onClick={() => nav('kpis')} />
        <StatCard label="Gr 4-8 lesson plan ready" value={fmt.pct(m.lpReady)} sub={`practice score ${fmt.pct(m.up)} in classes with a plan`} status={statusFor(m.lpReady, 85, 70)} onClick={() => nav('kpis')} />
        <StatCard label="Student attendance" value={fmt.pct(m.stuAtt)} sub={`Teacher attendance ${fmt.pct(m.tchAtt)} · avg visit ${fmt.int(m.avgMin)} min`} />
      </div>

      <div className="grid-2">
        <Card title="Visits per month" sub="All mentors · click a month to open it">
          <ColumnChart
            data={m.monthly.map((d) => ({
              key: d.mo,
              label: monthShort(d.mo),
              value: d.visits,
              tip: (
                <>
                  <b>{monthLabel(d.mo)}</b>
                  <div>{fmt.int(d.visits)} visits</div>
                  <div>{fmt.int(d.arpVisits)} by {d.active} ARPs</div>
                </>
              ),
            }))}
            valueFormat={(v) => fmt.int(v)}
            selectedKey={filters.ptype === 'month' ? filters.pval : null}
            onSelect={(mo) => setFilters({ ptype: 'month', pval: mo })}
          />
        </Card>
        <Card title="Visits per active ARP" sub={`Average per ARP who made at least one visit · target ${target}`}>
          <ColumnChart
            data={m.monthly.map((d) => ({
              key: d.mo,
              label: monthShort(d.mo),
              value: d.perArp,
              tip: (
                <>
                  <b>{monthLabel(d.mo)}</b>
                  <div>{fmt.num1(d.perArp)} visits per active ARP</div>
                  <div>{d.active} active ARPs</div>
                </>
              ),
            }))}
            reference={{ value: target, label: `Target ${target}` }}
            valueFormat={(v) => fmt.int(v)}
            selectedKey={filters.ptype === 'month' ? filters.pval : null}
            onSelect={(mo) => setFilters({ ptype: 'month', pval: mo })}
          />
        </Card>
      </div>

      <Section title="Block-wise performance" sub={`${pl} · click a block to filter the dashboard to it`}>
        <DataTable
          csvName={`blocks-${pl}.csv`}
          searchable={false}
          rows={topBlocks}
          onRowClick={(r) => setFilters({ block: r.block })}
          initialSort={{ key: 'visits', dir: 'desc' }}
          columns={[
            { key: 'block', label: 'Block', value: (r) => r.block },
            { key: 'arps', label: 'ARPs', value: (r) => r.arps, align: 'right' },
            { key: 'visits', label: 'Visits', value: (r) => r.visits, align: 'right', render: (r) => fmt.int(r.visits) },
            { key: 'perArp', label: 'Visits / ARP', value: (r) => r.perArp, align: 'right', render: (r) => fmt.num1(r.perArp) },
            { key: 'meeting', label: 'ARPs at target', value: (r) => r.meeting, align: 'right', render: (r) => fmt.pct(r.meeting) },
            { key: 'schools', label: 'Schools visited', value: (r) => r.schools, align: 'right', render: (r) => `${r.schools} / ${r.bSchools}` },
            { key: 'fln', label: 'FLN score', value: (r) => r.fln, align: 'right', render: (r) => fmt.pct(r.fln) },
            { key: 'up', label: 'Gr 4-8 score', value: (r) => r.up, align: 'right', render: (r) => fmt.pct(r.up) },
            { key: 'att', label: 'Student att.', value: (r) => r.att, align: 'right', render: (r) => fmt.pct(r.att) },
          ]}
        />
      </Section>

      <div className="grid-2">
        <Card title="What was observed" sub={`Visits by grade and subject · ${pl}`}>
          <Heatmap
            rowHeader="Grade"
            rows={[1, 2, 3, 4, 5, 6, 7, 8].map((g) => ({ key: g, label: `Grade ${g}` }))}
            cols={meta.subjects.map((s) => ({ key: s, label: s }))}
            max={Math.max(1, ...m.gs.values())}
            cell={(g, s) => {
              const n = m.gs.get(`${g}|${s}`)
              return n ? { value: n, text: fmt.int(n), tip: `Grade ${g} ${s}: ${n} visits` } : null
            }}
            legend={{ low: '0', high: fmt.int(Math.max(1, ...m.gs.values())), label: 'Visits' }}
          />
        </Card>
        <Card title="Visits by school type" sub={pl}>
          <BarList
            data={['PS', 'UPS', 'Composite'].map((t) => {
              const n = m.stypes.get(t) || 0
              const total = m.schoolUniverse.filter((s) => s.type === t).length
              return {
                key: t,
                label: { PS: 'Primary (PS)', UPS: 'Upper Primary (UPS)', Composite: 'Composite' }[t],
                value: n,
                max: Math.max(1, m.inPeriod.length),
                sub: `${fmt.pct((n / Math.max(1, m.inPeriod.length)) * 100)} · ${total} schools`,
              }
            })}
            valueFormat={(v) => fmt.int(v)}
            onSelect={(t) => setFilters({ stype: t })}
          />
        </Card>
      </div>
    </div>
  )
}
