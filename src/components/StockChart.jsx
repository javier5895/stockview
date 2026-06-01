import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useMemo } from 'react'

const PERIODS_WITH_SPARSE_TICKS = ['5Y', 'Max']

function pickTicks(data, period) {
  if (data.length === 0) return []
  if (period === '1D') {
    // Dynamic: ~5 evenly-spaced labels from whatever data exists
    const step = Math.max(1, Math.round(data.length / 5))
    return data.filter((_, i) => i % step === 0).map(d => d.time)
  }
  const step = Math.max(1, Math.floor(data.length / 5))
  return data.filter((_, i) => i % step === 0 || i === data.length - 1).map(d => d.time)
}

const CustomTooltip = ({ active, payload, label, color, dark }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: dark ? '#1e293b' : '#fff',
      border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
      borderRadius: 8,
      padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }}>
      <p style={{ margin: 0, fontSize: 11, color: dark ? '#94a3b8' : '#64748b' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color }}>
        ${payload[0].value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  )
}

export default function StockChart({ data, previousClose, period, isPositive, dark }) {
  const color = isPositive ? '#16a34a' : '#dc2626'
  const gradientId = `grad-${isPositive ? 'green' : 'red'}`
  const ticks = useMemo(() => pickTicks(data, period), [data, period])

  const prices = data.map(d => d.price)
  const dataMin = Math.min(...prices)
  const dataMax = Math.max(...prices)
  const range = dataMax - dataMin || dataMax * 0.02
  const pad = Math.max(range * 0.2, dataMin * 0.002)
  const domain = [
    parseFloat((dataMin - pad).toFixed(2)),
    parseFloat((dataMax + pad * 0.5).toFixed(2)),
  ]

  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            horizontal={true}
            vertical={false}
            stroke={dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}
          />

          <XAxis
            dataKey="time"
            ticks={ticks}
            tick={{ fontSize: 11, fill: dark ? '#64748b' : '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />

          <YAxis
            orientation="right"
            domain={domain}
            tick={{ fontSize: 11, fill: dark ? '#64748b' : '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `${v.toFixed(0)}`}
            width={48}
          />

          <Tooltip
            content={<CustomTooltip color={color} dark={dark} />}
            cursor={{ stroke: dark ? '#475569' : '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 2' }}
          />

          <ReferenceLine
            y={previousClose}
            stroke={dark ? '#475569' : '#cbd5e1'}
            strokeDasharray="4 3"
            strokeWidth={1.5}
          />

          <Area
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: color, stroke: dark ? '#1e293b' : '#fff', strokeWidth: 2 }}
            isAnimationActive={true}
            animationDuration={500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
