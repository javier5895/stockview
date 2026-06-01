/* ─── Seeded RNG ───────────────────────────────────────────── */
function seeded(seed) {
  let s = seed >>> 0
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff }
}

function walk(start, n, vol, drift, seed) {
  const r = seeded(seed)
  const out = [start]
  for (let i = 1; i < n; i++) out.push(parseFloat((Math.max(0.01, out[i-1] + (r()-0.5)*vol + drift)).toFixed(2)))
  return out
}

function gen1D(open, vol, drift, seed) {
  const prices = walk(open, 195, vol, drift, seed)
  const labels = []
  for (let h = 9; h <= 15; h++) {
    const sm = h === 9 ? 30 : 0
    for (let m = sm; m < 60; m += 2) {
      const hr = h > 12 ? h - 12 : h
      labels.push(`${hr}:${m.toString().padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`)
    }
  }
  return prices.map((price, i) => ({ time: labels[i] ?? '', price }))
}

function genDays(start, n, vol, drift, seed, fromDaysAgo) {
  const prices = walk(start, n, vol, drift, seed)
  const base = new Date('2026-05-27'); base.setDate(base.getDate() - fromDaysAgo)
  let d = new Date(base); const out = []
  for (let i = 0; i < n; i++) {
    while (d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()+1)
    out.push({ time: d.toLocaleDateString('en-US',{month:'short',day:'numeric'}), price: prices[i] })
    d.setDate(d.getDate()+1)
  }
  return out
}

function genMonths(start, n, vol, drift, seed, fromMonthsAgo) {
  const prices = walk(start, n, vol, drift, seed)
  const base = new Date('2026-05-27'); base.setMonth(base.getMonth() - fromMonthsAgo)
  return prices.map((price,i)=>{
    const d = new Date(base); d.setMonth(d.getMonth()+i)
    return { time: d.toLocaleDateString('en-US',{month:'short',year:'2-digit'}), price }
  })
}

function genSparkline(start, vol, drift, seed, n=40) {
  return walk(start, n, vol, drift, seed)
}

function formatCap(n) {
  if (n >= 1e12) return `${(n/1e12).toFixed(2)}T`
  if (n >= 1e9)  return `${(n/1e9).toFixed(1)}B`
  return `${(n/1e6).toFixed(0)}M`
}

/* ─── Pre-built Stocks ─────────────────────────────────────── */
const BUILT = {
  AAPL: { name:'Apple Inc.', ticker:'AAPL', exchange:'NASDAQ', currency:'USD', previousClose:265.28, marketCap:'4.08T', sector:'Technology',
    periods: { '1D':gen1D(265.65,0.28,0.022,42), '5D':genDays(261.2,5,1.8,0.8,7,5), '1M':genDays(252.4,22,1.4,0.62,11,22), 'YTD':genDays(238.1,103,1.1,0.31,15,103), '3M':genDays(249.8,66,1.2,0.3,19,66), '6M':genDays(231.5,132,1.0,0.29,23,132), '1Y':genDays(198.7,252,0.9,0.27,27,252), '5Y':genMonths(142.3,60,5.2,2.1,31,60), 'Max':genMonths(18.4,120,3.8,2.6,35,120) }},
  TSLA: { name:'Tesla, Inc.', ticker:'TSLA', exchange:'NASDAQ', currency:'USD', previousClose:182.40, marketCap:'584B', sector:'Consumer Cyclical',
    periods: { '1D':gen1D(182.40,0.65,-0.038,88), '5D':genDays(187.1,5,3.2,-0.9,12,5), '1M':genDays(191.3,22,2.8,-0.4,17,22), 'YTD':genDays(248.6,103,2.4,-0.45,22,103), '3M':genDays(205.4,66,2.6,-0.6,25,66), '6M':genDays(218.9,132,2.2,-0.35,29,132), '1Y':genDays(195.2,252,2.0,-0.08,33,252), '5Y':genMonths(220.1,60,9.8,-1.8,38,60), 'Max':genMonths(12.3,120,6.4,3.2,42,120) }},
  NVDA: { name:'NVIDIA Corporation', ticker:'NVDA', exchange:'NASDAQ', currency:'USD', previousClose:131.18, marketCap:'3.21T', sector:'Technology',
    periods: { '1D':gen1D(131.18,0.42,0.033,63), '5D':genDays(127.4,5,2.1,0.7,9,5), '1M':genDays(118.9,22,1.8,0.58,13,22), 'YTD':genDays(102.4,103,1.5,0.28,18,103), '3M':genDays(110.2,66,1.7,0.35,21,66), '6M':genDays(96.7,132,1.4,0.26,26,132), '1Y':genDays(79.3,252,1.2,0.22,30,252), '5Y':genMonths(28.4,60,4.8,1.95,34,60), 'Max':genMonths(4.2,120,2.9,1.8,38,120) }},
  META: { name:'Meta Platforms, Inc.', ticker:'META', exchange:'NASDAQ', currency:'USD', previousClose:618.50, marketCap:'1.57T', sector:'Communication Services',
    periods: { '1D':gen1D(618.50,1.1,-0.055,77), '5D':genDays(624.8,5,4.2,-1.2,14,5), '1M':genDays(641.2,22,3.6,-1.1,18,22), 'YTD':genDays(585.3,103,2.8,0.32,23,103), '3M':genDays(608.4,66,3.1,-0.5,27,66), '6M':genDays(562.7,132,2.6,0.42,31,132), '1Y':genDays(491.8,252,2.3,0.5,36,252), '5Y':genMonths(198.4,60,12.4,3.8,40,60), 'Max':genMonths(38.1,120,8.2,4.1,44,120) }},
}

