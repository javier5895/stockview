import { useState, useEffect } from 'react'

const API = '/api'

const GROUPS = ['All', 'Americas', 'Europe', 'Asia', 'Middle East']

function fmtPrice(n) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function PctCell({ value }) {
  if (value == null) return <td className="idx-td idx-td-pct"><span className="idx-pct-na">—</span></td>
  const pos = value >= 0
  const abs = Math.abs(value)
  const intensity = abs >= 3 ? 'high' : abs >= 1.5 ? 'mid' : abs >= 0.3 ? 'low' : 'flat'
  return (
    <td className="idx-td idx-td-pct">
      <span className={`idx-pct ${pos ? 'idx-pct-pos' : 'idx-pct-neg'} idx-pct-${intensity}`}>
        {pos ? '+' : ''}{value.toFixed(2)}%
      </span>
    </td>
  )
}

function SkeletonRow() {
  return (
    <tr className="idx-row">
      {Array.from({ length: 9 }).map((_, i) => (
        <td key={i} className="idx-td">
          <div className="idx-skel" style={{ width: i === 0 ? 80 : i === 1 ? 70 : 55, height: 14 }} />
        </td>
      ))}
    </tr>
  )
}

export default function IndicesPage() {
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [group, setGroup]     = useState('All')

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/world-indices`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = group === 'All' ? data : data.filter(d => d.group === group)

  return (
    <div className="idx-page">
      <div className="idx-container">

        <div className="idx-header">
          <div>
            <h1 className="idx-title">World Indices</h1>
            <p className="idx-subtitle">Major global stock market indices</p>
          </div>
          <div className="idx-group-tabs">
            {GROUPS.map(g => (
              <button
                key={g}
                className={`idx-tab ${group === g ? 'active' : ''}`}
                onClick={() => setGroup(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="idx-card card">
          <table className="idx-table">
            <thead>
              <tr>
                <th className="idx-th idx-th-name">Major</th>
                <th className="idx-th idx-th-num">Price</th>
                <th className="idx-th idx-th-num">Day</th>
                <th className="idx-th idx-th-pct">%</th>
                <th className="idx-th idx-th-pct">Weekly</th>
                <th className="idx-th idx-th-pct">Monthly</th>
                <th className="idx-th idx-th-pct">YTD</th>
                <th className="idx-th idx-th-pct">YoY</th>
                <th className="idx-th idx-th-date">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
                : filtered.map((row, i) => {
                    const pos = row.changePct >= 0
                    return (
                      <tr key={i} className="idx-row">
                        <td className="idx-td idx-td-name">
                          <span className="idx-flag">{row.flag}</span>
                          <strong className="idx-label">{row.label}</strong>
                        </td>
                        <td className="idx-td idx-td-num">{fmtPrice(row.price)}</td>
                        <td className={`idx-td idx-td-num ${pos ? 'idx-pos' : 'idx-neg'}`}>
                          {pos ? '▲' : '▼'} {Math.abs(row.change ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <PctCell value={row.changePct} />
                        <PctCell value={row.weekly} />
                        <PctCell value={row.monthly} />
                        <PctCell value={row.ytd} />
                        <PctCell value={row.yoy} />
                        <td className="idx-td idx-td-date">{row.date ?? '—'}</td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>

        <p className="idx-footer">Data via Yahoo Finance · Daily close · Updated every 60 seconds</p>
      </div>
    </div>
  )
}
