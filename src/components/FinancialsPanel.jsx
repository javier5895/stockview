import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const SUB_TABS  = ['Income Statement', 'Balance Sheet', 'Cash Flow', 'Ratios']
const STMT_MAP  = {
  'Income Statement': 'income',
  'Balance Sheet':    'balance',
  'Cash Flow':        'cashflow',
}
// Primary metric (first bold row) to chart per statement
const CHART_ROW = {
  'Income Statement': 'Revenue',
  'Balance Sheet':    'Total Assets',
  'Cash Flow':        'Operating Cash Flow',
}
const CHART_COLOR = {
  'Income Statement': '#3b82f6',
  'Balance Sheet':    '#8b5cf6',
  'Cash Flow':        '#16a34a',
}

const UNIT_OPTS = [
  { value: 'auto',      label: 'Auto'      },
  { value: 'billions',  label: 'Billions'  },
  { value: 'millions',  label: 'Millions'  },
  { value: 'thousands', label: 'Thousands' },
]

/* ─── Helpers ────────────────────────────────────────────────────── */

/** Re-format a raw numeric value with a specific unit scale. */
function fmtFinUnit(raw, isEps, unit) {
  if (isEps) return raw != null ? `$${Number(raw).toFixed(2)}` : '—'
  if (raw == null || Number.isNaN(Number(raw))) return '—'
  const v   = Number(raw)
  const neg = v < 0
  const av  = Math.abs(v)
  let s
  if      (unit === 'billions')  s = `$${(av / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`
  else if (unit === 'millions')  s = `$${Math.round(av / 1e6).toLocaleString('en-US')}M`
  else if (unit === 'thousands') s = `$${Math.round(av / 1e3).toLocaleString('en-US')}K`
  else {
    if      (av >= 1e12) s = `$${(av / 1e12).toFixed(2)}T`
    else if (av >= 1e9)  s = `$${(av / 1e9).toFixed(2)}B`
    else if (av >= 1e6)  s = `$${(av / 1e6).toFixed(1)}M`
    else if (av >= 1e3)  s = `$${(av / 1e3).toFixed(0)}K`
    else                 s = `$${av.toFixed(2)}`
  }
  return neg ? `(${s})` : s
}

/** Reverse the period columns in a financials data object. */
function reverseData(d) {
  if (!d) return d
  return {
    ...d,
    periods: [...d.periods].reverse(),
    rows: d.rows.map(r => ({
      ...r,
      values: [...r.values].reverse(),
      raw:    r.raw ? [...r.raw].reverse() : r.raw,
    })),
  }
}

/** Reverse the period columns in a ratios data object. */
function reverseRatios(d) {
  if (!d) return d
  return {
    ...d,
    periods: [...d.periods].reverse(),
    sections: d.sections.map(sec => ({
      ...sec,
      rows: sec.rows.map(row => ({
        ...row,
        values: [...(row.values ?? [])].reverse(),
      })),
    })),
  }
}