/* ─── Companies List (for search) ─────────────────────────── */
export const COMPANIES = [
  // Technology
  {ticker:'AAPL',  name:'Apple Inc.',                            exchange:'NASDAQ', sector:'Technology'},
  {ticker:'MSFT',  name:'Microsoft Corporation',                 exchange:'NASDAQ', sector:'Technology'},
  {ticker:'GOOGL', name:'Alphabet Inc. Class A',                 exchange:'NASDAQ', sector:'Technology'},
  {ticker:'GOOG',  name:'Alphabet Inc. Class C',                 exchange:'NASDAQ', sector:'Technology'},
  {ticker:'AMZN',  name:'Amazon.com Inc.',                       exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'META',  name:'Meta Platforms Inc.',                   exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'TSLA',  name:'Tesla Inc.',                            exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'NVDA',  name:'NVIDIA Corporation',                    exchange:'NASDAQ', sector:'Technology'},
  {ticker:'AMD',   name:'Advanced Micro Devices Inc.',           exchange:'NASDAQ', sector:'Technology'},
  {ticker:'INTC',  name:'Intel Corporation',                     exchange:'NASDAQ', sector:'Technology'},
  {ticker:'NFLX',  name:'Netflix Inc.',                          exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'ADBE',  name:'Adobe Inc.',                            exchange:'NASDAQ', sector:'Technology'},
  {ticker:'CRM',   name:'Salesforce Inc.',                       exchange:'NYSE',   sector:'Technology'},
  {ticker:'ORCL',  name:'Oracle Corporation',                    exchange:'NYSE',   sector:'Technology'},
  {ticker:'IBM',   name:'International Business Machines Corp.', exchange:'NYSE',   sector:'Technology'},
  {ticker:'QCOM',  name:'Qualcomm Inc.',                         exchange:'NASDAQ', sector:'Technology'},
  {ticker:'TXN',   name:'Texas Instruments Inc.',                exchange:'NASDAQ', sector:'Technology'},
  {ticker:'AVGO',  name:'Broadcom Inc.',                         exchange:'NASDAQ', sector:'Technology'},
  {ticker:'MU',    name:'Micron Technology Inc.',                exchange:'NASDAQ', sector:'Technology'},
  {ticker:'AMAT',  name:'Applied Materials Inc.',                exchange:'NASDAQ', sector:'Technology'},
  {ticker:'LRCX',  name:'Lam Research Corporation',             exchange:'NASDAQ', sector:'Technology'},
  {ticker:'KLAC',  name:'KLA Corporation',                       exchange:'NASDAQ', sector:'Technology'},
  {ticker:'MRVL',  name:'Marvell Technology Inc.',               exchange:'NASDAQ', sector:'Technology'},
  {ticker:'SNOW',  name:'Snowflake Inc.',                        exchange:'NYSE',   sector:'Technology'},
  {ticker:'UBER',  name:'Uber Technologies Inc.',                exchange:'NYSE',   sector:'Technology'},
  {ticker:'LYFT',  name:'Lyft Inc.',                             exchange:'NASDAQ', sector:'Technology'},
  {ticker:'SPOT',  name:'Spotify Technology S.A.',              exchange:'NYSE',   sector:'Communication Services'},
  {ticker:'SQ',    name:'Block Inc.',                            exchange:'NYSE',   sector:'Technology'},
  {ticker:'SHOP',  name:'Shopify Inc.',                          exchange:'NYSE',   sector:'Technology'},
  {ticker:'COIN',  name:'Coinbase Global Inc.',                  exchange:'NASDAQ', sector:'Financial Services'},
  {ticker:'RBLX',  name:'Roblox Corporation',                    exchange:'NYSE',   sector:'Communication Services'},
  {ticker:'HOOD',  name:'Robinhood Markets Inc.',                exchange:'NASDAQ', sector:'Financial Services'},
  {ticker:'PLTR',  name:'Palantir Technologies Inc.',            exchange:'NYSE',   sector:'Technology'},
  {ticker:'AI',    name:'C3.ai Inc.',                            exchange:'NYSE',   sector:'Technology'},
  {ticker:'ZM',    name:'Zoom Video Communications Inc.',        exchange:'NASDAQ', sector:'Technology'},
  {ticker:'DOCU',  name:'DocuSign Inc.',                         exchange:'NASDAQ', sector:'Technology'},
  {ticker:'NET',   name:'Cloudflare Inc.',                       exchange:'NYSE',   sector:'Technology'},
  {ticker:'DDOG',  name:'Datadog Inc.',                          exchange:'NASDAQ', sector:'Technology'},
  {ticker:'CRWD',  name:'CrowdStrike Holdings Inc.',             exchange:'NASDAQ', sector:'Technology'},
  {ticker:'ZS',    name:'Zscaler Inc.',                          exchange:'NASDAQ', sector:'Technology'},
  {ticker:'OKTA',  name:'Okta Inc.',                             exchange:'NASDAQ', sector:'Technology'},
  {ticker:'MDB',   name:'MongoDB Inc.',                          exchange:'NASDAQ', sector:'Technology'},
  {ticker:'WDAY',  name:'Workday Inc.',                          exchange:'NASDAQ', sector:'Technology'},
  {ticker:'NOW',   name:'ServiceNow Inc.',                       exchange:'NYSE',   sector:'Technology'},
  {ticker:'INTU',  name:'Intuit Inc.',                           exchange:'NASDAQ', sector:'Technology'},
  {ticker:'PANW',  name:'Palo Alto Networks Inc.',               exchange:'NASDAQ', sector:'Technology'},
  {ticker:'FTNT',  name:'Fortinet Inc.',                         exchange:'NASDAQ', sector:'Technology'},
  {ticker:'TTD',   name:'The Trade Desk Inc.',                   exchange:'NASDAQ', sector:'Technology'},
  {ticker:'TWLO',  name:'Twilio Inc.',                           exchange:'NYSE',   sector:'Technology'},
  {ticker:'PATH',  name:'UiPath Inc.',                           exchange:'NYSE',   sector:'Technology'},
  {ticker:'TSM',   name:'Taiwan Semiconductor Manufacturing',    exchange:'NYSE',   sector:'Technology'},
  {ticker:'ASML',  name:'ASML Holding N.V.',                     exchange:'NASDAQ', sector:'Technology'},
  {ticker:'SAP',   name:'SAP SE',                                exchange:'NYSE',   sector:'Technology'},
  {ticker:'MSTR',  name:'MicroStrategy Inc.',                    exchange:'NASDAQ', sector:'Technology'},
  {ticker:'MARA',  name:'Marathon Digital Holdings Inc.',        exchange:'NASDAQ', sector:'Technology'},
  {ticker:'RIOT',  name:'Riot Platforms Inc.',                   exchange:'NASDAQ', sector:'Technology'},
  // Financial Services
  {ticker:'JPM',   name:'JPMorgan Chase & Co.',                  exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'BAC',   name:'Bank of America Corporation',           exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'WFC',   name:'Wells Fargo & Company',                 exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'GS',    name:'Goldman Sachs Group Inc.',              exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'MS',    name:'Morgan Stanley',                        exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'BLK',   name:'BlackRock Inc.',                        exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'V',     name:'Visa Inc.',                             exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'MA',    name:'Mastercard Inc.',                       exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'PYPL',  name:'PayPal Holdings Inc.',                  exchange:'NASDAQ', sector:'Financial Services'},
  {ticker:'AXP',   name:'American Express Company',              exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'C',     name:'Citigroup Inc.',                        exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'USB',   name:'U.S. Bancorp',                          exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'PNC',   name:'PNC Financial Services Group',          exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'SCHW',  name:'Charles Schwab Corporation',            exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'SPGI',  name:'S&P Global Inc.',                       exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'CME',   name:'CME Group Inc.',                        exchange:'NASDAQ', sector:'Financial Services'},
  {ticker:'AFRM',  name:'Affirm Holdings Inc.',                  exchange:'NASDAQ', sector:'Financial Services'},
  {ticker:'SOFI',  name:'SoFi Technologies Inc.',                exchange:'NASDAQ', sector:'Financial Services'},
  {ticker:'CB',    name:'Chubb Limited',                         exchange:'NYSE',   sector:'Financial Services'},
  {ticker:'ICE',   name:'Intercontinental Exchange Inc.',        exchange:'NYSE',   sector:'Financial Services'},
  // Healthcare
  {ticker:'JNJ',   name:'Johnson & Johnson',                     exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'UNH',   name:'UnitedHealth Group Inc.',               exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'PFE',   name:'Pfizer Inc.',                           exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'ABBV',  name:'AbbVie Inc.',                           exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'MRK',   name:'Merck & Co. Inc.',                      exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'LLY',   name:'Eli Lilly and Company',                 exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'BMY',   name:'Bristol-Myers Squibb Company',          exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'AMGN',  name:'Amgen Inc.',                            exchange:'NASDAQ', sector:'Healthcare'},
  {ticker:'GILD',  name:'Gilead Sciences Inc.',                  exchange:'NASDAQ', sector:'Healthcare'},
  {ticker:'REGN',  name:'Regeneron Pharmaceuticals Inc.',        exchange:'NASDAQ', sector:'Healthcare'},
  {ticker:'VRTX',  name:'Vertex Pharmaceuticals Inc.',           exchange:'NASDAQ', sector:'Healthcare'},
  {ticker:'MDT',   name:'Medtronic plc',                         exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'ABT',   name:'Abbott Laboratories',                   exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'TMO',   name:'Thermo Fisher Scientific Inc.',         exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'DHR',   name:'Danaher Corporation',                   exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'ISRG',  name:'Intuitive Surgical Inc.',               exchange:'NASDAQ', sector:'Healthcare'},
  {ticker:'MRNA',  name:'Moderna Inc.',                          exchange:'NASDAQ', sector:'Healthcare'},
  {ticker:'BNTX',  name:'BioNTech SE',                           exchange:'NASDAQ', sector:'Healthcare'},
  {ticker:'CVS',   name:'CVS Health Corporation',                exchange:'NYSE',   sector:'Healthcare'},
  {ticker:'GEHC',  name:'GE HealthCare Technologies Inc.',       exchange:'NASDAQ', sector:'Healthcare'},
  // Energy
  {ticker:'XOM',   name:'Exxon Mobil Corporation',               exchange:'NYSE',   sector:'Energy'},
  {ticker:'CVX',   name:'Chevron Corporation',                   exchange:'NYSE',   sector:'Energy'},
  {ticker:'COP',   name:'ConocoPhillips',                        exchange:'NYSE',   sector:'Energy'},
  {ticker:'SLB',   name:'SLB (Schlumberger)',                    exchange:'NYSE',   sector:'Energy'},
  {ticker:'EOG',   name:'EOG Resources Inc.',                    exchange:'NYSE',   sector:'Energy'},
  {ticker:'MPC',   name:'Marathon Petroleum Corporation',        exchange:'NYSE',   sector:'Energy'},
  {ticker:'VLO',   name:'Valero Energy Corporation',             exchange:'NYSE',   sector:'Energy'},
  {ticker:'OXY',   name:'Occidental Petroleum Corporation',      exchange:'NYSE',   sector:'Energy'},
  {ticker:'HAL',   name:'Halliburton Company',                   exchange:'NYSE',   sector:'Energy'},
  {ticker:'DVN',   name:'Devon Energy Corporation',              exchange:'NYSE',   sector:'Energy'},
  // Consumer Defensive
  {ticker:'WMT',   name:'Walmart Inc.',                          exchange:'NYSE',   sector:'Consumer Defensive'},
  {ticker:'COST',  name:'Costco Wholesale Corporation',          exchange:'NASDAQ', sector:'Consumer Defensive'},
  {ticker:'TGT',   name:'Target Corporation',                    exchange:'NYSE',   sector:'Consumer Defensive'},
  {ticker:'KO',    name:'The Coca-Cola Company',                 exchange:'NYSE',   sector:'Consumer Defensive'},
  {ticker:'PEP',   name:'PepsiCo Inc.',                          exchange:'NASDAQ', sector:'Consumer Defensive'},
  {ticker:'PG',    name:'Procter & Gamble Company',              exchange:'NYSE',   sector:'Consumer Defensive'},
  {ticker:'PM',    name:'Philip Morris International Inc.',      exchange:'NYSE',   sector:'Consumer Defensive'},
  {ticker:'MO',    name:'Altria Group Inc.',                     exchange:'NYSE',   sector:'Consumer Defensive'},
  {ticker:'CL',    name:'Colgate-Palmolive Company',             exchange:'NYSE',   sector:'Consumer Defensive'},
  {ticker:'DG',    name:'Dollar General Corporation',            exchange:'NYSE',   sector:'Consumer Defensive'},
  // Consumer Cyclical
  {ticker:'HD',    name:'The Home Depot Inc.',                   exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'MCD',   name:"McDonald's Corporation",                exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'SBUX',  name:'Starbucks Corporation',                 exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'NKE',   name:'Nike Inc.',                             exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'LOW',   name:"Lowe's Companies Inc.",                 exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'TJX',   name:'TJX Companies Inc.',                    exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'ROST',  name:'Ross Stores Inc.',                      exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'ABNB',  name:'Airbnb Inc.',                           exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'DASH',  name:'DoorDash Inc.',                         exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'ETSY',  name:'Etsy Inc.',                             exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'BKNG',  name:'Booking Holdings Inc.',                 exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'EXPE',  name:'Expedia Group Inc.',                    exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'CMG',   name:'Chipotle Mexican Grill Inc.',           exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'GM',    name:'General Motors Company',                exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'F',     name:'Ford Motor Company',                    exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'RIVN',  name:'Rivian Automotive Inc.',                exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'LCID',  name:'Lucid Group Inc.',                      exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'RACE',  name:'Ferrari N.V.',                          exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'MAR',   name:'Marriott International Inc.',           exchange:'NASDAQ', sector:'Consumer Cyclical'},
  {ticker:'HLT',   name:'Hilton Worldwide Holdings Inc.',        exchange:'NYSE',   sector:'Consumer Cyclical'},
  // Communication Services
  {ticker:'DIS',   name:'The Walt Disney Company',               exchange:'NYSE',   sector:'Communication Services'},
  {ticker:'CMCSA', name:'Comcast Corporation',                   exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'T',     name:'AT&T Inc.',                             exchange:'NYSE',   sector:'Communication Services'},
  {ticker:'VZ',    name:'Verizon Communications Inc.',           exchange:'NYSE',   sector:'Communication Services'},
  {ticker:'TMUS',  name:'T-Mobile US Inc.',                      exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'CHTR',  name:'Charter Communications Inc.',           exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'SNAP',  name:'Snap Inc.',                             exchange:'NYSE',   sector:'Communication Services'},
  {ticker:'PINS',  name:'Pinterest Inc.',                        exchange:'NYSE',   sector:'Communication Services'},
  {ticker:'ROKU',  name:'Roku Inc.',                             exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'WBD',   name:'Warner Bros. Discovery Inc.',           exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'PARA',  name:'Paramount Global',                      exchange:'NASDAQ', sector:'Communication Services'},
  // Industrials
  {ticker:'BA',    name:'The Boeing Company',                    exchange:'NYSE',   sector:'Industrials'},
  {ticker:'CAT',   name:'Caterpillar Inc.',                      exchange:'NYSE',   sector:'Industrials'},
  {ticker:'GE',    name:'GE Aerospace',                          exchange:'NYSE',   sector:'Industrials'},
  {ticker:'HON',   name:'Honeywell International Inc.',          exchange:'NASDAQ', sector:'Industrials'},
  {ticker:'MMM',   name:'3M Company',                            exchange:'NYSE',   sector:'Industrials'},
  {ticker:'LMT',   name:'Lockheed Martin Corporation',           exchange:'NYSE',   sector:'Industrials'},
  {ticker:'RTX',   name:'RTX Corporation',                       exchange:'NYSE',   sector:'Industrials'},
  {ticker:'NOC',   name:'Northrop Grumman Corporation',          exchange:'NYSE',   sector:'Industrials'},
  {ticker:'DE',    name:'Deere & Company',                       exchange:'NYSE',   sector:'Industrials'},
  {ticker:'UPS',   name:'United Parcel Service Inc.',            exchange:'NYSE',   sector:'Industrials'},
  {ticker:'FDX',   name:'FedEx Corporation',                     exchange:'NYSE',   sector:'Industrials'},
  {ticker:'DAL',   name:'Delta Air Lines Inc.',                   exchange:'NYSE',   sector:'Industrials'},
  {ticker:'UAL',   name:'United Airlines Holdings Inc.',         exchange:'NASDAQ', sector:'Industrials'},
  {ticker:'AAL',   name:'American Airlines Group Inc.',          exchange:'NASDAQ', sector:'Industrials'},
  {ticker:'LUV',   name:'Southwest Airlines Co.',                exchange:'NYSE',   sector:'Industrials'},
  // Real Estate
  {ticker:'AMT',   name:'American Tower Corporation',            exchange:'NYSE',   sector:'Real Estate'},
  {ticker:'PLD',   name:'Prologis Inc.',                         exchange:'NYSE',   sector:'Real Estate'},
  {ticker:'CCI',   name:'Crown Castle Inc.',                     exchange:'NYSE',   sector:'Real Estate'},
  {ticker:'EQIX',  name:'Equinix Inc.',                          exchange:'NASDAQ', sector:'Real Estate'},
  {ticker:'PSA',   name:'Public Storage',                        exchange:'NYSE',   sector:'Real Estate'},
  {ticker:'SPG',   name:'Simon Property Group Inc.',             exchange:'NYSE',   sector:'Real Estate'},
  {ticker:'O',     name:'Realty Income Corporation',             exchange:'NYSE',   sector:'Real Estate'},
  // Basic Materials
  {ticker:'LIN',   name:'Linde plc',                             exchange:'NASDAQ', sector:'Basic Materials'},
  {ticker:'NEM',   name:'Newmont Corporation',                   exchange:'NYSE',   sector:'Basic Materials'},
  {ticker:'FCX',   name:'Freeport-McMoRan Inc.',                 exchange:'NYSE',   sector:'Basic Materials'},
  {ticker:'NUE',   name:'Nucor Corporation',                     exchange:'NYSE',   sector:'Basic Materials'},
  {ticker:'X',     name:'United States Steel Corporation',       exchange:'NYSE',   sector:'Basic Materials'},
  // Utilities
  {ticker:'NEE',   name:'NextEra Energy Inc.',                   exchange:'NYSE',   sector:'Utilities'},
  {ticker:'DUK',   name:'Duke Energy Corporation',               exchange:'NYSE',   sector:'Utilities'},
  {ticker:'SO',    name:'The Southern Company',                  exchange:'NYSE',   sector:'Utilities'},
  {ticker:'AEP',   name:'American Electric Power Co.',           exchange:'NASDAQ', sector:'Utilities'},
  {ticker:'EXC',   name:'Exelon Corporation',                    exchange:'NASDAQ', sector:'Utilities'},
  // ETFs
  {ticker:'SPY',   name:'SPDR S&P 500 ETF Trust',                exchange:'NYSE',   sector:'ETF'},
  {ticker:'QQQ',   name:'Invesco QQQ Trust',                     exchange:'NASDAQ', sector:'ETF'},
  {ticker:'IWM',   name:'iShares Russell 2000 ETF',              exchange:'NYSE',   sector:'ETF'},
  {ticker:'DIA',   name:'SPDR Dow Jones Industrial Avg ETF',     exchange:'NYSE',   sector:'ETF'},
  {ticker:'GLD',   name:'SPDR Gold Shares',                      exchange:'NYSE',   sector:'ETF'},
  {ticker:'TLT',   name:'iShares 20+ Year Treasury Bond ETF',   exchange:'NASDAQ', sector:'ETF'},
  {ticker:'VTI',   name:'Vanguard Total Stock Market ETF',       exchange:'NYSE',   sector:'ETF'},
  {ticker:'VOO',   name:'Vanguard S&P 500 ETF',                  exchange:'NYSE',   sector:'ETF'},
  {ticker:'ARKK',  name:'ARK Innovation ETF',                    exchange:'NYSE',   sector:'ETF'},
  {ticker:'XLF',   name:'Financial Select Sector SPDR Fund',     exchange:'NYSE',   sector:'ETF'},
  {ticker:'XLK',   name:'Technology Select Sector SPDR Fund',    exchange:'NYSE',   sector:'ETF'},
  {ticker:'XLE',   name:'Energy Select Sector SPDR Fund',        exchange:'NYSE',   sector:'ETF'},
  // International
  {ticker:'BABA',  name:'Alibaba Group Holding Ltd.',             exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'SE',    name:'Sea Limited',                            exchange:'NYSE',   sector:'Technology'},
  {ticker:'SONY',  name:'Sony Group Corporation',                exchange:'NYSE',   sector:'Technology'},
  {ticker:'TM',    name:'Toyota Motor Corporation',              exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'HMC',   name:'Honda Motor Co. Ltd.',                  exchange:'NYSE',   sector:'Consumer Cyclical'},
  {ticker:'NIO',   name:'NIO Inc.',                              exchange:'NYSE',   sector:'Consumer Cyclical'},
  // Gaming / Media
  {ticker:'TTWO',  name:'Take-Two Interactive Software Inc.',    exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'EA',    name:'Electronic Arts Inc.',                  exchange:'NASDAQ', sector:'Communication Services'},
  {ticker:'U',     name:'Unity Software Inc.',                   exchange:'NYSE',   sector:'Technology'},
]

