import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Sequential blue ramp (light -> dark) from the reference data-viz palette.
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281']

export function seqColor(t) {
  if (t == null || Number.isNaN(t)) return null
  const i = Math.max(0, Math.min(SEQ.length - 1, Math.round(t * (SEQ.length - 1))))
  return { bg: SEQ[i], fg: i >= 6 ? '#ffffff' : '#0b0b0b' }
}

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * p
}

function Tooltip({ tip }) {
  if (!tip) return null
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  )
}

/**
 * Vertical columns, one series. data: [{ key, label, value, tip? }]
 * reference: optional { value, label } drawn as a solid hairline (e.g. a target).
 */
export function ColumnChart({ data, height = 220, reference, valueFormat = (v) => v, onSelect, selectedKey }) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState(null)
  const pad = { l: 40, r: 12, t: 16, b: 28 }
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b
  const max = niceMax(Math.max(1, ...data.map((d) => d.value || 0), reference?.value || 0))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const slot = plotW / Math.max(1, data.length)
  const barW = Math.max(4, Math.min(36, slot - 6))
  const y = (v) => pad.t + plotH - (v / max) * plotH
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 48)))

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label="Column chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={pad.l - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {valueFormat(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2
          const h = Math.max(0, y(0) - y(d.value || 0))
          const r = Math.min(4, barW / 2, h)
          const x0 = cx - barW / 2
          const top = y(0) - h
          const dim = selectedKey && selectedKey !== d.key
          return (
            <g key={d.key}>
              {h > 0 && (
                <path
                  d={`M${x0},${y(0)} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${y(0)} Z`}
                  className="bar"
                  opacity={dim ? 0.35 : 1}
                />
              )}
              <rect
                x={pad.l + slot * i}
                y={pad.t}
                width={slot}
                height={plotH}
                fill="transparent"
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onClick={onSelect ? () => onSelect(d.key) : undefined}
                onMouseMove={(e) => {
                  const box = ref.current.getBoundingClientRect()
                  setTip({ x: e.clientX - box.left + 12, y: e.clientY - box.top - 10, content: d.tip || `${d.label}: ${valueFormat(d.value)}` })
                }}
              />
              {i % labelEvery === 0 && (
                <text x={cx} y={height - 8} className="tick" textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
        {reference && reference.value <= max && (
          <g>
            <line x1={pad.l} x2={width - pad.r} y1={y(reference.value)} y2={y(reference.value)} className="ref-line" />
            <text x={width - pad.r} y={y(reference.value) - 5} className="ref-label" textAnchor="end">
              {reference.label}
            </text>
          </g>
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

// Y-axis top for a chart with a target line: 10% headroom, rounded up to a
// multiple of 20 so the quarter gridlines are multiples of 5 (target 30 -> 0, 10, 20, 30, 40).
export function yMaxWithTarget(values, target) {
  return 20 * Math.ceil((Math.max(target, ...values.filter((v) => v != null)) * 1.1) / 20)
}

// Categorical slots from the reference palette, in fixed order (never cycled).
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']

/**
 * Lines over a shared x axis (months). One y scale only.
 * xs: [{ key, label }], series: [{ key, label, values: [number|null], color? }]
 * reference: optional { value, label } drawn as a solid hairline (e.g. a target).
 */
export function LineChart({ xs, series, height = 230, yMax = 100, valueFormat = (v) => `${Math.round(v)}%`, reference, onSelect, selectedKey }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const pad = { l: 40, r: 96, t: 14, b: 28 }
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b
  const max = yMax ?? niceMax(Math.max(1, reference?.value || 0, ...series.flatMap((s) => s.values.filter((v) => v != null))))
  const x = (i) => pad.l + (xs.length === 1 ? plotW / 2 : (plotW * i) / (xs.length - 1))
  const y = (v) => pad.t + plotH - (v / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const colorOf = (s, i) => s.color || SERIES[i]
  // Thin the month labels to fit; the selected month always keeps its label.
  const labelEvery = Math.ceil(xs.length / Math.max(1, Math.floor(plotW / 44)))
  const sel = xs.findIndex((xv) => xv.key === selectedKey)
  const showLabel = (i) => i === sel || (i % labelEvery === 0 && (sel < 0 || Math.abs(i - sel) >= labelEvery))

  const path = (vals) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i)},${y(v)} `
      pen = true
    })
    return d
  }

  // End labels, nudged apart so they never overlap.
  const ends = series
    .map((s, i) => {
      let j = s.values.length - 1
      while (j >= 0 && s.values[j] == null) j--
      return j < 0 ? null : { i, s, y: y(s.values[j]), v: s.values[j] }
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y)
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <div className="legend">
        {series.map((s, i) => (
          <span key={s.key} className="legend-item">
            <span className="legend-swatch" style={{ background: colorOf(s, i) }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg width={width} height={height} role="img" aria-label="Line chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={pad.l - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {valueFormat(t)}
            </text>
          </g>
        ))}
        {xs.map((xv, i) => showLabel(i) && (
          <text key={xv.key} x={x(i)} y={height - 8} className={`tick${selectedKey === xv.key ? ' tick-selected' : ''}`} textAnchor="middle">
            {xv.label}
          </text>
        ))}
        {reference && reference.value <= max && (
          <g>
            <line x1={pad.l} x2={width - pad.r} y1={y(reference.value)} y2={y(reference.value)} className="ref-line" />
            <text x={width - pad.r} y={y(reference.value) - 5} className="ref-label" textAnchor="end">
              {reference.label}
            </text>
          </g>
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} className="crosshair" />}
        {series.map((s, i) => (
          <g key={s.key}>
            <path d={path(s.values)} fill="none" stroke={colorOf(s, i)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, j) =>
              v == null ? null : (
                <circle key={j} cx={x(j)} cy={y(v)} r={hover === j ? 5 : 4} fill={colorOf(s, i)} stroke="var(--surface)" strokeWidth="2" />
              ),
            )}
          </g>
        ))}
        {ends.map((e) => (
          <text key={e.s.key} x={width - pad.r + 8} y={e.y} className="end-label" dominantBaseline="middle">
            {valueFormat(e.v)} {e.s.short || ''}
          </text>
        ))}
        {xs.map((xv, i) => (
          <rect
            key={xv.key}
            x={x(i) - plotW / Math.max(2, xs.length - 1) / 2}
            y={pad.t}
            width={plotW / Math.max(1, xs.length - 1)}
            height={plotH}
            fill="transparent"
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(i)}
            onClick={onSelect ? () => onSelect(xv.key) : undefined}
          />
        ))}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, width - 180), top: pad.t }}>
          <b>{xs[hover].label}</b>
          {series.map((s, i) => (
            <div key={s.key}>
              <span className="legend-swatch" style={{ background: colorOf(s, i) }} /> {s.label}: {s.values[hover] == null ? '—' : valueFormat(s.values[hover])}
              {s.notes?.[hover] ? <span className="muted"> {s.notes[hover]}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Horizontal bars as HTML rows: label | bar | value. data: [{ key, label, value, max?, sub?, tip? }]
 */
export function BarList({ data, max = 100, valueFormat = (v) => `${Math.round(v)}%`, onSelect }) {
  return (
    <div className="barlist">
      {data.map((d) => (
        <div
          key={d.key}
          className={`barlist-row${onSelect ? ' clickable' : ''}`}
          onClick={onSelect ? () => onSelect(d.key) : undefined}
          title={d.tip}
        >
          <div className="barlist-label">{d.label}</div>
          <div className="barlist-track">
            {d.value != null && <div className="barlist-fill" style={{ width: `${Math.min(100, (d.value / (d.max ?? max)) * 100)}%` }} />}
          </div>
          <div className="barlist-value">
            {d.value == null ? '—' : valueFormat(d.value)}
            {d.sub && <span className="barlist-sub">{d.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Heatmap table. rows: [{ key, label }], cols: [{ key, label }],
 * cell(rowKey, colKey) -> { value, text, tip } | null. value in [0, max].
 */
export function Heatmap({ rows, cols, cell, max = 100, rowHeader = '', onRowClick, legend }) {
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th className="hm-rowhead">{rowHeader}</th>
            {cols.map((c) => (
              <th key={c.key} className="hm-colhead">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r.key) : undefined}>
              <th className="hm-rowhead" title={r.title || r.label}>{r.label}</th>
              {cols.map((c) => {
                const v = cell(r.key, c.key)
                const col = v && v.value != null ? seqColor(v.value / max) : null
                return (
                  <td
                    key={c.key}
                    className="hm-cell"
                    style={col ? { background: col.bg, color: col.fg } : undefined}
                    title={v?.tip}
                  >
                    {v ? v.text : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {legend && <HeatLegend {...legend} />}
    </div>
  )
}

export function HeatLegend({ low = '0', high = '100%', label }) {
  return (
    <div className="hm-legend">
      {label && <span>{label}</span>}
      <span>{low}</span>
      <span className="hm-legend-ramp" style={{ background: `linear-gradient(90deg, ${SEQ[0]}, ${SEQ[SEQ.length - 1]})` }} />
      <span>{high}</span>
    </div>
  )
}

// Calendar strip for one month: one cell per day, shaded by visit count.
export function MonthCalendar({ month, counts, max = 3 }) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7 // Monday = 0
  const cells = []
  for (let i = 0; i < first; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  return (
    <div className="cal">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
        <div key={`h${i}`} className="cal-head">{d}</div>
      ))}
      {cells.map((d, i) => {
        if (d == null) return <div key={`e${i}`} />
        const key = `${month}-${String(d).padStart(2, '0')}`
        const n = counts.get(key) || 0
        const col = n ? seqColor(0.35 + (0.65 * Math.min(n, max)) / max) : null
        const weekday = (first + d - 1) % 7
        return (
          <div
            key={key}
            className={`cal-day${weekday === 6 ? ' cal-sun' : ''}`}
            style={col ? { background: col.bg, color: col.fg } : undefined}
            title={`${d} ${month}: ${n} visit${n === 1 ? '' : 's'}`}
          >
            {d}
          </div>
        )
      })}
    </div>
  )
}

export function useDebounced(value, ms = 150) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * 100% stacked columns: one column per x, split into ordered levels.
 * xs: [{ key, label }], levels: [{ key, label, color }],
 * value(xKey) -> { n, [levelKey]: count } | null (null = no data, empty slot).
 */
export function StackedShareChart({ xs, levels, value, height = 230, onSelect, selectedKey, note }) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState(null)
  const pad = { l: 40, r: 12, t: 12, b: 28 }
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b
  const slot = plotW / Math.max(1, xs.length)
  const barW = Math.max(6, Math.min(36, slot - 6))
  const y = (p) => pad.t + plotH - (p / 100) * plotH
  const labelEvery = Math.ceil(xs.length / Math.max(1, Math.floor(plotW / 48)))
  const pct = (d, k) => (d.n ? ((d[k] || 0) / d.n) * 100 : 0)

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <div className="legend">
        {levels.map((l) => (
          <span key={l.key} className="legend-item">
            <span className="legend-swatch" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <svg width={width} height={height} role="img" aria-label="Stacked share chart">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={pad.l - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{t}%</text>
          </g>
        ))}
        {xs.map((xv, i) => {
          const d = value(xv.key)
          const cx = pad.l + slot * i + slot / 2
          const dim = selectedKey && selectedKey !== xv.key
          let acc = 0
          return (
            <g key={xv.key} opacity={dim ? 0.35 : 1}>
              {d && d.n > 0 &&
                levels.map((l) => {
                  const p = pct(d, l.key)
                  const top = y(acc + p)
                  const h = y(acc) - top
                  acc += p
                  // 1px surface gap between segments
                  return h > 0 ? <rect key={l.key} x={cx - barW / 2} y={top} width={barW} height={Math.max(0, h - 1)} fill={l.color} /> : null
                })}
              <rect
                x={pad.l + slot * i}
                y={pad.t}
                width={slot}
                height={plotH}
                fill="transparent"
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onClick={onSelect ? () => onSelect(xv.key) : undefined}
                onMouseMove={(e) => {
                  const box = ref.current.getBoundingClientRect()
                  setTip({
                    x: Math.min(e.clientX - box.left + 12, width - 200),
                    y: e.clientY - box.top - 10,
                    content: (
                      <>
                        <b>{xv.label}</b>
                        {d && d.n ? (
                          <>
                            <div>{d.n.toLocaleString('en-IN')} students assessed</div>
                            {levels.map((l) => (
                              <div key={l.key}>
                                <span className="legend-swatch" style={{ background: l.color }} /> {l.label}: {d[l.key] == null ? '—' : `${Math.round(pct(d, l.key))}% (${d[l.key]})`}
                              </div>
                            ))}
                          </>
                        ) : (
                          <div>No spot assessment</div>
                        )}
                      </>
                    ),
                  })
                }}
              />
              {i % labelEvery === 0 && (
                <text x={cx} y={height - 8} className={`tick${selectedKey === xv.key ? ' tick-selected' : ''}`} textAnchor="middle">{xv.label}</text>
              )}
            </g>
          )
        })}
      </svg>
      {note && <div className="chart-note">{note}</div>}
      <Tooltip tip={tip} />
    </div>
  )
}

// Thin inline bar of level shares, for table cells. s: spotSummary()-like totals.
export function LevelBar({ s, levels, wide = false }) {
  if (!s || !s.n) return wide ? null : <span className="muted">—</span>
  return (
    <span className={`levelbar${wide ? ' levelbar-wide' : ''}`} title={levels.map((l) => `${l.label} ${s[l.key] ?? 0}`).join(' · ') + ` of ${s.n}`}>
      {levels.map((l) => (s[l.key] ? <span key={l.key} style={{ width: `${(s[l.key] / s.n) * 100}%`, background: l.color }} /> : null))}
    </span>
  )
}

// Table cell for a spot result: "3/5" Saksham with the level bar beside it.
export function SpotBadge({ s, levels }) {
  if (!s || !s.n) return <span className="muted">—</span>
  return (
    <span className="spot-badge">
      <b>{s.saksham ?? 0}/{s.n}</b>
      <LevelBar s={s} levels={levels} />
    </span>
  )
}
