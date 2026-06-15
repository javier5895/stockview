import { useState, useEffect, useMemo, useRef } from 'react'

/* ─── Helpers ────────────────────────────────────────────────────────────────── */

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function todayISO() { return new Date().toISOString().slice(0, 10) }
function getWeekRange(offsetWeeks = 0) {
  const d = new Date()
  const day = d.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(d.getDate() + diffToMon + offsetWeeks * 7)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]
}

function parseEventMinutes(dateStr, tzOffset = 0) {
  if (!dateStr) return -1
  const parts = dateStr.split(' ')
  if (!parts[1]) return -1
  const [hStr, mStr] = parts[1].split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (isNaN(h) || isNaN(m)) return -1
  return ((h * 60 + m + tzOffset) % 1440 + 1440) % 1440
}

function formatCalTime(dateStr, tzOffset = 0) {
  if (!dateStr) return ''
  const parts = dateStr.split(' ')
  if (!parts[1]) return ''
  const [hStr, mStr] = parts[1].split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (isNaN(h) || isNaN(m)) return parts[1].slice(0, 5)
  const total = ((h * 60 + m + tzOffset) % 1440 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
function formatCalDay(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
function fmtMktCap(n) {
  if (n == null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toLocaleString()}`
}
function fmtNum(n, decimals = 2) {
  if (n == null) return '—'
  return Number(n).toFixed(decimals)
}
function fmtPct(n) {
  if (n == null) return '—'
  return `${(Number(n) * 100).toFixed(2)}%`
}
function fmtCalVal(val, unit) {
  if (val == null) return null
  const n = parseFloat(val)
  if (isNaN(n)) return `${val}${unit || ''}`
  return `${n.toFixed(2)}${unit || ''}`
}

/* ─── Event descriptions ─────────────────────────────────────────────────────── */

const EVENT_DESCRIPTIONS = {
  'cpi': 'The Consumer Price Index (CPI) measures the average change in prices paid by consumers for a basket of goods and services. It is the primary gauge of inflation — a rising CPI signals that purchasing power is eroding, which often prompts central banks to raise interest rates.',
  'inflation rate': 'The Inflation Rate tracks the percentage change in the general price level over time. High inflation reduces consumer purchasing power and can lead to tighter monetary policy, while deflation may signal weak demand in the economy.',
  'gdp': 'Gross Domestic Product (GDP) measures the total monetary value of all goods and services produced in a country over a specific period. It is the broadest indicator of economic health — strong GDP growth typically lifts equity markets and supports a stronger currency.',
  'unemployment': 'The Unemployment Rate measures the percentage of the labor force that is jobless and actively seeking work. A low and falling unemployment rate signals a healthy economy; unexpectedly high readings can weigh on consumer sentiment and spending.',
  'nonfarm payroll': 'Nonfarm Payrolls (NFP) counts the net number of jobs added or lost in the US economy, excluding the agricultural sector. It is one of the most market-moving releases — a strong reading boosts the dollar and equity futures, while a miss can spark risk-off moves.',
  'interest rate': 'The central bank Interest Rate decision sets the benchmark borrowing cost for the economy. Rate hikes typically strengthen the currency and pressure bonds; cuts do the opposite. Markets closely watch the statement for forward-guidance language.',
  'retail sales': 'Retail Sales measure the total receipts at stores that sell merchandise. As consumer spending drives roughly two-thirds of GDP in developed economies, this report is a key leading indicator of economic momentum and corporate earnings.',
  'pmi': 'The Purchasing Managers\' Index (PMI) is a survey-based indicator of business activity in the manufacturing or services sector. A reading above 50 signals expansion; below 50 indicates contraction. It is closely watched as an early-cycle leading indicator.',
  'trade balance': 'The Trade Balance reports the difference between a country\'s exports and imports. A surplus means more goods are sold abroad than imported; a deficit is the reverse. Large trade imbalances influence currency valuations and are a focal point in geopolitical trade negotiations.',
  'building permits': 'Building Permits measure the number of new residential construction projects authorized by local governments. As a leading indicator for the housing sector, rising permits signal future construction activity, employment growth, and consumer confidence.',
  'housing': 'Housing data — including starts, permits, and sales — reflect the health of the real estate market. Housing is interest-rate sensitive and often one of the first sectors to respond to monetary policy changes.',
  'factory orders': 'Factory Orders measure the total value of new orders placed with manufacturers for both durable and non-durable goods. Rising orders indicate growing demand and future production activity, making it a useful leading indicator for industrial output.',
  'industrial production': 'Industrial Production measures the output of the manufacturing, mining, and utilities sectors. It is a key coincident indicator of economic activity, closely correlated with GDP and employment in the goods-producing sector.',
  'consumer confidence': 'Consumer Confidence gauges how optimistic or pessimistic households are about their financial situation and the broader economy. High confidence typically translates into stronger spending and economic growth; low confidence can foreshadow a slowdown.',
  'producer price': 'The Producer Price Index (PPI) measures the average change in prices received by domestic producers for their output. Since producer costs often pass through to consumer prices, the PPI is watched as an early indicator of inflationary pressures.',
  'jobs': 'Employment data captures changes in the number of people employed in an economy. Strong job creation supports consumer spending and GDP growth, while rising jobless claims can signal an impending economic slowdown.',
  'car sales': 'Car Sales (or Auto Sales) track the number of new vehicles sold during a given period. As big-ticket consumer purchases, they reflect consumer confidence and credit conditions, and are a useful gauge of discretionary spending.',
  'auction': 'Government bond auctions gauge market demand for sovereign debt. Strong demand (low yield, high bid-to-cover ratio) signals confidence in the issuer\'s fiscal position; weak auctions can push yields higher and pressure the currency.',
  'current account': 'The Current Account measures the flow of goods, services, income, and transfers between a country and the rest of the world. A persistent deficit may signal over-reliance on foreign capital; a surplus reflects a net lending position to the world.',
}

function getEventDescription(eventName) {
  if (!eventName) return null
  const lower = eventName.toLowerCase()
  for (const [key, desc] of Object.entries(EVENT_DESCRIPTIONS)) {
    if (lower.includes(key)) return desc
  }
  return null
}

/* ─── Event detail modal ─────────────────────────────────────────────────────── */

function EventModal({ ev, tzOffset, onClose }) {
  const flagCode = COUNTRY_FLAGS[ev.country] || ev.country?.toLowerCase()
  const hasActual = ev.actual != null
  const hasForecast = ev.estimate != null
  const hasPrev = ev.previous != null
  const beat = hasActual && hasForecast && ev.actual >= ev.estimate
  const miss = hasActual && hasForecast && ev.actual < ev.estimate
  const description = getEventDescription(ev.event)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="econ-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="econ-modal">
        <div className="econ-modal-header">
          <div>
            <div className="econ-modal-category" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {flagCode && <img src={`https://flagcdn.com/w40/${flagCode}.png`} alt={ev.country} style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover' }} />}
              {ev.country} · {ev.impact || 'Unknown'} Impact · <ImpactStars impact={ev.impact} />
            </div>
            <h2 className="econ-modal-title">{ev.event}</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {formatCalTime(ev.date, tzOffset)} · {formatCalDay((ev.date || '').slice(0, 10))}
            </div>
          </div>
          <button className="econ-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="econ-stats-row">
          <div className="econ-stat">
            <div className="econ-stat-label">Actual</div>
            <div className={`econ-stat-value ${beat ? 'cal-beat' : miss ? 'cal-miss' : ''}`}>
              {hasActual ? fmtCalVal(ev.actual, ev.unit) : '—'}
            </div>
          </div>
          <div className="econ-stat">
            <div className="econ-stat-label">Forecast</div>
            <div className="econ-stat-value" style={{ color: 'var(--text-muted)' }}>
              {hasForecast ? fmtCalVal(ev.estimate, ev.unit) : '—'}
            </div>
          </div>
          <div className="econ-stat">
            <div className="econ-stat-label">Previous</div>
            <div className="econ-stat-value" style={{ color: 'var(--text-muted)' }}>
              {hasPrev ? fmtCalVal(ev.previous, ev.unit) : '—'}
            </div>
          </div>
          {hasActual && hasForecast && (
            <div className="econ-stat">
              <div className="econ-stat-label">vs Forecast</div>
              <div className={`econ-stat-value ${beat ? 'cal-beat' : 'cal-miss'}`}>
                {beat ? '▲ Beat' : '▼ Missed'}
              </div>
            </div>
          )}
        </div>

        {description ? (
          <p className="econ-modal-desc">{description}</p>
        ) : (
          <p className="econ-modal-desc" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No description available for this indicator.
          </p>
        )}

        <div className="econ-modal-footer">
          Data released by official government or statistical agency sources. Values may be revised.
        </div>
      </div>
    </div>
  )
}

/* ─── Constants ──────────────────────────────────────────────────────────────── */

const IMPACT_LABELS = { High: 3, Medium: 2, Low: 1, None: 0 }

const UTC_OFFSETS = [
  { offset: -720, label: 'UTC-12:00' }, { offset: -660, label: 'UTC-11:00' },
  { offset: -600, label: 'UTC-10:00' }, { offset: -540, label: 'UTC-9:00' },
  { offset: -480, label: 'UTC-8:00' },  { offset: -420, label: 'UTC-7:00' },
  { offset: -360, label: 'UTC-6:00' },  { offset: -300, label: 'UTC-5:00' },
  { offset: -240, label: 'UTC-4:00' },  { offset: -180, label: 'UTC-3:00' },
  { offset: -120, label: 'UTC-2:00' },  { offset: -60,  label: 'UTC-1:00' },
  { offset: 0,    label: 'UTC±0:00' },  { offset: 60,   label: 'UTC+1:00' },
  { offset: 120,  label: 'UTC+2:00' },  { offset: 180,  label: 'UTC+3:00' },
  { offset: 210,  label: 'UTC+3:30' },  { offset: 240,  label: 'UTC+4:00' },
  { offset: 270,  label: 'UTC+4:30' },  { offset: 300,  label: 'UTC+5:00' },
  { offset: 330,  label: 'UTC+5:30' },  { offset: 345,  label: 'UTC+5:45' },
  { offset: 360,  label: 'UTC+6:00' },  { offset: 390,  label: 'UTC+6:30' },
  { offset: 420,  label: 'UTC+7:00' },  { offset: 480,  label: 'UTC+8:00' },
  { offset: 540,  label: 'UTC+9:00' },  { offset: 570,  label: 'UTC+9:30' },
  { offset: 600,  label: 'UTC+10:00' }, { offset: 660,  label: 'UTC+11:00' },
  { offset: 720,  label: 'UTC+12:00' }, { offset: 780,  label: 'UTC+13:00' },
  { offset: 840,  label: 'UTC+14:00' },
]

const COUNTRY_FLAGS = {
  US:'us', GB:'gb', UK:'gb', DE:'de', JP:'jp', CN:'cn', CA:'ca', AU:'au',
  FR:'fr', IT:'it', ES:'es', NL:'nl', CH:'ch', SE:'se', NO:'no', DK:'dk',
  KR:'kr', IN:'in', BR:'br', MX:'mx', RU:'ru', ZA:'za', SG:'sg', HK:'hk',
  NZ:'nz', AT:'at', BE:'be', PL:'pl', PT:'pt', FI:'fi', IE:'ie', GR:'gr',
  TR:'tr', SA:'sa', AE:'ae', IL:'il', TH:'th', ID:'id', MY:'my', PH:'ph',
  TW:'tw', AR:'ar', CL:'cl', CO:'co', PE:'pe', NG:'ng', KE:'ke', EG:'eg',
  EU:'eu',
}

const NAV_TABS = [
  { id: 'economic',  label: 'Economic Calendar' },
  { id: 'earnings',  label: 'Earnings' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'ipo',       label: 'IPO' },
  { id: 'holidays',  label: 'Holidays',   disabled: true },
  { id: 'splits',    label: 'Splits',     disabled: true },
  { id: 'expiration',label: 'Expiration', disabled: true },
]

/* ─── Shared sub-components ──────────────────────────────────────────────────── */

function ImpactStars({ impact }) {
  const filled = IMPACT_LABELS[impact] ?? 0
  return (
    <span className="cal-stars">
      {[1, 2, 3].map(i => (
        <svg key={i} width="11" height="11" viewBox="0 0 24 24"
          fill={i <= filled ? '#f59e0b' : 'none'}
          stroke={i <= filled ? '#f59e0b' : '#cbd5e1'} strokeWidth="1.8">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ))}
    </span>
  )
}

const DATE_FILTER_OPTIONS = [
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'today',     label: 'Today' },
  { id: 'tomorrow',  label: 'Tomorrow' },
  { id: 'thisweek',  label: 'This Week' },
  { id: 'nextweek',  label: 'Next Week' },
  { id: 'custom',    label: 'Custom dates', icon: true },
]

function getFilterRange(filterId) {
  const today = todayISO()
  switch (filterId) {
    case 'yesterday': return [addDays(today, -1), addDays(today, -1)]
    case 'today':     return [today, today]
    case 'tomorrow':  return [addDays(today, 1), addDays(today, 1)]
    case 'thisweek':  return getWeekRange(0)
    case 'nextweek':  return getWeekRange(1)
    default:          return [today, today]
  }
}

/* ─── Two-month range calendar picker ───────────────────────────────────────── */

const DAY_NAMES = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function dateToIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtDisplayDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

function MonthGrid({ year, month, rangeStart, rangeEnd, hoverDate, onDayClick, onDayHover }) {
  const firstDay = new Date(year, month, 1)
  // Monday-based: 0=Mon..6=Sun
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const today = todayISO()

  return (
    <div className="rp-month">
      <div className="rp-day-names">
        {DAY_NAMES.map((n, i) => <span key={i} className="rp-day-name">{n}</span>)}
      </div>
      <div className="rp-cells">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="rp-cell rp-cell-empty" />
          const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          const isToday = iso === today
          const isStart = iso === rangeStart
          const isEnd = iso === rangeEnd
          const effectiveEnd = rangeEnd || hoverDate
          const inRange = rangeStart && effectiveEnd && iso > rangeStart && iso < effectiveEnd
          const cls = [
            'rp-cell',
            isStart ? 'rp-start' : '',
            isEnd ? 'rp-end' : '',
            inRange ? 'rp-in-range' : '',
            isToday && !isStart && !isEnd ? 'rp-today' : '',
          ].filter(Boolean).join(' ')
          return (
            <span key={i} className={cls}
              onClick={() => onDayClick(iso)}
              onMouseEnter={() => onDayHover(iso)}>
              {d}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function RangePicker({ from, to, onApply, onClose }) {
  const today = todayISO()
  const [leftYear,  setLeftYear]  = useState(() => { const d = from ? isoToDate(from) : new Date(); return d.getFullYear() })
  const [leftMonth, setLeftMonth] = useState(() => { const d = from ? isoToDate(from) : new Date(); return d.getMonth() })
  const [selecting, setSelecting] = useState(null) // null | 'start'
  const [rangeStart, setRangeStart] = useState(from || null)
  const [rangeEnd,   setRangeEnd]   = useState(to || null)
  const [hoverDate,  setHoverDate]  = useState(null)
  const [startInput, setStartInput] = useState(fmtDisplayDate(from))
  const [endInput,   setEndInput]   = useState(fmtDisplayDate(to))
  const wrapRef = useRef(null)

  // Right month = left + 1
  const rightYear  = leftMonth === 11 ? leftYear + 1 : leftYear
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  function navLeft() {
    if (leftMonth === 0) { setLeftYear(y => y-1); setLeftMonth(11) }
    else setLeftMonth(m => m-1)
  }
  function navRight() {
    if (leftMonth === 11) { setLeftYear(y => y+1); setLeftMonth(0) }
    else setLeftMonth(m => m+1)
  }

  function handleDayClick(iso) {
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(iso); setRangeEnd(null)
      setStartInput(fmtDisplayDate(iso)); setEndInput('')
      setHoverDate(null)
    } else {
      if (iso < rangeStart) {
        setRangeEnd(rangeStart); setRangeStart(iso)
        setStartInput(fmtDisplayDate(iso)); setEndInput(fmtDisplayDate(rangeStart))
      } else {
        setRangeEnd(iso)
        setEndInput(fmtDisplayDate(iso))
      }
      setHoverDate(null)
    }
  }

  function handleApply() {
    if (rangeStart && rangeEnd) onApply(rangeStart, rangeEnd)
    else if (rangeStart) onApply(rangeStart, rangeStart)
  }

  function handleToday() {
    setRangeStart(today); setRangeEnd(today)
    setStartInput(fmtDisplayDate(today)); setEndInput(fmtDisplayDate(today))
    const d = new Date(); setLeftYear(d.getFullYear()); setLeftMonth(d.getMonth())
  }

  function handleClear() {
    setRangeStart(null); setRangeEnd(null)
    setStartInput(''); setEndInput('')
  }

  function monthLabel(y, m) {
    return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  return (
    <div className="rp-popup" ref={wrapRef}>
      <div className="rp-calendars">
        {/* Left month */}
        <div className="rp-month-col">
          <div className="rp-month-header">
            <button className="rp-nav-btn" onClick={navLeft}>‹</button>
            <span className="rp-month-label">{monthLabel(leftYear, leftMonth)}</span>
            <button className="rp-nav-btn rp-nav-right-mobile" onClick={navRight}>›</button>
          </div>
          <MonthGrid year={leftYear} month={leftMonth}
            rangeStart={rangeStart} rangeEnd={rangeEnd}
            hoverDate={!rangeEnd ? hoverDate : null}
            onDayClick={handleDayClick} onDayHover={setHoverDate} />
        </div>
        {/* Right month */}
        <div className="rp-month-col rp-month-right">
          <div className="rp-month-header">
            <span className="rp-month-label">{monthLabel(rightYear, rightMonth)}</span>
            <button className="rp-nav-btn" onClick={navRight}>›</button>
          </div>
          <MonthGrid year={rightYear} month={rightMonth}
            rangeStart={rangeStart} rangeEnd={rangeEnd}
            hoverDate={!rangeEnd ? hoverDate : null}
            onDayClick={handleDayClick} onDayHover={setHoverDate} />
        </div>
      </div>
      <div className="rp-footer">
        <button className="rp-today-btn" onClick={handleToday}>Today</button>
        <button className="rp-clear-btn" onClick={handleClear}>Clear</button>
      </div>
      <div className="rp-inputs">
        <div className="rp-input-group">
          <label className="rp-input-label">Start Date</label>
          <input className="rp-input" value={startInput} readOnly placeholder="MM/DD/YYYY" />
        </div>
        <div className="rp-input-group">
          <label className="rp-input-label">End Date</label>
          <input className="rp-input" value={endInput} readOnly placeholder="MM/DD/YYYY" />
        </div>
        <button className="rp-apply-btn" onClick={handleApply}>Apply</button>
      </div>
    </div>
  )
}

function DateRangeFilter({ onChange, defaultFilter = 'today' }) {
  const [active,     setActive]     = useState(defaultFilter)
  const [customFrom, setCustomFrom] = useState(null)
  const [customTo,   setCustomTo]   = useState(null)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    const [f, t] = getFilterRange(defaultFilter)
    onChange(f, t)
  }, [])

  function select(filterId) {
    setActive(filterId)
    if (filterId !== 'custom') {
      setShowPicker(false)
      const [f, t] = getFilterRange(filterId)
      onChange(f, t)
    } else {
      setShowPicker(true)
    }
  }

  function handleApply(from, to) {
    setCustomFrom(from); setCustomTo(to)
    setShowPicker(false)
    onChange(from, to)
  }

  return (
    <div className="cal-df-wrap" style={{ position: 'relative' }}>
      <div className="cal-df-pills">
        {DATE_FILTER_OPTIONS.map(opt => (
          <button key={opt.id}
            className={`cal-df-pill ${active === opt.id ? 'active' : ''}`}
            onClick={() => select(opt.id)}>
            {opt.icon && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            )}
            {opt.label}
          </button>
        ))}
      </div>
      {showPicker && (
        <RangePicker
          from={customFrom} to={customTo}
          onApply={handleApply}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

function CalTable({ headers, children, loading, empty }) {
  return (
    <div className="cal-table-wrap">
      {loading ? (
        <div className="cal-loading">Loading…</div>
      ) : empty ? (
        <div className="cal-loading">No events found.</div>
      ) : (
        <table className="cal-table">
          <thead>
            <tr>{headers.map((h, i) => <th key={i} className={`cal-th ${h.cls || ''}`}>{h.label}</th>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  )
}


/* ─── Timezone selector ──────────────────────────────────────────────────────── */

function TZSelector({ tzOffset, onChange }) {
  const [now, setNow] = useState(() => new Date())
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const local   = new Date(now.getTime() + tzOffset * 60000)
  const hh      = String(local.getUTCHours()).padStart(2, '0')
  const mm      = String(local.getUTCMinutes()).padStart(2, '0')
  const sign    = tzOffset >= 0 ? '+' : '-'
  const absOff  = Math.abs(tzOffset)
  const offH    = String(Math.floor(absOff / 60)).padStart(2, '0')
  const offM    = String(absOff % 60).padStart(2, '0')
  const tzLabel = tzOffset === 0 ? 'UTC' : `GMT${sign}${offH}:${offM}`

  return (
    <div className="cal-tz-wrap" ref={wrapRef}>
      <button className="cal-tz-btn" onClick={() => setOpen(o => !o)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>Current Time: <strong>{hh}:{mm}</strong> ({tzLabel})</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="cal-tz-dropdown">
          {UTC_OFFSETS.map(o => (
            <button key={o.offset}
              className={`cal-tz-opt ${tzOffset === o.offset ? 'active' : ''}`}
              onClick={() => { onChange(o.offset); setOpen(false) }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Economic Calendar tab ──────────────────────────────────────────────────── */

function EconCalendar({ search }) {
  const [events,   setEvents]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [fromDate, setFromDate] = useState(todayISO)
  const [toDate,   setToDate]   = useState(todayISO)
  const [impFilter,setImpFilter]= useState('All')
  const [tzOffset, setTzOffset] = useState(() => -new Date().getTimezoneOffset())
  const [now, setNow] = useState(() => new Date())
  const [selectedEvent, setSelectedEvent] = useState(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const localNow = new Date(now.getTime() + tzOffset * 60000)
  const currentTotalMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes()

  useEffect(() => {
    setLoading(true)
    fetch(`/api/economic-calendar?from_date=${fromDate}&to_date=${toDate}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setEvents(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [fromDate, toDate])

  function setRange(from, to) { setFromDate(from); setToDate(to) }

  const filtered = useMemo(() => {
    let ev = events
    if (impFilter !== 'All') ev = ev.filter(e => e.impact === impFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      ev = ev.filter(e => e.event?.toLowerCase().includes(q) || e.country?.toLowerCase().includes(q))
    }
    return ev
  }, [events, impFilter, search])

  const groups = useMemo(() => {
    const map = new Map()
    for (const ev of filtered) {
      const day = (ev.date || '').slice(0, 10)
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(ev)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const today = todayISO()
  const headers = [
    { label: 'Time',     cls: 'cal-th-time' },
    { label: 'Cur.',     cls: 'cal-th-cur' },
    { label: 'Event',    cls: 'cal-th-event' },
    { label: 'Imp.',     cls: 'cal-th-imp' },
    { label: 'Actual',   cls: 'cal-th-num' },
    { label: 'Forecast', cls: 'cal-th-num' },
    { label: 'Previous', cls: 'cal-th-num' },
  ]

  return (
    <div className="cal-wrap">
      <div className="cal-toolbar cal-toolbar-split">
        <div className="cal-tf-top">
          <DateRangeFilter onChange={setRange} defaultFilter="today" />
          <TZSelector tzOffset={tzOffset} onChange={setTzOffset} />
        </div>
        <div className="cal-tf-bottom">
          <div className="cal-imp-filters">
            {['All', 'High', 'Medium', 'Low'].map(lvl => (
              <button key={lvl}
                className={`cal-imp-btn ${impFilter === lvl ? 'active' : ''} ${lvl !== 'All' ? `imp-${lvl.toLowerCase()}` : ''}`}
                onClick={() => setImpFilter(lvl)}>{lvl}
              </button>
            ))}
          </div>
        </div>
      </div>
      <CalTable headers={headers} loading={loading} empty={!loading && groups.length === 0}>
        {groups.map(([day, dayEvents]) => {
          const isToday = day === today
          let nowIdx = -1
          if (isToday) {
            nowIdx = dayEvents.findIndex(ev => parseEventMinutes(ev.date, tzOffset) >= currentTotalMinutes)
            if (nowIdx === -1) nowIdx = dayEvents.length
          }
          return (
            <>
              <tr key={`sep-${day}`} className="cal-day-row">
                <td colSpan={7} className={`cal-day-cell ${isToday ? 'cal-day-today' : ''}`}>
                  {formatCalDay(day)}{isToday ? ' — Today' : ''}
                </td>
              </tr>
              {dayEvents.map((ev, idx) => {
                const flagCode = COUNTRY_FLAGS[ev.country] || ev.country?.toLowerCase()
                const hasActual = ev.actual != null
                const hasForecast = ev.estimate != null
                const beat = hasActual && hasForecast && ev.actual >= ev.estimate
                const miss = hasActual && hasForecast && ev.actual < ev.estimate
                const isPast = isToday && nowIdx > 0 && idx < nowIdx
                const isNext = isToday && idx === nowIdx && nowIdx < dayEvents.length
                return (
                  <>
                    <tr key={`${day}-${idx}`} className={`cal-row imp-row-${(ev.impact||'').toLowerCase()}${isPast ? ' cal-row-past' : isNext ? ' cal-row-next' : ''}`} onClick={() => setSelectedEvent(ev)} style={{ cursor: 'pointer' }}>
                      <td className="cal-td cal-td-time">{formatCalTime(ev.date, tzOffset)}</td>
                      <td className="cal-td">
                        <div className="cal-cur-cell">
                          {flagCode && <img src={`https://flagcdn.com/w40/${flagCode}.png`} alt={ev.country} className="cal-flag" />}
                          <span className="cal-country">{ev.country}</span>
                        </div>
                      </td>
                      <td className="cal-td cal-td-event">
                        <span>{ev.event}</span>
                        <div className="cal-mobile-stats">
                          {hasActual && <span className={`cal-ms-item ${beat ? 'cal-beat' : miss ? 'cal-miss' : ''}`}>Act: {fmtCalVal(ev.actual, ev.unit)}</span>}
                          {hasForecast && <span className="cal-ms-item cal-ms-muted">Cons: {fmtCalVal(ev.estimate, ev.unit)}</span>}
                          {ev.previous != null && <span className="cal-ms-item cal-ms-muted">Prev.: {fmtCalVal(ev.previous, ev.unit)}</span>}
                        </div>
                      </td>
                      <td className="cal-td cal-td-imp"><ImpactStars impact={ev.impact} /></td>
                      <td className="cal-td cal-td-num">
                        <span className={`cal-val ${beat ? 'cal-beat' : miss ? 'cal-miss' : ''}`}>
                          {hasActual ? fmtCalVal(ev.actual, ev.unit) : '—'}
                        </span>
                      </td>
                      <td className="cal-td cal-td-num">
                        <span className="cal-val-muted">{hasForecast ? fmtCalVal(ev.estimate, ev.unit) : '—'}</span>
                      </td>
                      <td className="cal-td cal-td-num">
                        <span className="cal-val-muted">{ev.previous != null ? fmtCalVal(ev.previous, ev.unit) : '—'}</span>
                      </td>
                    </tr>
                  </>
                )
              })}
            </>
          )
        })}
      </CalTable>
      {selectedEvent && (
        <EventModal ev={selectedEvent} tzOffset={tzOffset} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  )
}

/* ─── Earnings Calendar tab ──────────────────────────────────────────────────── */

function EarningsCalendar({ search }) {
  const [events,   setEvents]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [fromDate, setFromDate] = useState(() => getWeekRange(0)[0])
  const [toDate,   setToDate]   = useState(() => getWeekRange(0)[1])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/earnings-calendar?from_date=${fromDate}&to_date=${toDate}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setEvents(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [fromDate, toDate])

  function setRange(from, to) { setFromDate(from); setToDate(to) }

  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.trim().toLowerCase()
    return events.filter(e => e.symbol?.toLowerCase().includes(q))
  }, [events, search])

  const groups = useMemo(() => {
    const map = new Map()
    for (const ev of filtered) {
      const day = ev.date || ''
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(ev)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const today = todayISO()
  const headers = [
    { label: 'Symbol',     cls: 'cal-th-sym' },
    { label: 'EPS Actual', cls: 'cal-th-num' },
    { label: 'EPS Est.',   cls: 'cal-th-num' },
    { label: 'Rev Actual', cls: 'cal-th-num' },
    { label: 'Rev Est.',   cls: 'cal-th-num' },
  ]

  return (
    <div className="cal-wrap">
      <div className="cal-toolbar cal-toolbar-split">
        <div className="cal-tf-top">
          <DateRangeFilter onChange={setRange} defaultFilter="thisweek" />
        </div>
      </div>

      {/* Desktop table */}
      <div className="cal-desktop-table">
        <CalTable headers={headers} loading={loading} empty={!loading && groups.length === 0}>
          {groups.map(([day, dayEvents]) => (
            <>
              <tr key={`sep-${day}`} className="cal-day-row">
                <td colSpan={5} className={`cal-day-cell ${day === today ? 'cal-day-today' : ''}`}>
                  {formatCalDay(day)}{day === today ? ' — Today' : ''}
                </td>
              </tr>
              {dayEvents.map((ev, idx) => {
                const epsBeat = ev.epsActual != null && ev.epsEstimated != null && ev.epsActual >= ev.epsEstimated
                const epsMiss = ev.epsActual != null && ev.epsEstimated != null && ev.epsActual < ev.epsEstimated
                const revBeat = ev.revenueActual != null && ev.revenueEstimated != null && ev.revenueActual >= ev.revenueEstimated
                const revMiss = ev.revenueActual != null && ev.revenueEstimated != null && ev.revenueActual < ev.revenueEstimated
                return (
                  <tr key={`${day}-${idx}`} className="cal-row">
                    <td className="cal-td cal-td-sym">{ev.symbol}</td>
                    <td className="cal-td cal-td-num">
                      <span className={`cal-val ${epsBeat ? 'cal-beat' : epsMiss ? 'cal-miss' : ''}`}>
                        {ev.epsActual != null ? fmtNum(ev.epsActual) : '—'}
                      </span>
                    </td>
                    <td className="cal-td cal-td-num"><span className="cal-val-muted">{fmtNum(ev.epsEstimated)}</span></td>
                    <td className="cal-td cal-td-num">
                      <span className={`cal-val ${revBeat ? 'cal-beat' : revMiss ? 'cal-miss' : ''}`}>
                        {ev.revenueActual != null ? fmtMktCap(ev.revenueActual) : '—'}
                      </span>
                    </td>
                    <td className="cal-td cal-td-num"><span className="cal-val-muted">{ev.revenueEstimated != null ? fmtMktCap(ev.revenueEstimated) : '—'}</span></td>
                  </tr>
                )
              })}
            </>
          ))}
        </CalTable>
      </div>

      {/* Mobile cards */}
      <div className="cal-mobile-cards">
        {loading && <div className="cal-loading">Loading…</div>}
        {!loading && groups.length === 0 && <div className="cal-loading">No events found.</div>}
        {groups.map(([day, dayEvents]) => (
          <div key={day}>
            <div className={`cal-card-day-label ${day === today ? 'cal-day-today' : ''}`}>
              {formatCalDay(day)}{day === today ? ' — Today' : ''}
            </div>
            <div className="cal-cards-grid">
            {dayEvents.map((ev, idx) => {
              const epsBeat = ev.epsActual != null && ev.epsEstimated != null && ev.epsActual >= ev.epsEstimated
              const epsMiss = ev.epsActual != null && ev.epsEstimated != null && ev.epsActual < ev.epsEstimated
              const revBeat = ev.revenueActual != null && ev.revenueEstimated != null && ev.revenueActual >= ev.revenueEstimated
              const revMiss = ev.revenueActual != null && ev.revenueEstimated != null && ev.revenueActual < ev.revenueEstimated
              return (
                <div key={idx} className="cal-earn-card">
                  <div className="cal-earn-card-top">
                    <div className="cal-card-identity">
                      <span className="cal-card-ticker">{ev.symbol}</span>
                      {ev.name && ev.name !== ev.symbol && <span className="cal-card-company">{ev.name}</span>}
                    </div>
                    {(epsBeat || epsMiss) && (
                      <span className={`cal-card-verdict ${epsBeat ? 'cal-beat' : 'cal-miss'}`}>
                        {epsBeat ? '▲ Beat' : '▼ Missed'}
                      </span>
                    )}
                  </div>
                  <div className="cal-earn-card-grid">
                    <div className="cal-earn-cell">
                      <span className="cal-earn-cell-label">EPS Actual</span>
                      <span className={`cal-earn-cell-val ${epsBeat ? 'cal-beat' : epsMiss ? 'cal-miss' : ''}`}>
                        {ev.epsActual != null ? fmtNum(ev.epsActual) : '—'}
                      </span>
                    </div>
                    <div className="cal-earn-cell">
                      <span className="cal-earn-cell-label">EPS Est.</span>
                      <span className="cal-earn-cell-val cal-muted-val">{fmtNum(ev.epsEstimated)}</span>
                    </div>
                    <div className="cal-earn-cell">
                      <span className="cal-earn-cell-label">Revenue</span>
                      <span className={`cal-earn-cell-val ${revBeat ? 'cal-beat' : revMiss ? 'cal-miss' : ''}`}>
                        {ev.revenueActual != null ? fmtMktCap(ev.revenueActual) : '—'}
                      </span>
                    </div>
                    <div className="cal-earn-cell">
                      <span className="cal-earn-cell-label">Rev Est.</span>
                      <span className="cal-earn-cell-val cal-muted-val">{ev.revenueEstimated != null ? fmtMktCap(ev.revenueEstimated) : '—'}</span>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Dividends Calendar tab ─────────────────────────────────────────────────── */

function DividendsCalendar({ search }) {
  const [events,   setEvents]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [fromDate, setFromDate] = useState(() => getWeekRange(0)[0])
  const [toDate,   setToDate]   = useState(() => getWeekRange(0)[1])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/dividends-calendar?from_date=${fromDate}&to_date=${toDate}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setEvents(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [fromDate, toDate])

  function setRange(from, to) { setFromDate(from); setToDate(to) }

  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.trim().toLowerCase()
    return events.filter(e => e.symbol?.toLowerCase().includes(q))
  }, [events, search])

  const groups = useMemo(() => {
    const map = new Map()
    for (const ev of filtered) {
      const day = ev.date || ''
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(ev)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const today = todayISO()
  const headers = [
    { label: 'Symbol',       cls: 'cal-th-sym' },
    { label: 'Dividend',     cls: 'cal-th-num' },
    { label: 'Yield',        cls: 'cal-th-num' },
    { label: 'Frequency',    cls: '' },
    { label: 'Record Date',  cls: '' },
    { label: 'Payment Date', cls: '' },
  ]

  return (
    <div className="cal-wrap">
      <div className="cal-toolbar cal-toolbar-split">
        <div className="cal-tf-top">
          <DateRangeFilter onChange={setRange} defaultFilter="thisweek" />
        </div>
      </div>

      {/* Desktop table */}
      <div className="cal-desktop-table">
        <CalTable headers={headers} loading={loading} empty={!loading && groups.length === 0}>
          {groups.map(([day, dayEvents]) => (
            <>
              <tr key={`sep-${day}`} className="cal-day-row">
                <td colSpan={6} className={`cal-day-cell ${day === today ? 'cal-day-today' : ''}`}>
                  Ex-Date: {formatCalDay(day)}{day === today ? ' — Today' : ''}
                </td>
              </tr>
              {dayEvents.map((ev, idx) => (
                <tr key={`${day}-${idx}`} className="cal-row">
                  <td className="cal-td cal-td-sym">{ev.symbol}</td>
                  <td className="cal-td cal-td-num"><span className="cal-val">${fmtNum(ev.adjDividend)}</span></td>
                  <td className="cal-td cal-td-num">
                    <span className="cal-val cal-beat">{ev.yield != null ? `${Number(ev.yield).toFixed(2)}%` : '—'}</span>
                  </td>
                  <td className="cal-td"><span className="cal-badge">{ev.frequency || '—'}</span></td>
                  <td className="cal-td cal-td-date">{ev.recordDate || '—'}</td>
                  <td className="cal-td cal-td-date">{ev.paymentDate || '—'}</td>
                </tr>
              ))}
            </>
          ))}
        </CalTable>
      </div>

      {/* Mobile cards */}
      <div className="cal-mobile-cards">
        {loading && <div className="cal-loading">Loading…</div>}
        {!loading && groups.length === 0 && <div className="cal-loading">No events found.</div>}
        {groups.map(([day, dayEvents]) => (
          <div key={day}>
            <div className={`cal-card-day-label ${day === today ? 'cal-day-today' : ''}`}>
              Ex-Date: {formatCalDay(day)}{day === today ? ' — Today' : ''}
            </div>
            <div className="cal-cards-grid">
            {dayEvents.map((ev, idx) => (
              <div key={idx} className="cal-div-card">
                <div className="cal-div-card-top">
                  <div className="cal-card-identity">
                    <span className="cal-card-ticker">{ev.symbol}</span>
                    {ev.name && ev.name !== ev.symbol && <span className="cal-card-company">{ev.name}</span>}
                  </div>
                  <div className="cal-div-card-right">
                    <span className="cal-div-amount">${fmtNum(ev.adjDividend)}</span>
                    {ev.yield != null && (
                      <span className="cal-div-yield-pill">{Number(ev.yield).toFixed(2)}%</span>
                    )}
                  </div>
                </div>
                <div className="cal-div-card-bottom">
                  {ev.frequency && <span className="cal-div-freq">{ev.frequency}</span>}
                  {ev.recordDate && <span className="cal-div-date-item">Rec: {ev.recordDate}</span>}
                  {ev.paymentDate && <span className="cal-div-date-item">Pay: {ev.paymentDate}</span>}
                </div>
              </div>
            ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── IPO Calendar tab ───────────────────────────────────────────────────────── */

function IPOCalendar({ search }) {
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)
  const [fromDate,setFromDate]= useState(() => getWeekRange(1)[0])
  const [toDate,  setToDate]  = useState(() => getWeekRange(1)[1])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ipo-calendar?from_date=${fromDate}&to_date=${toDate}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setEvents(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [fromDate, toDate])

  function setRange(from, to) { setFromDate(from); setToDate(to) }

  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.trim().toLowerCase()
    return events.filter(e => e.symbol?.toLowerCase().includes(q) || e.company?.toLowerCase().includes(q))
  }, [events, search])

  const groups = useMemo(() => {
    const map = new Map()
    for (const ev of filtered) {
      const day = ev.date || ''
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(ev)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const today = todayISO()
  const headers = [
    { label: 'Symbol',      cls: 'cal-th-sym' },
    { label: 'Company',     cls: 'cal-th-event' },
    { label: 'Exchange',    cls: '' },
    { label: 'Price Range', cls: 'cal-th-num' },
    { label: 'Shares',      cls: 'cal-th-num' },
    { label: 'Mkt Cap',     cls: 'cal-th-num' },
    { label: 'Status',      cls: '' },
  ]

  return (
    <div className="cal-wrap">
      <div className="cal-toolbar cal-toolbar-split">
        <div className="cal-tf-top">
          <DateRangeFilter onChange={setRange} defaultFilter="nextweek" />
        </div>
      </div>

      {/* Desktop table */}
      <div className="cal-desktop-table">
        <CalTable headers={headers} loading={loading} empty={!loading && groups.length === 0}>
          {groups.map(([day, dayEvents]) => (
            <>
              <tr key={`sep-${day}`} className="cal-day-row">
                <td colSpan={7} className={`cal-day-cell ${day === today ? 'cal-day-today' : ''}`}>
                  {formatCalDay(day)}{day === today ? ' — Today' : ''}
                </td>
              </tr>
              {dayEvents.map((ev, idx) => (
                <tr key={`${day}-${idx}`} className="cal-row">
                  <td className="cal-td cal-td-sym">{ev.symbol}</td>
                  <td className="cal-td cal-td-event">{ev.company}</td>
                  <td className="cal-td"><span className="cal-badge">{ev.exchange}</span></td>
                  <td className="cal-td cal-td-num"><span className="cal-val">{ev.priceRange || '—'}</span></td>
                  <td className="cal-td cal-td-num"><span className="cal-val-muted">{ev.shares != null ? (ev.shares / 1e6).toFixed(1) + 'M' : '—'}</span></td>
                  <td className="cal-td cal-td-num"><span className="cal-val">{fmtMktCap(ev.marketCap)}</span></td>
                  <td className="cal-td">
                    <span className={`cal-badge ${ev.actions === 'Priced' ? 'cal-badge-green' : ev.actions === 'Expected' ? 'cal-badge-blue' : ''}`}>
                      {ev.actions || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </>
          ))}
        </CalTable>
      </div>

      {/* Mobile cards */}
      <div className="cal-mobile-cards">
        {loading && <div className="cal-loading">Loading…</div>}
        {!loading && groups.length === 0 && <div className="cal-loading">No events found.</div>}
        {groups.map(([day, dayEvents]) => (
          <div key={day}>
            <div className={`cal-card-day-label ${day === today ? 'cal-day-today' : ''}`}>
              {formatCalDay(day)}{day === today ? ' — Today' : ''}
            </div>
            <div className="cal-cards-grid">
            {dayEvents.map((ev, idx) => (
              <div key={idx} className="cal-ipo-card">
                <div className="cal-ipo-card-top">
                  <div className="cal-card-identity">
                    <span className="cal-card-ticker">{ev.symbol}</span>
                    <span className="cal-ipo-company">{ev.company}</span>
                  </div>
                  {ev.actions && (
                    <span className={`cal-badge ${ev.actions === 'Priced' ? 'cal-badge-green' : ev.actions === 'Expected' ? 'cal-badge-blue' : ''}`}>
                      {ev.actions}
                    </span>
                  )}
                </div>
                <div className="cal-ipo-prices">
                  {ev.ipoPrice != null && (
                    <div className="cal-ipo-price-item">
                      <span className="cal-ipo-price-label">IPO Price</span>
                      <span className="cal-ipo-price-val">${fmtNum(ev.ipoPrice)}</span>
                    </div>
                  )}
                  {ev.currentPrice != null && (
                    <div className="cal-ipo-price-item">
                      <span className="cal-ipo-price-label">Current</span>
                      <span className={`cal-ipo-price-val ${ev.currentPrice >= ev.ipoPrice ? 'cal-beat' : 'cal-miss'}`}>
                        ${fmtNum(ev.currentPrice)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Main page ──────────────────────────────────────────────────────────────── */

export default function EconomicsPage({ dark }) {
  const [activeTab, setActiveTab] = useState('economic')
  const [search,    setSearch]    = useState('')

  // Reset search when switching tabs
  function switchTab(id) { setActiveTab(id); setSearch('') }

  return (
    <div className="econ-page econ-cal-page">

      {/* Page header */}
      <div className="econ-ph">
        <div className="econ-ph-left">
          <h1 className="econ-ph-title">
            {NAV_TABS.find(t => t.id === activeTab)?.label ?? 'Economic Calendar'}
          </h1>
        </div>
        <div className="econ-ph-search-wrap">
          <svg className="econ-ph-search-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <input
            className="econ-ph-search"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="econ-ph-search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
      </div>

      {/* Underline nav tabs */}
      <div className="econ-nav-tabs">
        {NAV_TABS.map(tab => (
          <button
            key={tab.id}
            className={`econ-nav-tab ${activeTab === tab.id ? 'active' : ''} ${tab.disabled ? 'disabled' : ''}`}
            onClick={() => !tab.disabled && switchTab(tab.id)}
            title={tab.disabled ? 'Coming soon' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="econ-tab-content">
        {activeTab === 'economic'  && <EconCalendar     search={search} dark={dark} />}
        {activeTab === 'earnings'  && <EarningsCalendar search={search} dark={dark} />}
        {activeTab === 'dividends' && <DividendsCalendar search={search} dark={dark} />}
        {activeTab === 'ipo'       && <IPOCalendar       search={search} dark={dark} />}
      </div>
    </div>
  )
}