/* ─── Market Indices ───────────────────────────────────────── */
export const INDICES = [
  { name:'S&P 500',    ticker:'SPX', value:5832.45, change:-0.23, sparkData: genSparkline(5870,18,-0.5,101) },
  { name:'Nasdaq 100', ticker:'NDX', value:20847.31,change:-0.58, sparkData: genSparkline(21050,80,-2.0,102) },
  { name:'Dow Jones',  ticker:'DJI', value:42891.75,change: 0.28, sparkData: genSparkline(42760,90,1.2,103) },
  { name:'Russell 2000',ticker:'RUT',value:2154.88, change:-0.19, sparkData: genSparkline(2170,8,-0.3,104) },
]

/* ─── Top Movers ───────────────────────────────────────────── */
export const GAINERS = [
  { ticker:'MARA',  name:'Marathon Digital Holdings', price:32.15,  change:18.42 },
  { ticker:'RIOT',  name:'Riot Platforms Inc.',        price:14.88,  change:12.74 },
  { ticker:'COIN',  name:'Coinbase Global Inc.',       price:287.45, change: 9.83 },
  { ticker:'NVDA',  name:'NVIDIA Corporation',         price:137.61, change: 4.90 },
  { ticker:'PLTR',  name:'Palantir Technologies',      price:89.12,  change: 3.67 },
  { ticker:'SQ',    name:'Block Inc.',                 price:72.38,  change: 3.95 },
  { ticker:'AMD',   name:'Advanced Micro Devices',     price:152.43, change: 3.41 },
  { ticker:'NET',   name:'Cloudflare Inc.',            price:118.74, change: 3.12 },
]

