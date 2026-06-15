import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'

function fmt(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1000) return `US$${(v / 1000).toFixed(1)}T`
  return `US$${v.toFixed(3)}b`
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload ?? {}
  return (
    <div className="deq-tooltip">
      <div className="deq-tt-date">{label}</div>
      <table className="deq-tt-table">
        <tbody>
          <tr>
            <td>Debt</td>
            <td style={{ color: '#f87171' }}>{fmt(d.debt)}</td>
          </tr>
          <tr>
            <td>Equity</td>
            <td style={{ color: '#60a5fa' }}>{fmt(d.equity)}</td>
          </tr>
          {d.deRatio != null && (
            <tr>
              <td></td>
              <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{d.deRatio.toFixed(1)}% Debt/Equity Ratio</td>
            </tr>
          )}
          <tr>
            <td>Cash And Equivalents</td>
            <td style={{ color: '#2dd4bf' }}>{fmt(d.cash)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function fmtAxis(v) {
  if (v == null) return ''
  const abs = Math.abs(v)
  if (abs === 0) return 'US$0'
  if (abs >= 1000) return `US$${(v / 1000).toFixed(0)}T`
  return `US$${Math.round(v)}b`
}

export default function DebtEquityChart({ ticker }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [mode,    setMode]    = useState('annual')

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    fetch(`/api/stock/${ticker}/debt-history`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  const series = data?.[mode] ?? []

  return (
    <div className="card deq-card">
      <div className="deq-header">
        <div className="prof-icon-wrap">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <div className="prof-header-text">
          <h3 className="prof-title">Debt to Equity History and Analysis</h3>
          <p className="prof-subtitle">How has the balance sheet evolved over time?</p>
        </div>
        <div className="deq-mode-switch">
          <button className={`deq-mode-btn ${mode === 'annual' ? 'active' : ''}`} onClick={() => setMode('annual')}>Annual</button>
          <button className={`deq-mode-btn ${mode === 'quarterly' ? 'active' : ''}`} onClick={() => setMode('quarterly')}>Quarterly</button>
        </div>
      </div>

      <div className="prof-divider" />

      {loading && <div className="prof-state"><div className="deq-skeleton" /></div>}
      {error && !loading && <div className="prof-state prof-error">Could not load balance sheet history.</div>}

      {!loading && !error && series.length > 0 && (
        <div className="deq-chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={series} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradDebt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f87171" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gradEquity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gradCash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#2dd4bf" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                tickFormatter={d => d?.slice(0, 4)}
              />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtAxis}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="equity" name="Equity"
                stroke="#60a5fa" strokeWidth={2}
                fill="url(#gradEquity)" dot={false} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="debt" name="Debt"
                stroke="#f87171" strokeWidth={2}
                fill="url(#gradDebt)" dot={false} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="cash" name="Cash And Equivalents"
                stroke="#2dd4bf" strokeWidth={2}
                fill="url(#gradCash)" dot={false} activeDot={{ r: 4 }} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                formatter={(value) => <span style={{ color: 'var(--text-muted)' }}>{value}</span>}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {!loading && !error && series.length === 0 && (
        <div className="prof-state prof-error">No balance sheet history available.</div>
      )}
    </div>
  )
}
