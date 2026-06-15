import { useState, useEffect, Fragment } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

const PALETTES = {
  product: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#6366f1'],
  geo:     ['#0ea5e9','#22c55e','#eab308','#f43f5e','#a78bfa','#14b8a6','#fb923c','#4ade80','#f472b6','#818cf8'],
}

function fmtB(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}T`
  return `$${v.toFixed(1)}b`
}
function fmtAxis(v) {
  if (!v) return '$0'
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}T`
  return `$${Math.round(v)}b`
}
function fmtVal(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1000) return `$${(v / 1000).toFixed(2)}T`
  if (abs >= 1)    return `$${v.toFixed(2)}b`
  return `$${(v * 1000).toFixed(0)}M`
}
function yoy(rows) {
  if (!rows || rows.length < 2) return null
  const sum = r => Object.values(r.data).reduce((a, b) => a + b, 0)
  const cur = sum(rows[rows.length - 1])
  const prv = sum(rows[rows.length - 2])
  return prv ? ((cur - prv) / prv) * 100 : null
}

/* ── Bar chart tooltip ───────────────────────────────────────── */
function SegTooltip({ active, payload, label, colors, keys }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div className="seg2-tooltip">
      <div className="seg2-tt-head">{label}</div>
      <div className="seg2-tt-total">{fmtB(total)} total</div>
      <div className="seg2-tt-divider" />
      {[...payload].reverse().map((p, i) => {
        const pct   = total > 0 ? (p.value / total) * 100 : 0
        const color = colors[keys.indexOf(p.name) % colors.length]
        return (
          <div key={i} className="seg2-tt-row">
            <span className="seg2-tt-dot" style={{ background: color }} />
            <span className="seg2-tt-name">{p.name}</span>
            <span className="seg2-tt-val">{fmtB(p.value)}</span>
            <span className="seg2-tt-pct">{pct.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Stacked bar chart ───────────────────────────────────────── */
function SegChart({ rows, colors }) {
  if (!rows?.length) return <div className="seg2-empty">No data available.</div>

  // Limit to recent 10 years for chart readability
  const recent = rows.slice(-10)

  const keys = []
  recent.forEach(r => Object.keys(r.data).forEach(k => { if (!keys.includes(k)) keys.push(k) }))

  const chartData = recent.map(r => ({
    date: r.fiscalYear ? String(r.fiscalYear) : r.date?.slice(0, 7),
    ...r.data,
  }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
        <YAxis tickFormatter={fmtAxis} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={50} />
        <Tooltip content={<SegTooltip colors={colors} keys={keys} />} cursor={{ fill: 'var(--border)', opacity: 0.5 }} />
        {keys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="a" fill={colors[i % colors.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ── Data table ──────────────────────────────────────────────── */
function SegTable({ rows, colors }) {
  if (!rows?.length) return null

  // Keys from most recent year only, deduplicated
  const latestWithData = [...rows].reverse().find(r => Object.keys(r.data).length > 0)
  const rawKeys = latestWithData ? Object.keys(latestWithData.data) : []
  const seen = new Set()
  const keys = rawKeys.filter(k => {
    const norm = k.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(norm)) return false
    seen.add(norm); return true
  })

  // Columns newest → oldest, limit to 7 for table width
  const cols = [...rows].reverse().slice(0, 7)

  function fyNum(row) {
    if (!row) return null
    if (row.fiscalYear) return Number(row.fiscalYear)
    const y = row.date?.slice(0, 4); return y ? Number(y) : null
  }
  function isAdjacent(i) {
    const a = fyNum(cols[i]), b = fyNum(cols[i + 1])
    return a != null && b != null && Math.abs(a - b) === 1
  }
  function growth(i, key) {
    if (!isAdjacent(i)) return null
    const cur = cols[i]?.data[key], prv = cols[i + 1]?.data[key]
    if (cur == null || prv == null || prv === 0) return null
    return ((cur - prv) / Math.abs(prv)) * 100
  }
  function totalFor(row) { return Object.values(row.data).reduce((a, b) => a + b, 0) }
  function totalGrowth(i) {
    if (!isAdjacent(i)) return null
    const prv = cols[i + 1] ? totalFor(cols[i + 1]) : null
    if (!prv) return null
    return ((totalFor(cols[i]) - prv) / Math.abs(prv)) * 100
  }
  function fmtG(g) {
    if (g == null) return '—'
    return `${g >= 0 ? '+' : ''}${g.toFixed(2)}%`
  }
  function fyLabel(row) { return row.fiscalYear ? `FY ${row.fiscalYear}` : row.date?.slice(0, 4) }
  function periodLabel(row) {
    if (!row.date) return '—'
    return new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="seg2-table-wrap">
      <table className="seg2-table">
        <thead>
          <tr className="seg2-tr-head">
            <th className="seg2-th seg2-th-label">Segment</th>
            {cols.map((r, i) => <th key={i} className="seg2-th">{fyLabel(r)}</th>)}
          </tr>
          <tr className="seg2-tr-period">
            <td className="seg2-td-first seg2-period-label">Period Ending</td>
            {cols.map((r, i) => <td key={i} className="seg2-td seg2-period-val">{periodLabel(r)}</td>)}
          </tr>
        </thead>
        <tbody>
          {keys.map((key, ki) => (
            <Fragment key={key}>
              <tr className="seg2-tr-val">
                <td className="seg2-td-first">
                  <span className="seg2-dot" style={{ background: colors[ki % colors.length] }} />
                  {key}
                </td>
                {cols.map((r, ci) => (
                  <td key={ci} className="seg2-td seg2-td-num">{fmtVal(r.data[key] ?? null)}</td>
                ))}
              </tr>
              <tr className="seg2-tr-growth">
                <td className="seg2-td-first seg2-growth-label">
                  <span className="seg2-dot seg2-dot-invis" />
                  {key} Growth
                </td>
                {cols.map((r, ci) => {
                  const g = growth(ci, key)
                  return <td key={ci} className={`seg2-td seg2-td-pct ${g == null ? '' : g >= 0 ? 'pos' : 'neg'}`}>{fmtG(g)}</td>
                })}
              </tr>
            </Fragment>
          ))}
          <tr className="seg2-tr-total">
            <td className="seg2-td-first seg2-total-label">Revenue (Total)</td>
            {cols.map((r, ci) => <td key={ci} className="seg2-td seg2-td-num seg2-total-num">{fmtVal(totalFor(r))}</td>)}
          </tr>
          <tr className="seg2-tr-growth">
            <td className="seg2-td-first seg2-growth-label" style={{ paddingLeft: 28 }}>Revenue (Total) Growth</td>
            {cols.map((r, ci) => {
              const g = totalGrowth(ci)
              return <td key={ci} className={`seg2-td seg2-td-pct ${g == null ? '' : g >= 0 ? 'pos' : 'neg'}`}>{fmtG(g)}</td>
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ── View (one tab: product or geo) ─────────────────────────── */
function SegView({ rows, palette, label }) {
  const colors = PALETTES[palette]
  const growth = yoy(rows)
  const latestTotal = rows?.length
    ? Object.values(rows[rows.length - 1].data).reduce((a, b) => a + b, 0)
    : 0

  return (
    <div className="seg2-view">
      {rows?.length > 0 && (
        <div className="seg2-summary">
          <div className="seg2-summary-item">
            <span className="seg2-summary-label">Latest Total</span>
            <span className="seg2-summary-value">{fmtB(latestTotal)}</span>
          </div>
          {growth != null && (
            <div className="seg2-summary-item">
              <span className="seg2-summary-label">YoY Growth</span>
              <span className={`seg2-summary-value ${growth >= 0 ? 'pos' : 'neg'}`}>
                {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
              </span>
            </div>
          )}
          <div className="seg2-summary-item">
            <span className="seg2-summary-label">Segments</span>
            <span className="seg2-summary-value">{Object.keys(rows[rows.length - 1].data).length}</span>
          </div>
        </div>
      )}

      <div className="seg2-col-label">{label} Revenue Over Time</div>
      <SegChart rows={rows} colors={colors} />
      <SegTable rows={rows} colors={colors} />
    </div>
  )
}

/* ── Panel ───────────────────────────────────────────────────── */
export default function RevenueSegmentsPanel({ ticker }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [segTab,  setSegTab]  = useState('product')

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    fetch(`/api/stock/${ticker}/revenue-segments`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  const product    = data?.product
  const geo        = data?.geo
  const hasProduct = (product?.length ?? 0) > 0
  const hasGeo     = (geo?.length     ?? 0) > 0

  useEffect(() => {
    if (data && !hasProduct && hasGeo) setSegTab('geo')
  }, [data, hasProduct, hasGeo])

  const activeRows    = segTab === 'product' ? product : geo
  const activePalette = segTab === 'product' ? 'product' : 'geo'
  const activeLabel   = segTab === 'product' ? 'Product' : 'Geographic'

  return (
    <div className="card seg2-card">
      <div className="seg2-header">
        <div className="seg2-header-left">
          <div className="seg2-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
              <path d="M22 12A10 10 0 0 0 12 2v10z"/>
            </svg>
          </div>
          <div>
            <h3 className="seg2-title">Revenue Segments</h3>
            <p className="seg2-subtitle">Product and geographic breakdown</p>
          </div>
        </div>
      </div>

      {!loading && !error && (hasProduct || hasGeo) && (
        <div className="seg2-tabs">
          {hasProduct && (
            <button className={`seg2-tab ${segTab === 'product' ? 'active' : ''}`} onClick={() => setSegTab('product')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
              By Product
            </button>
          )}
          {hasGeo && (
            <button className={`seg2-tab ${segTab === 'geo' ? 'active' : ''}`} onClick={() => setSegTab('geo')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              By Geography
            </button>
          )}
        </div>
      )}

      <div className="seg2-body">
        {loading && (
          <div className="seg2-loading">
            <div className="seg2-skel seg2-skel-summary" />
            <div className="seg2-skel seg2-skel-chart" />
          </div>
        )}
        {error && !loading && <div className="seg2-empty">Could not load revenue segment data.</div>}
        {!loading && !error && !hasProduct && !hasGeo && <div className="seg2-empty">No segment data available for this company.</div>}
        {!loading && !error && (hasProduct || hasGeo) && (
          <SegView key={segTab} rows={activeRows} palette={activePalette} label={activeLabel} />
        )}
      </div>
    </div>
  )
}