export const LOSERS = [
  { ticker:'PARA',  name:'Paramount Global',          price:  8.23, change:-15.32 },
  { ticker:'WBD',   name:'Warner Bros. Discovery',    price:  6.89, change:-12.44 },
  { ticker:'PFE',   name:'Pfizer Inc.',               price: 21.34, change: -8.76 },
  { ticker:'INTC',  name:'Intel Corporation',         price: 18.92, change: -7.83 },
  { ticker:'META',  name:'Meta Platforms Inc.',       price:599.88, change: -3.01 },
  { ticker:'BAC',   name:'Bank of America Corp.',     price: 38.74, change: -2.89 },
  { ticker:'T',     name:'AT&T Inc.',                 price: 21.83, change: -2.54 },
  { ticker:'VZ',    name:'Verizon Communications',    price: 38.12, change: -2.18 },
]

/* ─── News & IPOs ──────────────────────────────────────────── */
export const NEWS = [
  { id:1, time:'14m', headline:'Fed Signals Patience on Rate Cuts as Inflation Holds Above 2.8% Target', source:'Reuters', category:'Economy' },
  { id:2, time:'42m', headline:'NVIDIA Hits Record Revenue for Third Straight Quarter on AI Chip Demand', source:'Bloomberg', category:'Technology' },
  { id:3, time:'1h',  headline:'S&P 500 Edges Lower as Treasury Yields Climb Ahead of Friday Jobs Report', source:'CNBC', category:'Markets' },
  { id:4, time:'2h',  headline:'Apple Announces $110B Stock Buyback, Raises Dividend by 5%', source:'MarketWatch', category:'Technology' },
  { id:5, time:'3h',  headline:'Oil Slides on Reports of OPEC+ Planning Output Increase for Q3 2026', source:'Reuters', category:'Commodities' },
  { id:6, time:'4h',  headline:'Tesla Q2 Deliveries Beat Estimates by 12% as Cybertruck Ramps in Europe', source:'FT', category:'Autos' },
  { id:7, time:'5h',  headline:"Microsoft's Azure Accelerates to 38% Growth as AI Co-Pilot Adoption Soars", source:'Bloomberg', category:'Technology' },
  { id:8, time:'6h',  headline:'Bitcoin Tops $108,000 as Institutional Demand Continues to Outpace Supply', source:'CoinDesk', category:'Crypto' },
]

