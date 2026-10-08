import { useMemo, useState } from 'react'

const STATUS_TEXT = { good: 'On track', warning: 'Needs attention', critical: 'Off track' }
const STATUS_ICON = { good: '●', warning: '▲', critical: '■' }

export function StatCard({ label, value, sub, status = 'neutral', onClick, className = '', children }) {
  return (
    <div className={`stat stat-${status}${onClick ? ' clickable' : ''} ${className}`} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {children}
      {sub && <div className="stat-sub">{sub}</div>}
      {status !== 'neutral' && (
        <div className={`stat-status status-${status}`}>
          <span aria-hidden>{STATUS_ICON[status]}</span> {STATUS_TEXT[status]}
        </div>
      )}
    </div>
  )
}

export function Section({ title, sub, actions, children }) {
  return (
    <section className="section">
      {(title || sub || actions) && (
        <div className="section-head">
          <div>
            {title && <h3 className="section-title">{title}</h3>}
            {sub && <div className="section-sub">{sub}</div>}
          </div>
          {actions && <div className="section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Card({ title, sub, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {title && <div className="card-title">{title}</div>}
      {sub && <div className="card-sub">{sub}</div>}
      {children}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          className={`tab${value === t.value ? ' active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Select({ label, value, onChange, options, placeholder }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Empty({ children = 'No visits match these filters.' }) {
  return <div className="empty">{children}</div>
}

function toCsv(columns, rows) {
  const esc = (x) => {
    const s = x == null ? '' : String(x)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(c.csv ? c.csv(r) : c.value(r))).join(','))
  return [head, ...body].join('\n')
}

function download(name, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * Sortable, searchable table with CSV export.
 * columns: [{ key, label, value(row), render?(row), csv?(row), align?, sortable? }]
 */
export function DataTable({ columns, rows, onRowClick, searchable = true, searchText, csvName = 'export.csv', initialSort, pageSize = 50, empty }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort || null)
  const [limit, setLimit] = useState(pageSize)

  const filtered = useMemo(() => {
    let out = rows
    if (q && searchText) {
      const needle = q.toLowerCase()
      out = out.filter((r) => searchText(r).toLowerCase().includes(needle))
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col) {
        const dir = sort.dir === 'asc' ? 1 : -1
        out = [...out].sort((a, b) => {
          const x = col.value(a)
          const y = col.value(b)
          if (x == null && y == null) return 0
          if (x == null) return 1
          if (y == null) return -1
          return (x > y ? 1 : x < y ? -1 : 0) * dir
        })
      }
    }
    return out
  }, [rows, q, sort, columns, searchText])

  const toggle = (key) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  }

  return (
    <div className="table-wrap">
      <div className="table-tools">
        {searchable && searchText && (
          <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        <span className="table-count">{filtered.length.toLocaleString('en-IN')} rows</span>
        <div className="spacer" />
        <button className="btn" onClick={() => download(csvName, toCsv(columns, filtered))}>CSV</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
      {filtered.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th className="num">#</th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`${c.align === 'right' ? 'num' : ''} ${c.sortable === false ? '' : 'sortable'}`}
                    onClick={c.sortable === false ? undefined : () => toggle(c.key)}
                    aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.label}
                    {sort?.key === c.key && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => (
                <tr key={i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
                  <td className="num muted">{i + 1}</td>
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                      {c.render ? c.render(r) : c.value(r) ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > limit && (
        <div className="table-more">
          <button className="btn" onClick={() => setLimit((l) => l + pageSize * 4)}>
            Show more ({(filtered.length - limit).toLocaleString('en-IN')} left)
          </button>
        </div>
      )}
    </div>
  )
}

export function Pill({ children, tone = 'neutral' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function Meter({ value, max = 100, status = 'neutral' }) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <span className="meter" aria-hidden>
      <span className={`meter-fill meter-${status}`} style={{ width: `${w}%` }} />
    </span>
  )
}