/* ─── Mini bar chart ────────────────────────────────────────────── */
function FinChart({ data, subTab, dark, unit }) {
  const label = CHART_ROW[subTab]
  const row   = data.rows.find(r => r.label === label)
  if (!row) return null

  const color    = CHART_COLOR[subTab]
  const periods  = data.periods
  const chartData = periods.map((p, i) => ({
    period: p,
    value:  row.raw[i],
    fmt:    fmtFinUnit(row.raw[i], false, unit),
  })).filter(d => d.value !== null)

  function fmtAxis(v) {
    if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
    if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(0)}B`
    if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
    return `$${v}`
  }

  const CustomTooltip = ({ active, payload, label: lbl }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: dark ? '#1e293b' : '#fff',
        border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        borderRadius: 8, padding: '8px 12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      }}>
        <p style={{ margin: 0, fontSize: 11, color: dark ? '#94a3b8' : '#64748b' }}>{lbl}</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 700, color }}>
          {payload[0].payload.fmt}
        </p>
      </div>
    )
  }

  return (
    <div className="fin-chart-wrap">
      <p className="fin-chart-label">{label}</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barSize={36}>
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11, fill: dark ? '#64748b' : '#94a3b8' }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tickFormatter={fmtAxis}
            tick={{ fontSize: 10, fill: dark ? '#64748b' : '#94a3b8' }}
            axisLine={false} tickLine={false} width={56}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.value < 0 ? '#dc2626' : color}
                opacity={i === 0 ? 1 : 0.65}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ─── Financial table ───────────────────────────────────────────── */
function FinTable({ data, unit }) {
  // Track which group IDs are collapsed (start all expanded)
  const [collapsed, setCollapsed] = useState({})

  function toggle(groupId) {
    setCollapsed(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  return (
    <div className="fin-table-wrap">
      <table className="fin-table">
        <thead>
          <tr>
            <th className="fin-th-label">Breakdown</th>
            {data.periods.map(p => (
              <th key={p} className="fin-th-val">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => {
            // Hide child rows if their parent group is collapsed
            if (row.parentGroup && collapsed[row.parentGroup]) return null

            // Growth rows always show pre-formatted "% string" — never reformat
            const isGrowth = !!row.isGrowthRow
            // Per-share rows (EPS + balance sheet + cash flow per-share) — show pre-formatted $X.XX
            const isEps    = !isGrowth && (
              row.label === 'EPS (Basic)' || row.label === 'EPS (Diluted)' ||
              row.label === 'Net Cash Per Share' || row.label === 'Book Value Per Share' ||
              row.label === 'Tangible Book Value Per Share' ||
              row.label === 'Free Cash Flow Per Share'
            )
            // Only share-count rows — not "Shares Change (YoY)"
            const isShares = !isGrowth && row.label.includes('Shares') && !row.label.includes('Change')
            const isSection = !!row.groupId

            return (
              <tr
                key={i}
                className={[
                  'fin-tr',
                  row.bold    ? 'fin-tr--bold'    : '',
                  isSection   ? 'fin-tr--section' : '',
                  row.parentGroup ? 'fin-tr--child' : '',
                  isGrowth    ? 'fin-tr--growth'  : '',
                ].join(' ')}
              >
                <td
                  className={`fin-td-label${row.indent ? ' fin-td--indent' : ''}`}
                  onClick={isSection ? () => toggle(row.groupId) : undefined}
                  style={isSection ? { cursor: 'pointer', userSelect: 'none' } : undefined}
                >
                  {isSection && (
                    <span className="fin-toggle-icon">
                      {collapsed[row.groupId] ? '›' : '∨'}
                    </span>
                  )}
                  {row.label}
                </td>
                {(row.raw ?? row.values).map((rawVal, j) => {
                  // Growth rows: show pre-formatted value, colour green/red
                  if (isGrowth) {
                    const v = row.values?.[j] ?? '—'
                    const isPos = typeof v === 'string' && v.startsWith('+')
                    const isNegGrow = typeof v === 'string' && v.startsWith('-')
                    return (
                      <td key={j} className="fin-td-val fin-td-growth"
                        style={{ color: isPos ? '#16a34a' : isNegGrow ? '#dc2626' : undefined }}>
                        {v}
                      </td>
                    )
                  }
                  const displayed = (unit === 'auto' || isEps || isShares)
                    ? (row.values?.[j] ?? '—')
                    : fmtFinUnit(rawVal, isEps, unit)
                  const isNeg = typeof displayed === 'string' && displayed.startsWith('(')
                  return (
                    <td
                      key={j}
                      className="fin-td-val"
                      style={{ color: isNeg ? '#dc2626' : undefined }}
                    >
                      {displayed}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ─── Ratios panel ──────────────────────────────────────────────── */
function RatiosView({ ticker, dark, reversed }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setData(null)
    setLoading(true)
    let cancelled = false
    fetch(`/api/stock/${ticker}/financials/ratios`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  if (loading) return <p className="fin-loading">Loading ratios…</p>
  if (!data)   return <p className="fin-empty">Could not load ratios.</p>

  const display = reversed ? reverseRatios(data) : data
  const periods = display.periods ?? []

  return (
    <div className="fin-ratios">
      {display.sections.map(sec => (
        <div key={sec.title} className="fin-ratio-section">
          <h4 className="fin-ratio-title">{sec.title}</h4>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th className="fin-th-label" />
                  {periods.map(p => (
                    <th key={p} className="fin-th-val">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sec.rows.map(row => {
                  const isGrowth = !!row.isGrowthRow
                  return (
                    <tr key={row.label} className={[
                      'fin-tr',
                      row.bold    ? 'fin-tr--bold'   : '',
                      isGrowth    ? 'fin-tr--growth'  : '',
                    ].join(' ')}>
                      <td className={`fin-td-label${row.indent ? ' fin-td--indent' : ''}`}>
                        {row.label}
                      </td>
                      {(row.values ?? []).map((v, j) => {
                        if (isGrowth) {
                          const isPos = typeof v === 'string' && v.startsWith('+')
                          const isNegGrow = typeof v === 'string' && v.startsWith('-')
                          return (
                            <td key={j} className="fin-td-val fin-td-growth"
                              style={{ color: isPos ? '#16a34a' : isNegGrow ? '#dc2626' : undefined }}>
                              {v}
                            </td>
                          )
                        }
                        const isNeg = typeof v === 'string' && v.startsWith('(')
                        return (
                          <td key={j} className="fin-td-val"
                            style={{ color: isNeg ? '#dc2626' : undefined }}>
                            {v}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── Main panel ────────────────────────────────────────────────── */
export default function FinancialsPanel({ ticker, dark }) {
  const [subTab,   setSubTab]   = useState('Income Statement')
  const [freq,     setFreq]     = useState('annual')
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [reversed, setReversed] = useState(false)
  const [unit,     setUnit]     = useState('auto')

  useEffect(() => {
    if (subTab === 'Ratios') return
    setData(null)
    setLoading(true)
    let cancelled = false
    const stmt = STMT_MAP[subTab]
    fetch(`/api/stock/${ticker}/financials?statement=${stmt}&freq=${freq}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker, subTab, freq])

  const displayData = (data && reversed) ? reverseData(data) : data

  return (
    <div className="card fin-panel">

      {/* Sub-tab bar */}
      <div className="fin-subtabs">
        {SUB_TABS.map(t => (
          <button
            key={t}
            className={`fin-subtab${subTab === t ? ' active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Toolbar: Annual/Quarterly toggle  ·  direction arrow  ·  unit selector */}
      <div className="fin-freq-wrap">
        {subTab !== 'Ratios' ? (
          <div className="fin-freq-toggle">
            <button
              className={freq === 'annual' ? 'active' : ''}
              onClick={() => setFreq('annual')}
            >Annual</button>
            <button
              className={freq === 'quarterly' ? 'active' : ''}
              onClick={() => setFreq('quarterly')}
            >Quarterly</button>
          </div>
        ) : (
          <div />
        )}

        <div className="fin-toolbar-right">
          {/* Direction toggle — newest-first ↔ oldest-first */}
          <button
            className={`fin-arrow-btn${reversed ? ' active' : ''}`}
            onClick={() => setReversed(r => !r)}
            title={reversed ? 'Oldest first — click for newest first' : 'Newest first — click for oldest first'}
          >
            <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
              <path d="M1 3h9M8 1l2.5 2L8 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 8H5M7 6l-2.5 2L7 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Unit scale — only for financial statements, not ratios */}
          {subTab !== 'Ratios' && (
            <select
              className="fin-unit-select"
              value={unit}
              onChange={e => setUnit(e.target.value)}
            >
              {UNIT_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Ratios */}
      {subTab === 'Ratios' ? (
        <RatiosView ticker={ticker} dark={dark} reversed={reversed} />
      ) : (
        <>
          {/* Loading / error */}
          {loading && <p className="fin-loading">Loading…</p>}
          {!loading && !displayData && <p className="fin-empty">No data available.</p>}

          {/* Chart + table */}
          {displayData && (
            <>
              <FinChart data={displayData} subTab={subTab} dark={dark} unit={unit} />
              <FinTable data={displayData} unit={unit} />
            </>
          )}
        </>
      )}
    </div>
  )
}