export const RECENT_IPOS = [
  { date:'May 22', ticker:'STRV', name:'Strova Health Inc.',      price:18.00, change: 24.5 },
  { date:'May 21', ticker:'FLUX', name:'FluxChain Systems',       price:12.50, change: -8.2 },
  { date:'May 20', ticker:'NOVA', name:'NovaSpace Technologies',  price:25.00, change: 31.2 },
  { date:'May 19', ticker:'APEX', name:'Apex Biomedical Corp.',   price:15.00, change: 12.7 },
  { date:'May 16', ticker:'QBIT', name:'Quantum Bit Computing',   price:30.00, change:-15.3 },
  { date:'May 15', ticker:'VELO', name:'Velotrack Logistics',     price: 8.50, change:  5.9 },
  { date:'May 14', ticker:'PRISM',name:'Prism AI Solutions',      price:22.00, change: 42.3 },
]

export const TRENDING_TICKERS = ['NVDA', 'AAPL', 'TSLA', 'META', 'AMD', 'MSFT', 'COIN']

/* ─── Dynamic Stock Generation ─────────────────────────────── */
function tickerSeed(ticker) {
  return ticker.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+1)*31, 0)
}

function getOrGenerate(ticker) {
  if (BUILT[ticker]) return BUILT[ticker]
  const company = COMPANIES.find(c => c.ticker === ticker)
  const seed = tickerSeed(ticker)
  const r = seeded(seed)
  const ranges = [[8,40],[30,120],[80,300],[150,600],[400,1200]]
  const [rmin,rmax] = ranges[seed % ranges.length]
  const prevClose = parseFloat((rmin + r()*(rmax-rmin)).toFixed(2))
  const vol = prevClose * 0.004
  const isPos = r() > 0.45
  const drift = isPos ? vol*0.08 : -vol*0.09
  const seed2 = seed+1, seed3 = seed+2
  return {
    name: company?.name ?? ticker,
    ticker,
    exchange: company?.exchange ?? 'NASDAQ',
    currency: 'USD',
    previousClose: prevClose,
    marketCap: formatCap(prevClose * (5e6 + r()*5e9)),
    sector: company?.sector ?? 'Technology',
    periods: {
      '1D':  gen1D(prevClose*(0.99+seeded(seed2)()*0.02), vol, drift, seed),
      '5D':  genDays(prevClose*0.97, 5, vol*2, drift*0.5, seed2, 5),
      '1M':  genDays(prevClose*0.91, 22, vol*1.5, drift*0.3, seed3, 22),
      'YTD': genDays(prevClose*0.78, 103, vol*1.2, drift*0.2, seed+4, 103),
      '3M':  genDays(prevClose*0.88, 66, vol*1.3, drift*0.25, seed+5, 66),
      '6M':  genDays(prevClose*0.82, 132, vol*1.1, drift*0.2, seed+6, 132),
      '1Y':  genDays(prevClose*0.70, 252, vol, drift*0.15, seed+7, 252),
      '5Y':  genMonths(prevClose*0.42, 60, vol*5, drift*1.5, seed+8, 60),
      'Max': genMonths(prevClose*0.12, 120, vol*8, drift*2, seed+9, 120),
    }
  }
}

