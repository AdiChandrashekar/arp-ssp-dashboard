import { useMemo, useState } from 'react'
import { applyFilters, attendance, fmt, groupBy, inPeriod, kpiRate, monthShort, periodLabel } from '../data.js'
import { BarList, Heatmap } from '../components/charts.jsx'
import { Card, Empty, StatCard, Tabs } from '../components/ui.jsx'

const GROUPS = [
  { value: 'fln', label: 'FLN classrooms (Gr 1-3)', note: 'Grade 1-3 Hindi and Maths classrooms, observed with the FLN checklists.' },
  { value: 'upper', label: 'Grades 4-8 classrooms', note: 'Grade 4-8 classrooms (all subjects), observed with the general teaching checklist. Some items are only asked when an earlier answer is "yes", so n varies.' },
  { value: 'school', label: 'School-level', note: 'Recorded once per visit, whatever class was observed.' },
]

export default function Kpis({ data, filters, setFilters }) {
  const [group, setGroup] = useState('fln')
  const kpis = data.meta.kpis.filter((k) => k.group === group)

  const m = useMemo(() => {
    const inPeriod = applyFilters(data.visits, filters)
    const allTime = applyFilters(data.visits, filters, { period: false })
    return {
      inPeriod,
      byMonth: groupBy(allTime, (v) => v.month),
      byBlock: groupBy(inPeriod, (v) => v.block),
    }
  }, [data, filters])

  const pl = periodLabel(filters)
  const rates = kpis.map((k) => ({ k, r: kpiRate(m.inPeriod, data.kpiIndex[k.id]) }))
  const sorted = [...rates].sort((a, b) => (a.r.pct ?? 999) - (b.r.pct ?? 999))
  const weakest = sorted.filter((x) => x.r.n >= 20).slice(0, 3)
  const n = Math.max(0, ...rates.map((x) => x.r.n))
  const note = GROUPS.find((g) => g.value === group).note

  return (
    <div>
      <div className="page-head">
        <div className="crumbs">Dashboard / Academic KPIs</div>
        <h1>Academic KPIs · {pl}</h1>
      </div>

      <Tabs value={group} onChange={setGroup} tabs={GROUPS} />
      <p className="muted small">{note} Each KPI is the share of observations where the practice was seen, out of those where the question applied.</p>

      {group === 'school' && (
        <div className="stats">
          <StatCard label="Student attendance" value={fmt.pct(attendance(m.inPeriod, 'stuPres', 'stuEnr'))} sub="children present ÷ enrolled, on visit days" />
          <StatCard label="Observed-class attendance" value={fmt.pct(attendance(m.inPeriod, 'clsPres', 'clsEnr'))} sub="in the class the mentor observed" />
          <StatCard label="Teacher attendance" value={fmt.pct(attendance(m.inPeriod, 'tchPres', 'tchPos'))} sub="teachers present ÷ in position" />
          <StatCard label="CWSN attendance" value={fmt.pct(attendance(m.inPeriod, 'cwsnPres', 'cwsnEnr'))} sub="children with disabilities" />
        </div>
      )}

      {n === 0 ? (
        <Empty>No observations of this kind match the filters. Try a different grade or subject.</Empty>
      ) : (
        <>
          {weakest.length > 0 && (
            <div className="narrative">
              Weakest practices {inPeriod(filters)}:{' '}
              {weakest.map((x, i) => (
                <span key={x.k.id}>
                  {i > 0 && (i === weakest.length - 1 ? ' and ' : ', ')}
                  <strong>{x.k.label}</strong> ({fmt.pct(x.r.pct)})
                </span>
              ))}
              .
            </div>
          )}

          <div className="grid-2">
            <Card title={`KPIs · ${pl}`} sub={`% of observations · up to ${fmt.int(n)} observations`}>
              <BarList data={rates.map(({ k, r }) => ({ key: k.id, label: k.label, value: r.pct, sub: `n=${fmt.int(r.n)}` }))} />
            </Card>
            <Card title="Block comparison" sub={`${pl} · click a block to filter to it`}>
              <Heatmap
                rowHeader="Block"
                rows={data.blocks.filter((b) => m.byBlock.has(b)).map((b) => ({ key: b, label: b }))}
                cols={kpis.map((k, i) => ({ key: k.id, label: `K${i + 1}` }))}
                cell={(b, kid) => {
                  const r = kpiRate(m.byBlock.get(b) || [], data.kpiIndex[kid])
                  return r.pct == null ? null : { value: r.pct, text: Math.round(r.pct), tip: `${b} · ${kpis.find((k) => k.id === kid).label}: ${fmt.pct(r.pct)} (n=${r.n})` }
                }}
                onRowClick={(b) => setFilters({ block: b })}
                legend={{ low: '0%', high: '100%' }}
              />
              <ol className="kpi-key">
                {kpis.map((k) => (
                  <li key={k.id}>{k.label}</li>
                ))}
              </ol>
            </Card>
          </div>

          <Card title="Month-by-month trend" sub="% of observations each month (period filter ignored)">
            <Heatmap
              rowHeader="KPI"
              rows={kpis.map((k) => ({ key: k.id, label: k.label }))}
              cols={data.months.map((mo) => ({ key: mo, label: monthShort(mo) }))}
              cell={(kid, mo) => {
                const r = kpiRate(m.byMonth.get(mo) || [], data.kpiIndex[kid])
                return r.n < 5 ? null : { value: r.pct, text: Math.round(r.pct), tip: `${monthShort(mo)}: ${fmt.pct(r.pct)} (n=${r.n})` }
              }}
              legend={{ low: '0%', high: '100%', label: 'Blank = fewer than 5 observations' }}
            />
          </Card>
        </>
      )}
    </div>
  )
}
