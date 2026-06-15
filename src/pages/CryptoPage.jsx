import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts'

/* ─── Price formatter ─────────────────────────────────────────────── */
function fmtPrice(p) {
  if (p == null) return '—'
  const n = Number(p)
  if (n >= 10000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1000)  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(5)
  if (n >= 0.0001) return n.toFixed(7)
  return n.toFixed(9)
}

function fmtChange(c) {
  if (c == null) return ''
  const n   = Number(c)
  const abs = Math.abs(n)
  let s
  if (abs >= 100)    s = n.toFixed(2)
  else if (abs >= 1) s = n.toFixed(2)
  else if (abs >= 0.01) s = n.toFixed(4)
  else if (abs >= 0.00001) s = n.toFixed(6)
  else s = n.toFixed(8)
  return (n >= 0 ? '+' : '') + s
}

function fmtPct(p) {
  if (p == null) return '—'
  const n = Number(p)
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

/* ─── Card background: HSL ramp by magnitude & direction ─────────── */
function cardBg(pct) {
  if (pct == null) return 'hsl(220,22%,12%)'
  const n = Number(pct)
  const a = Math.abs(n)
  if (n > 0) {
    if (a > 8)  return 'hsl(142,68%,22%)'
    if (a > 4)  return 'hsl(142,60%,18%)'
    if (a > 1.5) return 'hsl(142,50%,15%)'
    if (a > 0.4) return 'hsl(142,40%,13%)'
    return 'hsl(215,26%,13%)'
  } else {
    if (a > 8)  return 'hsl(0,68%,26%)'
    if (a > 4)  return 'hsl(0,60%,22%)'
    if (a > 1.5) return 'hsl(0,50%,18%)'
    if (a > 0.4) return 'hsl(350,42%,15%)'
    return 'hsl(260,22%,13%)'
  }
}

/* ─── Known coin icon fallback colors ───────────────────────────────*/
const COIN_COLOR = {
  BTC:'#F7931A', ETH:'#627EEA', BNB:'#F3BA2F', XRP:'#346AA9',
  SOL:'#9945FF', TRX:'#EF0027', DOGE:'#C2A633', ADA:'#0033AD',
  BCH:'#8DC351', LINK:'#2A5ADA', XLM:'#7B2FBE', SUI:'#4DA2FF',
  ZEC:'#ECB244', AVAX:'#E84142', LTC:'#BFBBBB', HBAR:'#00ABEF',
  SHIB:'#FFA409', TON:'#0088CC', DOT:'#E6007A', UNI:'#FF007A',
}

function CoinIcon({ symbol, size = 22 }) {
  const [err, setErr] = useState(false)
  const color = COIN_COLOR[symbol] || '#888'

  if (!err) {
    return (
      <img
        src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons/32/color/${symbol.toLowerCase()}.png`}
        alt={symbol}
        width={size} height={size}
        style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
        onError={() => setErr(true)}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size * 0.42, fontWeight: 800,
      color: '#fff', flexShrink: 0, letterSpacing: '-0.03em',
    }}>
      {symbol[0]}
    </div>
  )
}

/* ─── X-axis date formatter (YYYY-MM-DD → "Jun 7") ──────────────── */
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function dateLabel(t) {
  if (!t) return ''
  try {
    const [, mm, dd] = t.split('-')
    return `${MON[parseInt(mm, 10) - 1]} ${parseInt(dd, 10)}`
  } catch { return '' }
}

/* ─── Custom sparkline tooltip ───────────────────────────────────── */
function SparkTip({ active, payload, symbol }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(0,0,0,0.75)', border: 'none',
      borderRadius: 5, padding: '4px 8px', fontSize: 11,
      color: '#fff', backdropFilter: 'blur(4px)',
    }}>
      {fmtPrice(payload[0].value)}
    </div>
  )
}

/* ─── Single coin card ───────────────────────────────────────────── */
function CryptoCard({ coin }) {
  const { symbol, name, price, change, changesPercentage: pct, dayHigh, dayLow, sparkline } = coin
  const n = sparkline?.length ?? 0
  const isUp = (pct ?? 0) >= 0
  const bg = cardBg(pct)

  // Nearness to daily extremes (highlight the closer end)
  const range  = (dayHigh != null && dayLow != null) ? (dayHigh - dayLow) : 0
  const ratio  = (range > 0 && price != null) ? ((price - dayLow) / range) : 0.5
  const hiLit  = ratio > 0.72
  const loLit  = ratio < 0.28

  // Tick interval: show ~4 labels across the sparkline
  const tickEvery = n > 8 ? Math.max(1, Math.floor(n / 5)) : 'preserveStartEnd'

  const lineClr = 'rgba(255,255,255,0.88)'
  const fillId  = `cg_${symbol}`

  return (
    <div className="cc-card" style={{ background: bg }}>

      {/* ── Top bar ── */}
      <div className="cc-top">
        <div className="cc-coin-id">
          <CoinIcon symbol={symbol} size={20} />
          <span className="cc-sym">{symbol}</span>
        </div>
        <div className={`cc-delta ${isUp ? 'cc-up' : 'cc-dn'}`}>
          <span>{fmtPct(pct)}</span>
          <span className="cc-bull">•</span>
          <span>{fmtChange(change)}</span>
        </div>
      </div>

      {/* ── Price + H/L ── */}
      <div className="cc-mid">
        <div className="cc-price">{fmtPrice(price)}</div>
        {dayHigh != null && dayLow != null && (
          <div className="cc-hl">
            <span className={`cc-hl-v ${hiLit ? 'cc-hl-hi' : ''}`}>H {fmtPrice(dayHigh)}</span>
            <span className={`cc-hl-v ${loLit ? 'cc-hl-lo' : ''}`}>L {fmtPrice(dayLow)}</span>
          </div>
        )}
      </div>

      {/* ── Sparkline ── */}
      <div className="cc-spark">
        {n > 3 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={lineClr} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={lineClr} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tickFormatter={dateLabel}
                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.38)' }}
                axisLine={false}
                tickLine={false}
                interval={tickEvery}
                height={18}
              />
              <YAxis domain={['auto','auto']} hide />
              <Tooltip
                content={<SparkTip symbol={symbol} />}
                cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1 }}
              />
              <Area
                type="monotone"
                dataKey="c"
                stroke={lineClr}
                strokeWidth={1.6}
                fill={`url(#${fillId})`}
                dot={false}
                activeDot={{ r: 3, fill: lineClr, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="cc-no-spark" />
        )}
      </div>
    </div>
  )
}

/* ─── Market-cap / volume summary bar ───────────────────────────── */
function CryptoHeader({ coins, lastUpd, onRefresh }) {
  const ups   = coins.filter(c => (c.changesPercentage ?? 0) >= 0).length
  const downs = coins.length - ups

  return (
    <div className="cc-page-header">
      <div className="cc-page-left">
        <h2 className="cc-page-title">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
            <path d="M12 2l7 10.5-7 4-7-4L12 2zm0 14.5l7-4L12 22l-7-4z"/>
          </svg>
          Crypto Markets
        </h2>
        {coins.length > 0 && (
          <div className="cc-mkt-stats">
            <span className="cc-stat-up">▲ {ups} up</span>
            <span className="cc-stat-dn">▼ {downs} down</span>
          </div>
        )}
      </div>
      <div className="cc-page-right">
        {lastUpd && <span className="cc-upd">Updated {lastUpd}</span>}
        <button className="cc-refresh-btn" onClick={onRefresh} title="Refresh">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────────────── */
export default function CryptoPage({ dark }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [lastUpd, setLastUpd] = useState(null)

  const load = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true)
    fetch('/api/crypto')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => {
        setData(d)
        setLoading(false)
        setError(null)
        setLastUpd(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      })
      .catch(e => {
        setError(String(e))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), 60_000)
    return () => clearInterval(id)
  }, [load])

  const coins = data?.coins ?? []

  return (
    <div className={`cc-page ${dark ? 'dark' : ''}`}>
      <CryptoHeader coins={coins} lastUpd={lastUpd} onRefresh={() => load(true)} />

      {loading ? (
        <div className="cc-grid">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="cc-card cc-skel" />
          ))}
        </div>
      ) : error ? (
        <div style={{ padding: '40px 16px', color: '#ef4444', fontSize: '0.85rem' }}>
          Failed to load crypto data: {error}
        </div>
      ) : (
        <div className="cc-grid">
          {coins.map(coin => (
            <CryptoCard key={coin.symbol} coin={coin} />
          ))}
        </div>
      )}
    </div>
  )
}