/* ─── Public API ───────────────────────────────────────────── */
export function getStock(ticker) {
  const base = getOrGenerate(ticker)
  const d1 = base.periods['1D']
  const currentPrice = d1[d1.length-1].price
  const change = parseFloat((currentPrice - base.previousClose).toFixed(2))
  const changePct = parseFloat(((change/base.previousClose)*100).toFixed(2))
  return { ...base, currentPrice, isPositiveToday: currentPrice >= base.previousClose, change, changePct }
}

export function getPeriodData(ticker, period) {
  return getOrGenerate(ticker).periods[period] ?? []
}

export const TICKERS = Object.keys(BUILT)
export const PERIODS = ['1D','5D','1M','YTD','3M','6M','1Y','5Y','Max']

/* ─── Key Stats ────────────────────────────────────────────── */
function parseCap(s) {
  if (!s) return 0
  if (s.endsWith('T')) return parseFloat(s) * 1e12
  if (s.endsWith('B')) return parseFloat(s) * 1e9
  return parseFloat(s) * 1e6
}

export function getKeyStats(ticker) {
  const base = getOrGenerate(ticker)
  const d1prices = base.periods['1D'].map(d => d.price)
  const d1Yprices = base.periods['1Y'].map(d => d.price)
  const currentPrice = d1prices[d1prices.length - 1]

  const seed = ticker.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+1)*31, 0) + 9999
  const r = seeded(seed)

  const pe           = parseFloat((12 + r() * 38).toFixed(1))
  const ps           = parseFloat((1  + r() * 14).toFixed(1))
  const eps          = parseFloat((currentPrice / pe).toFixed(2))
  const divYield     = parseFloat((r() * 3.8).toFixed(2))
  const beta         = parseFloat((0.35 + r() * 1.9).toFixed(2))
  const roe          = parseFloat((5  + r() * 50).toFixed(1))
  const profitMargin = parseFloat((1  + r() * 30).toFixed(1))
  const revGrowth    = parseFloat((-5 + r() * 42).toFixed(1))
  const volMil       = parseFloat((0.3 + r() * 25).toFixed(1))
  const avgVolMil    = parseFloat((volMil * (0.7 + r() * 0.9)).toFixed(1))

  const dayLow  = parseFloat(Math.min(...d1prices).toFixed(2))
  const dayHigh = parseFloat(Math.max(...d1prices).toFixed(2))
  const w52Low  = parseFloat(Math.min(...d1Yprices).toFixed(2))
  const w52High = parseFloat(Math.max(...d1Yprices).toFixed(2))

  const mcNum  = parseCap(base.marketCap)
  const shares = formatCap(mcNum > 0 ? mcNum / currentPrice : r() * 5e9 + 1e8)

  return {
    prevClose: base.previousClose,
    currentPrice,
    dayLow, dayHigh,
    w52Low, w52High,
    bid: parseFloat((currentPrice - 0.01).toFixed(2)),
    ask: parseFloat((currentPrice + 0.01).toFixed(2)),
    volume: `${volMil}M`,
    avgVolume: `${avgVolMil}M`,
    marketCap: base.marketCap,
    shares,
    pe, ps, eps, divYield, beta, roe, profitMargin, revGrowth,
  }
}

/* ─── Snowflake Data ───────────────────────────────────────── */
const SF_DESCRIPTIONS = {
  AAPL: 'Designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.',
  TSLA: 'Designs, develops, manufactures, leases, and sells electric vehicles, energy generation and storage systems globally.',
  NVDA: 'Provides graphics, compute and networking solutions serving gaming, data center, and professional visualization markets.',
  META: 'Develops social media applications and metaverse technologies. Products include Facebook, Instagram, WhatsApp, and Threads.',
}

const REWARDS_POOL = [
  'Trading at a significant discount to estimated fair value',
  'P/E ratio is below the industry average',
  'Earnings are forecast to grow each year for the next 3 years',
  'Strong cash position relative to total debt',
  'Revenue has grown consistently over the past 3 years',
  'Return on equity is above the industry average',
  'Profit margins have expanded significantly year-over-year',
  'Earnings grew strongly over the past year',
  'Insider ownership is high, aligning management with shareholders',
  'Free cash flow yield is above the sector median',
]

const RISKS_POOL = [
  'Significant insider selling over the past 3 months',
  'Dividend yield is low compared to the top 25% of dividend payers',
  'High price-to-earnings ratio relative to near-term earnings growth',
  'Revenue growth has slowed compared to prior years',
  'Debt-to-equity ratio is above the industry average',
  'Earnings have been volatile over the past few years',
  'Share count has increased over the past year, diluting shareholders',
]

export function getSnowflakeData(ticker) {
  const base = getOrGenerate(ticker)
  const seed = ticker.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+3)*47, 0) + 7777
  const r = seeded(seed)

  const scores = [
    Math.round(1 + r() * 4),
    Math.round(1 + r() * 4),
    Math.round(1 + r() * 4),
    Math.round(1 + r() * 4),
    Math.round(r() * 3),
  ]

  const description = SF_DESCRIPTIONS[ticker] ??
    `Operates in the ${base.sector || 'financial services'} sector, providing a range of products and services to institutional and retail customers worldwide.`

  const rewardIdxs = []
  for (let att = 0; rewardIdxs.length < 3 && att < 30; att++) {
    const idx = Math.floor(r() * REWARDS_POOL.length)
    if (!rewardIdxs.includes(idx)) rewardIdxs.push(idx)
  }

  const riskIdxs = []
  for (let att = 0; riskIdxs.length < 2 && att < 30; att++) {
    const idx = Math.floor(r() * RISKS_POOL.length)
    if (!riskIdxs.includes(idx)) riskIdxs.push(idx)
  }

  const total = scores.reduce((a, b) => a + b, 0)
  const snowflakeDesc = total >= 18 ? 'Outstanding track record with excellent balance sheet.'
    : total >= 14 ? 'Good fundamentals with solid growth prospects.'
    : total >= 10 ? 'Mixed fundamentals with some areas of concern.'
    : 'Weak overall profile with significant risks to consider.'

  return {
    scores,
    description,
    rewards: rewardIdxs.map(i => REWARDS_POOL[i]),
    risks: riskIdxs.map(i => RISKS_POOL[i]),
    snowflakeDesc,
    name: base.name,
  }
}

/* ─── About / Company Profile ─────────────────────────────── */
const COMPANY_PROFILES = {
  AAPL: {
    founded: 1976, employees: '166,000', ceo: 'Tim Cook', website: 'www.apple.com',
    description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide. The company offers iPhone, a line of smartphones; Mac, a line of personal computers; iPad, a line of multi-purpose tablets; and wearables, home, and accessories comprising AirPods, Apple TV, Apple Watch, Beats products, and HomePod. It also provides AppleCare support and cloud services, and operates various platforms including the App Store. The company also offers Apple Arcade, Apple Fitness+, Apple Music, Apple News+, Apple TV+, Apple Card, and Apple Pay, as well as licenses its intellectual property globally.',
  },
  TSLA: {
    founded: 2003, employees: '140,473', ceo: 'Elon Musk', website: 'www.tesla.com',
    description: 'Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, energy generation and storage systems, and related services. It produces and sells Model 3, Model Y, Model S, Model X, Cybertruck, and Tesla Semi. The company also sells solar panels and solar roofs, stationary energy storage products including Powerwall and Megapack, and operates Tesla Supercharger networks globally. Tesla continues to invest heavily in autonomous driving technology and artificial intelligence through its Full Self-Driving software platform.',
  },
  NVDA: {
    founded: 1993, employees: '36,000', ceo: 'Jensen Huang', website: 'www.nvidia.com',
    description: 'NVIDIA Corporation provides graphics, compute and networking solutions worldwide. The company\'s platforms address markets including gaming, professional visualization, data center, and automotive. Its GeForce GPUs power gaming and creative applications, while its data center products — including the H100 and Blackwell GPU architectures — are the backbone of modern AI training and inference workloads. NVIDIA also develops the CUDA software platform, NVIDIA AI Enterprise, and the Omniverse platform for 3D simulation and collaboration.',
  },
  META: {
    founded: 2004, employees: '86,482', ceo: 'Mark Zuckerberg', website: 'www.meta.com',
    description: 'Meta Platforms, Inc. develops products enabling people to connect and share worldwide. The Family of Apps segment includes Facebook, Instagram, Messenger, WhatsApp, and Threads, which together reach over 3.2 billion daily active users. The Reality Labs segment develops augmented and virtual reality hardware, software, and content, including the Quest headset lineup and Ray-Ban smart glasses. The company is investing heavily in AI across all its products and infrastructure, as well as building out its next-generation computing platform.',
  },
}

const ABOUT_CEOS = ['James Mitchell', 'Sarah Chen', 'Michael Torres', 'Emily Johnson', 'David Kim', 'Rachel Adams', 'Chris Wang', 'Laura Martinez']

export function getAboutData(ticker) {
  if (COMPANY_PROFILES[ticker]) return { ...COMPANY_PROFILES[ticker] }

  const base = getOrGenerate(ticker)
  const seed = ticker.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+7)*53, 0) + 3333
  const r    = seeded(seed)

  const founded   = 1950 + Math.floor(r() * 68)
  const empNum    = Math.floor(r() * 120000) + 500
  const employees = empNum.toLocaleString('en-US')
  const ceo       = ABOUT_CEOS[Math.floor(r() * ABOUT_CEOS.length)]
  const domain    = ticker.toLowerCase().replace(/[^a-z]/g, '')
  const website   = `www.${domain}.com`
  const description = `${base.name} operates in the ${base.sector || 'technology'} sector, delivering innovative products and services to customers globally. The company has built a strong market position through disciplined capital allocation, a focus on operational efficiency, and continuous investment in research and development. Its diversified business model provides resilience across economic cycles while generating consistent free cash flow. Management has articulated a clear long-term strategy centred on expanding addressable markets, deepening customer relationships, and leveraging technology to drive sustainable growth and shareholder value creation.`

  return { founded, employees, ceo, website, description }
}

/* ─── Fundamentals ─────────────────────────────────────────── */
function fmtFin(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}t`
  if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}b`
  return `$${(n/1e6).toFixed(1)}m`
}
function fmtFinLabel(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`
  return `$${(n/1e6).toFixed(0)}M`
}

export function getFundamentals(ticker) {
  const base  = getOrGenerate(ticker)
  const stats = getKeyStats(ticker)
  const mcNum = parseCap(base.marketCap) || 1e11

  const seed = ticker.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+11)*61, 0) + 5555
  const r    = seeded(seed)

  // Derive from market metrics
  const revenue      = mcNum / Math.max(stats.ps,  0.5)
  const earnings     = mcNum / Math.max(stats.pe,  5)
  const grossMargin  = 0.28 + r() * 0.44
  const grossProfit  = revenue * grossMargin
  const costOfRev    = revenue - grossProfit
  const otherExp     = Math.max(0, grossProfit - earnings)
  const debtEquity   = parseFloat((20 + r() * 130).toFixed(1))
  const payoutRatio  = stats.divYield > 0 ? Math.round(stats.divYield * stats.pe * 1.4) : 0

  // Earnings dates
  const base2mo = new Date('2026-03-27')
  const lastEarnings = base2mo.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })

  return {
    ticker, name: base.name,
    marketCapFmt: `US$${base.marketCap}`.toLowerCase(),
    mcNum,
    revenue, earnings, grossProfit, costOfRev, otherExp,
    revenueFmt:   fmtFin(revenue),
    earningsFmt:  fmtFin(earnings),
    pe:           stats.pe,
    ps:           stats.ps,
    epsFmt:       stats.eps.toFixed(2),
    grossMarginPct: (grossMargin * 100).toFixed(2),
    netMarginPct:   ((earnings / revenue) * 100).toFixed(2),
    debtEquityPct:  debtEquity,
    divYield:       stats.divYield,
    payoutRatio,
    lastEarnings,
    nextEarnings: 'n/a',
    // waterfall bar labels
    bars: [
      { label: 'Revenue',        value: revenue,    color: '#3b82f6'  },
      { label: 'Cost of Rev.',   value: costOfRev,  color: '#991b1b'  },
      { label: 'Gross Profit',   value: grossProfit, color: '#16a34a' },
      { label: 'Other Exp.',     value: otherExp,   color: '#991b1b'  },
      { label: 'Earnings',       value: earnings,   color: '#0891b2'  },
    ],
  }
}

/* ─── Competitors ──────────────────────────────────────────── */
const COMPETITORS_MAP = {
  AAPL: ['MSFT', 'GOOGL', 'AMZN', 'ADBE'],
  TSLA: ['UBER',  'AMZN',  'SHOP',  'SQ'  ],
  NVDA: ['AMD',   'INTC',  'QCOM',  'AVGO'],
  META: ['GOOGL', 'NFLX',  'SPOT',  'RBLX'],
}

export function getCompetitors(ticker) {
  const base = getOrGenerate(ticker)
  const tickers = COMPETITORS_MAP[ticker] ??
    COMPANIES.filter(c => c.sector === base.sector && c.ticker !== ticker)
             .slice(0, 4).map(c => c.ticker)

  return tickers.slice(0, 4).map(t => {
    const info = COMPANIES.find(c => c.ticker === t)
    const cb   = getOrGenerate(t)
    const sf   = getSnowflakeData(t)
    return {
      ticker:    t,
      name:      info?.name ?? cb.name ?? t,
      exchange:  info?.exchange ?? cb.exchange ?? 'NASDAQ',
      marketCap: cb.marketCap,
      scores:    sf.scores,
    }
  })
}

/* ─── Valuation ────────────────────────────────────────────── */
export function getValuation(ticker) {
  const base  = getOrGenerate(ticker)
  const stats = getKeyStats(ticker)
  const d1    = base.periods['1D']
  const currentPrice = d1[d1.length - 1].price

  const seed = ticker.split('').reduce((a,c,i) => a + c.charCodeAt(0)*(i+13)*71, 0) + 8888
  const r    = seeded(seed)

  // Analyst consensus — used as the fair value
  const analystMult   = 0.88 + r() * 0.44
  const analystTarget = parseFloat((currentPrice * analystMult).toFixed(2))
  const analystCount  = Math.floor(5 + r() * 30)
  const rRating = r()
  const analystRating = rRating > 0.62 ? 'Buy' : rRating > 0.38 ? 'Hold' : 'Sell'

  const fairValue     = analystTarget
  const fairValueLabel = 'Target Price'
  const isUndervalued = fairValue > currentPrice
  const discountPct   = parseFloat((Math.abs(currentPrice - fairValue) / fairValue * 100).toFixed(1))

  const upside = v => parseFloat(((v - currentPrice) / currentPrice * 100).toFixed(1))

  const analystHigh   = parseFloat((analystTarget * (1.05 + r() * 0.25)).toFixed(2))
  const analystLow    = parseFloat((analystTarget * (0.75 + r() * 0.15)).toFixed(2))
  const analystMedian = parseFloat((analystTarget * (0.98 + r() * 0.04)).toFixed(2))

  // Key valuation metric data
  const mcNum2    = parseCap(base.marketCap) || 1e11
  const earnings2 = mcNum2 / Math.max(stats.pe, 1)
  const revenue2  = mcNum2 / Math.max(stats.ps, 0.5)
  const pb        = parseFloat((1.5 + r() * 7).toFixed(1))
  const bookValue = mcNum2 / pb
  const evEbitda  = parseFloat((8 + r() * 25).toFixed(1))
  const ebitda    = mcNum2 / evEbitda

  return {
    ticker, currentPrice, fairValue, fairValueLabel,
    isUndervalued, discountPct,
    methods: [
      { name: fairValueLabel, value: fairValue, upside: upside(fairValue) },
    ],
    // analyst fields
    analystTarget, analystHigh, analystLow, analystMedian,
    analystCount, analystRating,
    // key metric section
    pe: stats.pe, ps: stats.ps, pb,
    mcNum: mcNum2, earnings: earnings2, revenue: revenue2,
    bookValue, evEbitda, ebitda,
  }
}

/* ─── Peers Comparison ─────────────────────────────────────── */
export function getPeersComparison(ticker) {
  const base      = getOrGenerate(ticker)
  const mainStats = getKeyStats(ticker)

  const mainItem = {
    ticker,
    name: base.name,
    pe: mainStats.pe,
    earningsGrowth: mainStats.revGrowth,
    isMain: true,
  }

  const comps     = getCompetitors(ticker).slice(0, 4)
  const peerItems = comps.map(comp => {
    const s = getKeyStats(comp.ticker)
    return {
      ticker: comp.ticker,
      name:   comp.name,
      pe:     s.pe,
      earningsGrowth: s.revGrowth,
      isMain: false,
    }
  })

  const allItems = [mainItem, ...peerItems].sort((a, b) => b.pe - a.pe)
  const peerAvg  = peerItems.length > 0
    ? parseFloat((peerItems.reduce((s, p) => s + p.pe, 0) / peerItems.length).toFixed(1))
    : mainStats.pe

  return { items: allItems, peerAvg }
}

export function searchCompanies(query) {
  if (!query || query.length < 1) return []
  const q = query.toLowerCase()
  return COMPANIES
    .filter(c => c.ticker.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
    .slice(0, 8)
}
