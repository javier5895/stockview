import math
import re
import threading
import time
import xml.etree.ElementTree as ET

import pandas as pd
import requests as _req
import yfinance as yf
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="StockView API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# All routes live under /api so the same paths work both locally (via Vite
# proxy) and on Vercel (where /api/* is rewritten to this serverless function).
router = APIRouter(prefix="/api")

# ─── IBKR / Reuters (optional, needs Reuters Fundamentals subscription) ────────

try:
    from ib_insync import IB, Stock as IBStock
    _IB_AVAILABLE = True
except ImportError:
    _IB_AVAILABLE = False

_IB_PORTS = [4001, 7496]
_IB_LOCK  = threading.Lock()


def _ibkr_xml(ticker: str, report_type: str):
    if not _IB_AVAILABLE:
        return None
    with _IB_LOCK:
        ib = IB()
        for port in _IB_PORTS:
            try:
                ib.connect("127.0.0.1", port, clientId=12, timeout=5)
                break
            except Exception:
                continue
        else:
            return None
        try:
            contract = IBStock(ticker.upper(), "SMART", "USD")
            ib.qualifyContracts(contract)
            xml = ib.reqFundamentalData(contract, report_type)
            return xml if xml and len(xml) > 200 else None
        except Exception:
            return None
        finally:
            try:
                ib.disconnect()
            except Exception:
                pass


def _rval(values: dict, *codes):
    for c in codes:
        v = values.get(c)
        if v is not None:
            return v
    return None


def _extract_stmt_values(fp_el, stmt_type: str) -> dict:
    stmt = fp_el.find(f"Statement[@Type='{stmt_type}']")
    if stmt is None:
        return {}
    out = {}
    for item in stmt.findall("lineItem"):
        code = item.get("coaCode", "")
        if code and item.text:
            try:
                out[code] = float(item.text.replace(",", ""))
            except (ValueError, AttributeError):
                pass
    return out


def _sorted_fiscal_periods(xml_str: str, period_type: str = "Annual"):
    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError:
        return []
    tag = "AnnualPeriods" if period_type == "Annual" else "InterimPeriods"
    els = root.findall(f".//{tag}/FiscalPeriod")
    els.sort(key=lambda fp: fp.get("EndDate", ""), reverse=True)
    return els


def _parse_reuters_financials(xml_str: str, statement: str, freq: str):
    period_type = "Annual" if freq == "annual" else "Interim"
    fiscal_els  = _sorted_fiscal_periods(xml_str, period_type)[:5]
    if not fiscal_els:
        return None

    stmt_type = {"income": "INC", "balance": "BAL", "cashflow": "CAS"}.get(statement, "INC")

    if freq == "annual":
        period_labels = [fp.get("FiscalYear", fp.get("EndDate", "")[:4]) for fp in fiscal_els]
    else:
        period_labels = []
        for fp in fiscal_els:
            ed = fp.get("EndDate", "")
            try:
                ts = pd.Timestamp(ed)
                q  = (ts.month - 1) // 3 + 1
                period_labels.append(f"Q{q} '{ts.strftime('%y')}")
            except Exception:
                period_labels.append(ed[:7])

    all_vals = [_extract_stmt_values(fp, stmt_type) for fp in fiscal_els]

    if statement == "income":
        def _ebitda(d):
            v = _rval(d, "OEBITDA")
            if v is not None:
                return v
            sopi = _rval(d, "SOPI")
            da   = _rval(d, "SDPR", "SDED")
            return (sopi + da) if (sopi is not None and da is not None) else None

        row_specs = [
            ("Total Revenue",          lambda d: _rval(d, "RTLR"),          False, "currency", True),
            ("Cost of Revenue",        lambda d: _rval(d, "SCOR"),          True,  "currency", False),
            ("Gross Profit",           lambda d: _rval(d, "SGRP"),          False, "currency", True),
            ("Research & Development", lambda d: _rval(d, "ERAD"),          True,  "currency", False),
            ("SG&A",                   lambda d: _rval(d, "SSGA"),          True,  "currency", False),
            ("Operating Income",       lambda d: _rval(d, "SOPI"),          False, "currency", True),
            ("Interest Expense",       lambda d: _rval(d, "SNIN", "ENII"), True,  "currency", False),
            ("Pre-tax Income",         lambda d: _rval(d, "EIBT"),          False, "currency", False),
            ("Income Tax",             lambda d: _rval(d, "TTAX"),          True,  "currency", False),
            ("Net Income",             lambda d: _rval(d, "NINC"),          False, "currency", True),
            ("EBITDA",                 _ebitda,                              False, "currency", False),
            ("EPS (Basic)",            lambda d: _rval(d, "VDES"),          False, "eps",      False),
            ("EPS (Diluted)",          lambda d: _rval(d, "VDIL"),          False, "eps",      False),
        ]
    elif statement == "balance":
        row_specs = [
            ("Cash & Equivalents",        lambda d: _rval(d, "ACAE", "ACSH"),   False, "currency", False),
            ("Short-term Investments",    lambda d: _rval(d, "ASTI"),           True,  "currency", False),
            ("Receivables",               lambda d: _rval(d, "AACR"),           True,  "currency", False),
            ("Inventory",                 lambda d: _rval(d, "AINT"),           True,  "currency", False),
            ("Total Current Assets",      lambda d: _rval(d, "ATCA"),           False, "currency", True),
            ("Net PP&E",                  lambda d: _rval(d, "APTC"),           True,  "currency", False),
            ("Total Assets",              lambda d: _rval(d, "ATOT"),           False, "currency", True),
            ("Total Current Liabilities", lambda d: _rval(d, "LCLD", "LTCL"),  False, "currency", True),
            ("Long-term Debt",            lambda d: _rval(d, "LLTD"),           True,  "currency", False),
            ("Total Liabilities",         lambda d: _rval(d, "LTLL"),           False, "currency", True),
            ("Stockholders' Equity",      lambda d: _rval(d, "QTCO", "QTLE"),  False, "currency", True),
            ("Net Debt",                  lambda d: (
                ((_rval(d, "LLTD") or 0) - (_rval(d, "ACAE", "ACSH") or 0))
                if _rval(d, "LLTD") is not None else None
            ),                                                                   False, "currency", False),
        ]
    else:
        def _fcf(d):
            v = _rval(d, "FCFL")
            if v is not None:
                return v
            otlo = _rval(d, "OTLO")
            scex = _rval(d, "SCEX")
            return (otlo + scex) if (otlo is not None and scex is not None) else None

        row_specs = [
            ("Operating Cash Flow", lambda d: _rval(d, "OTLO"),  False, "currency", True),
            ("Capital Expenditure", lambda d: _rval(d, "SCEX"),  True,  "currency", False),
            ("Free Cash Flow",      _fcf,                         False, "currency", True),
            ("Investing Cash Flow", lambda d: _rval(d, "ITLI"),  False, "currency", False),
            ("Financing Cash Flow", lambda d: _rval(d, "FTLF"),  False, "currency", False),
            ("Net Change in Cash",  lambda d: _rval(d, "SNCC"),  False, "currency", False),
        ]

    rows = []
    for (label, fn, indent, fmt, bold) in row_specs:
        raw_vals  = [fn(d) for d in all_vals]
        formatted = [_fmt_fin(v, fmt) for v in raw_vals]
        rows.append({"label": label, "indent": indent, "bold": bold,
                     "values": formatted, "raw": raw_vals})

    n_rows = len(rows)
    if n_rows:
        good_cols = [
            i for i in range(len(period_labels))
            if sum(1 for r in rows if r["values"][i] != "—") / n_rows >= 0.40
        ]
        if len(good_cols) < len(period_labels):
            period_labels = [period_labels[i] for i in good_cols]
            for r in rows:
                r["values"] = [r["values"][i] for i in good_cols]
                r["raw"]    = [r["raw"][i]    for i in good_cols]

    return {"periods": period_labels, "rows": rows, "source": "ibkr"}


def _ibkr_annual_records(xml_str: str):
    fiscal_els = _sorted_fiscal_periods(xml_str)[:5]
    records = []
    for fp in fiscal_els:
        inc = _extract_stmt_values(fp, "INC")
        bal = _extract_stmt_values(fp, "BAL")

        sopi    = _rval(inc, "SOPI")
        da      = _rval(inc, "SDPR", "SDED")
        ebitda  = _rval(inc, "OEBITDA") or ((sopi + da) if sopi and da else None)
        net_inc = _rval(inc, "NINC")
        eps_d   = _rval(inc, "VDIL")
        eps_b   = _rval(inc, "VDES")

        shares = None
        if net_inc and eps_d and eps_d != 0:
            shares = net_inc / eps_d
        elif net_inc and eps_b and eps_b != 0:
            shares = net_inc / eps_b

        records.append({
            "year":      fp.get("FiscalYear", fp.get("EndDate", "")[:4]),
            "end_date":  fp.get("EndDate", ""),
            "rev":       _rval(inc, "RTLR"),
            "gross":     _rval(inc, "SGRP"),
            "op_inc":    sopi,
            "net_inc":   net_inc,
            "ebitda":    ebitda,
            "eps_b":     eps_b,
            "eps_d":     eps_d,
            "shares":    shares,
            "cur_ast":   _rval(bal, "ATCA"),
            "cur_lib":   _rval(bal, "LCLD", "LTCL"),
            "inventory": _rval(bal, "AINT"),
            "equity":    _rval(bal, "QTCO", "QTLE"),
            "tot_ast":   _rval(bal, "ATOT"),
            "tot_debt":  _rval(bal, "LLTD"),
            "cash":      _rval(bal, "ACAE", "ACSH"),
        })
    return records


# ─── SEC EDGAR ────────────────────────────────────────────────────────────────

_EDGAR_HEADERS = {"User-Agent": "StockViewApp/1.0 (stockview@example.com)"}
_edgar_cik_cache   = {}   # {ticker_upper: "0000320193"}
_edgar_facts_cache = {}   # {cik: (fetched_timestamp, us_gaap_facts_dict)}
_EDGAR_TTL         = 3600 # 1 hour

# Company search list — loaded once from EDGAR's company_tickers.json (~13 K entries)
_edgar_search_list  = []   # [{"ticker": "AAPL", "name": "Apple Inc."}, ...]
_edgar_search_ready = False


def _edgar_load_search_list():
    """
    Download SEC EDGAR's full company ticker list and cache it in memory.
    Also populates _edgar_cik_cache as a side effect so individual lookups
    skip the per-ticker HTTP call.  Called once at startup in a daemon thread.
    """
    global _edgar_search_list, _edgar_search_ready
    if _edgar_search_ready:
        return
    try:
        data = _req.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers=_EDGAR_HEADERS, timeout=15,
        ).json()
        companies = []
        for entry in data.values():
            tk  = entry.get("ticker", "").strip().upper()
            cik = str(entry.get("cik_str", "")).zfill(10)
            if not tk:
                continue
            _edgar_cik_cache[tk] = cik      # reuse for financials lookups
            companies.append({"ticker": tk, "name": entry.get("title", tk)})
        companies.sort(key=lambda c: c["ticker"])
        _edgar_search_list  = companies
        _edgar_search_ready = True
    except Exception:
        pass


@app.on_event("startup")
def _preload_edgar_search():
    """Pre-load EDGAR company list in background so the first search is instant."""
    threading.Thread(target=_edgar_load_search_list, daemon=True).start()

# XBRL concept names per field (first match wins)
_E_INC = {
    "rev":      ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
                 "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
    "cogs":     ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
    "gross":    ["GrossProfit"],
    "rd":       ["ResearchAndDevelopmentExpense"],
    "sga":      ["SellingGeneralAndAdministrativeExpense"],
    "op_inc":   ["OperatingIncomeLoss"],
    "interest": ["InterestExpense", "InterestExpenseNonoperating", "InterestAndDebtExpense"],
    "pretax":   ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                 "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
    "tax":      ["IncomeTaxExpenseBenefit"],
    "net_inc":  ["NetIncomeLoss"],
    "da":       ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "Depreciation"],
    "eps_b":    ["EarningsPerShareBasic"],
    "eps_d":    ["EarningsPerShareDiluted"],
}
_E_BAL = {
    "cash":    ["CashAndCashEquivalentsAtCarryingValue",
                "CashCashEquivalentsAndShortTermInvestments"],
    "recv":    ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
    "inv":     ["InventoryNet", "Inventories"],
    "cur_ast": ["AssetsCurrent"],
    "ppe":     ["PropertyPlantAndEquipmentNet",
                "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"],
    "tot_ast": ["Assets"],
    "cur_lib": ["LiabilitiesCurrent"],
    "lt_debt": ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"],
    "tot_lib": ["Liabilities"],
    "equity":  ["StockholdersEquity", "StockholdersEquityAttributableToParent"],
}
_E_CAS = {
    "op_cf":   ["NetCashProvidedByUsedInOperatingActivities"],
    "capex":   ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForCapitalImprovements"],
    "inv_cf":  ["NetCashProvidedByUsedInInvestingActivities"],
    "fin_cf":  ["NetCashProvidedByUsedInFinancingActivities"],
    "net_chg": ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
                "CashAndCashEquivalentsPeriodIncreaseDecrease"],
}


def _edgar_get_cik(ticker: str):
    """Return zero-padded 10-digit CIK for a ticker, or None."""
    t = ticker.upper()
    if t in _edgar_cik_cache:
        return _edgar_cik_cache[t]
    try:
        data = _req.get("https://www.sec.gov/files/company_tickers.json",
                        headers=_EDGAR_HEADERS, timeout=10).json()
        for entry in data.values():
            tk  = entry.get("ticker", "").upper()
            cik = str(entry.get("cik_str", "")).zfill(10)
            _edgar_cik_cache[tk] = cik
        return _edgar_cik_cache.get(t)
    except Exception:
        return None


def _edgar_get_facts(cik: str):
    """
    Download and cache the full XBRL company facts JSON from SEC EDGAR.
    One call (~2–5 MB) gives all periods for all line items — no further
    requests needed until the 1-hour cache expires.
    Returns the us-gaap facts dict, or None on failure.
    """
    now = time.time()
    if cik in _edgar_facts_cache:
        fetched_at, facts = _edgar_facts_cache[cik]
        if now - fetched_at < _EDGAR_TTL:
            return facts
    try:
        resp  = _req.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
                         headers=_EDGAR_HEADERS, timeout=20).json()
        facts = resp.get("facts", {}).get("us-gaap", {})
        _edgar_facts_cache[cik] = (now, facts)
        return facts
    except Exception:
        return None


def _edgar_concept(facts: dict, *concepts, form_prefix="10-K", fp="FY"):
    """
    Try concept names in order; return {end_date: value} for the first match.

    EDGAR includes both consolidated totals AND segment-level data under the same
    concept name (dimensional context is stripped by the companyfacts API).  To
    always pick the consolidated figure we:
      1. Group by (end_date, filed_date) and keep the MAX value — total > any segment.
      2. Then deduplicate by end_date keeping the most-recently-filed version
         (handles 10-K amendments / restatements).
    """
    for name in concepts:
        if name not in facts:
            continue
        units     = facts[name].get("units", {})
        vals_list = (units.get("USD") or units.get("USD/shares")
                     or units.get("shares") or units.get("pure"))
        if not vals_list:
            continue
        filtered = [v for v in vals_list
                    if v.get("form", "").startswith(form_prefix)
                    and (fp is None or v.get("fp") == fp)]
        if not filtered:
            continue

        # Step 1: per (end, filed) group keep the largest absolute value
        step1 = {}
        for v in filtered:
            end   = v.get("end", "")
            filed = v.get("filed", "")
            val   = v["val"]
            if not end:
                continue
            key = (end, filed)
            if key not in step1 or abs(val) > abs(step1[key][0]):
                step1[key] = (val, filed)

        # Step 2: per end_date keep the most recently filed
        by_end = {}
        for (end, filed), (val, _) in step1.items():
            if end not in by_end or filed > by_end[end][1]:
                by_end[end] = (val, filed)

        if by_end:
            return {end: pair[0] for end, pair in by_end.items()}
    return {}


def _edgar_fy_map(facts: dict, *concepts, form_prefix="10-K", fp="FY"):
    """
    Return {end_date: fiscal_year_int} for the first matching concept.
    Uses the 'fy' field from EDGAR — critical for companies whose fiscal year
    doesn't end in December (e.g. Apple FY ends in September, so Q1 FY2020
    ends 2019-12-28 and its fy=2020, not 2019).
    """
    for name in concepts:
        if name not in facts:
            continue
        units     = facts[name].get("units", {})
        vals_list = (units.get("USD") or units.get("USD/shares")
                     or units.get("shares") or units.get("pure"))
        if not vals_list:
            continue
        filtered = [v for v in vals_list
                    if v.get("form", "").startswith(form_prefix)
                    and (fp is None or v.get("fp") == fp)
                    and v.get("end")]
        if not filtered:
            continue
        by_end = {}
        for v in filtered:
            end   = v.get("end", "")
            filed = v.get("filed", "")
            fy    = v.get("fy") or int(end[:4])
            if end not in by_end or filed > by_end[end][0]:
                by_end[end] = (filed, fy)
        if by_end:
            return {end: data[1] for end, data in by_end.items()}
    return {}


def _closest_val(val_map: dict, target_date: str, max_days: int = 92):
    """Return the value from val_map whose date key is closest to target_date."""
    if not val_map:
        return None
    try:
        target = pd.Timestamp(target_date)
        best   = min(val_map, key=lambda d: abs((pd.Timestamp(d) - target).days))
        if abs((pd.Timestamp(best) - target).days) <= max_days:
            return val_map[best]
    except Exception:
        pass
    return None


def _edgar_annual_records(ticker: str):
    """
    Fetch SEC EDGAR XBRL facts and return standardized annual period records
    (newest-first).  One HTTP fetch gives 10+ years of all statements at once;
    subsequent calls for the same ticker are served from the 1-hour in-memory cache.
    """
    cik = _edgar_get_cik(ticker)
    if not cik:
        return []
    facts = _edgar_get_facts(cik)
    if not facts:
        return []

    def gc(mapping_key, mapping):
        return _edgar_concept(facts, *mapping[mapping_key], form_prefix="10-K", fp="FY")

    # ── Fetch all concept maps ────────────────────────────────────────────────
    rev_m  = gc("rev",     _E_INC);  cgs_m  = gc("cogs",    _E_INC)
    grp_m  = gc("gross",   _E_INC);  rd_m   = gc("rd",      _E_INC)
    sga_m  = gc("sga",     _E_INC);  opi_m  = gc("op_inc",  _E_INC)
    int_m  = gc("interest",_E_INC);  pre_m  = gc("pretax",  _E_INC)
    tax_m  = gc("tax",     _E_INC);  net_m  = gc("net_inc", _E_INC)
    da_m   = gc("da",      _E_INC);  epb_m  = gc("eps_b",   _E_INC)
    epd_m  = gc("eps_d",   _E_INC)

    csh_m  = gc("cash",    _E_BAL);  rcv_m  = gc("recv",    _E_BAL)
    inv_m  = gc("inv",     _E_BAL);  cas_m  = gc("cur_ast", _E_BAL)
    ppe_m  = gc("ppe",     _E_BAL);  ast_m  = gc("tot_ast", _E_BAL)
    cli_m  = gc("cur_lib", _E_BAL);  dbt_m  = gc("lt_debt", _E_BAL)
    lib_m  = gc("tot_lib", _E_BAL);  eqt_m  = gc("equity",  _E_BAL)

    ocf_m  = gc("op_cf",  _E_CAS);   cpx_m  = gc("capex",   _E_CAS)
    icf_m  = gc("inv_cf", _E_CAS);   fcf_m  = gc("fin_cf",  _E_CAS)
    ncc_m  = gc("net_chg",_E_CAS)

    # ── Determine annual periods from revenue anchor ──────────────────────────
    anchor = rev_m or net_m or ast_m
    if not anchor:
        return []

    def _get_val(val_map, target_date):
        """
        Exact date match first; fall back to ±5 days for minor fiscal-year-end
        drift between concepts.  Tight window prevents quarterly entries (which
        are ~90 days away) from matching the wrong annual period.
        """
        if not val_map:
            return None
        if target_date in val_map:
            return val_map[target_date]
        try:
            target = pd.Timestamp(target_date)
            best   = min(val_map, key=lambda d: abs((pd.Timestamp(d) - target).days))
            if abs((pd.Timestamp(best) - target).days) <= 5:
                return val_map[best]
        except Exception:
            pass
        return None

    # Select annual end-dates with two rules:
    #   1. ≥300 days between successive dates — eliminates quarterly comparatives
    #      that appear in 10-K XBRL tagged fp="FY" (e.g. Apple includes Q1-Q3
    #      prior-year quarters, all ~90 days apart, all with fp="FY").
    #   2. Deduplicate by calendar year (int(end[:4])) to handle 10-K/A amendments.
    #
    # We deliberately do NOT use EDGAR's `fy` field for deduplication: for
    # comparative periods included in a later 10-K the `fy` reflects the FILING
    # year rather than the period year, corrupting the label (e.g. FY2023 data
    # in the FY2025 10-K gets fy=2025 → wrongly marked as a duplicate of the
    # real FY2025 annual and skipped).
    all_ends  = sorted(anchor.keys(), reverse=True)
    seen_fys  = set()
    end_dates = []
    prev_ts   = None
    for ed in all_ends:
        try:
            ts = pd.Timestamp(ed)
        except Exception:
            continue
        if prev_ts is not None and (prev_ts - ts).days < 300:
            continue          # quarterly intruder — too close to last accepted date
        fy = int(ed[:4])
        if fy in seen_fys:
            continue          # 10-K/A restatement of an already-accepted year
        seen_fys.add(fy)
        end_dates.append(ed)
        prev_ts = ts
        if len(end_dates) == 10:
            break

    records = []
    for end in end_dates:
        # Use default-argument capture (e=end) to avoid Python closure gotcha
        cv = lambda m, e=end: _get_val(m, e)

        op_inc = cv(opi_m);  da = cv(da_m)
        ebitda = (op_inc + da) if (op_inc is not None and da is not None) else None

        net_inc = cv(net_m);  eps_d = cv(epd_m);  eps_b = cv(epb_m)
        shares  = None
        if net_inc and eps_d and eps_d != 0:
            shares = net_inc / eps_d
        elif net_inc and eps_b and eps_b != 0:
            shares = net_inc / eps_b

        op_cf = cv(ocf_m);  capex = cv(cpx_m)   # capex = positive payment in EDGAR
        fcf   = (op_cf - capex) if (op_cf is not None and capex is not None) else None

        records.append({
            "year":     str(int(end[:4])),  "end_date": end,
            # income
            "rev":      cv(rev_m),  "cogs":     cv(cgs_m),  "gross":    cv(grp_m),
            "rd":       cv(rd_m),   "sga":      cv(sga_m),  "op_inc":   op_inc,
            "interest": cv(int_m),  "pretax":   cv(pre_m),  "tax":      cv(tax_m),
            "net_inc":  net_inc,    "ebitda":   ebitda,
            "eps_b":    eps_b,      "eps_d":    eps_d,       "shares":   shares,
            # balance
            "cash":     cv(csh_m),  "recv":     cv(rcv_m),  "inventory":cv(inv_m),
            "cur_ast":  cv(cas_m),  "ppe":      cv(ppe_m),  "tot_ast":  cv(ast_m),
            "cur_lib":  cv(cli_m),  "tot_debt": cv(dbt_m),  "tot_lib":  cv(lib_m),
            "equity":   cv(eqt_m),
            # cashflow
            "op_cf":    op_cf,      "capex":    capex,       "fcf":      fcf,
            "inv_cf":   cv(icf_m),  "fin_cf":   cv(fcf_m),  "net_chg":  cv(ncc_m),
        })
    return records


def _edgar_build_financials(records: list, statement: str):
    """Convert EDGAR annual records into the {periods, rows, source} table response."""
    if not records:
        return None

    records      = sorted(records, key=lambda r: r["end_date"], reverse=True)
    period_labels = [r["year"] for r in records]

    if statement == "income":
        row_specs = [
            ("Total Revenue",          lambda r: r["rev"],      False, "currency", True),
            ("Cost of Revenue",        lambda r: r["cogs"],     True,  "currency", False),
            ("Gross Profit",           lambda r: r["gross"],    False, "currency", True),
            ("Research & Development", lambda r: r["rd"],       True,  "currency", False),
            ("SG&A",                   lambda r: r["sga"],      True,  "currency", False),
            ("Operating Income",       lambda r: r["op_inc"],   False, "currency", True),
            ("Interest Expense",       lambda r: r["interest"], True,  "currency", False),
            ("Pre-tax Income",         lambda r: r["pretax"],   False, "currency", False),
            ("Income Tax",             lambda r: r["tax"],      True,  "currency", False),
            ("Net Income",             lambda r: r["net_inc"],  False, "currency", True),
            ("EBITDA",                 lambda r: r["ebitda"],   False, "currency", False),
            ("EPS (Basic)",            lambda r: r["eps_b"],    False, "eps",      False),
            ("EPS (Diluted)",          lambda r: r["eps_d"],    False, "eps",      False),
        ]
    elif statement == "balance":
        row_specs = [
            ("Cash & Equivalents",        lambda r: r["cash"],     False, "currency", False),
            ("Receivables",               lambda r: r["recv"],     True,  "currency", False),
            ("Inventory",                 lambda r: r["inventory"],True,  "currency", False),
            ("Total Current Assets",      lambda r: r["cur_ast"],  False, "currency", True),
            ("Net PP&E",                  lambda r: r["ppe"],      True,  "currency", False),
            ("Total Assets",              lambda r: r["tot_ast"],  False, "currency", True),
            ("Total Current Liabilities", lambda r: r["cur_lib"],  False, "currency", True),
            ("Long-term Debt",            lambda r: r["tot_debt"], True,  "currency", False),
            ("Total Liabilities",         lambda r: r["tot_lib"],  False, "currency", True),
            ("Stockholders' Equity",      lambda r: r["equity"],   False, "currency", True),
            ("Net Debt", lambda r: (
                (r["tot_debt"] - r["cash"])
                if r["tot_debt"] is not None and r["cash"] is not None else None
            ),                                                       False, "currency", False),
        ]
    else:  # cashflow — CapEx is stored positive in EDGAR (payment), negate for display
        row_specs = [
            ("Operating Cash Flow", lambda r: r["op_cf"],                                  False, "currency", True),
            ("Capital Expenditure", lambda r: (-r["capex"] if r["capex"] is not None else None), True, "currency", False),
            ("Free Cash Flow",      lambda r: r["fcf"],                                    False, "currency", True),
            ("Investing Cash Flow", lambda r: r["inv_cf"],                                 False, "currency", False),
            ("Financing Cash Flow", lambda r: r["fin_cf"],                                 False, "currency", False),
            ("Net Change in Cash",  lambda r: r["net_chg"],                                False, "currency", False),
        ]

    rows = []
    for (label, fn, indent, fmt, bold) in row_specs:
        raw_vals  = [fn(r) for r in records]
        formatted = [_fmt_fin(v, fmt) for v in raw_vals]
        rows.append({"label": label, "indent": indent, "bold": bold,
                     "values": formatted, "raw": raw_vals})

    # Filter sparse columns
    n_rows = len(rows)
    if n_rows:
        good_cols = [
            i for i in range(len(period_labels))
            if sum(1 for r in rows if r["values"][i] != "—") / n_rows >= 0.40
        ]
        if len(good_cols) < len(period_labels):
            period_labels = [period_labels[i] for i in good_cols]
            for r in rows:
                r["values"] = [r["values"][i] for i in good_cols]
                r["raw"]    = [r["raw"][i]    for i in good_cols]

    return {"periods": period_labels, "rows": rows, "source": "edgar"}


# ─── Shared helpers ───────────────────────────────────────────────────────────

def _yfinance_annual_records(t):
    """Build standardized annual records from a yfinance Ticker."""
    inc = t.financials
    bal = t.balance_sheet
    if inc is None or inc.empty:
        return []

    inc_cols = list(inc.columns)
    bal_cols = list(bal.columns) if bal is not None and not bal.empty else []

    def _safe(df, key, col):
        try:
            v = df.loc[key, col]
            return float(v) if not math.isnan(float(v)) else None
        except Exception:
            return None

    def _closest_bal(inc_col):
        if not bal_cols:
            return None
        return min(bal_cols, key=lambda c: abs((c - inc_col).days))

    curated = [k for k, *_ in _INCOME_ROWS]
    good_cols = [
        c for c in inc_cols
        if sum(1 for k in curated if k in inc.index and _safe(inc, k, c) is not None)
           / len(curated) >= 0.40
    ]

    records = []
    for col in good_cols:
        bc      = _closest_bal(col)
        net_inc = _safe(inc, "Net Income", col)
        eps_d   = _safe(inc, "Diluted EPS", col)
        eps_b   = _safe(inc, "Basic EPS", col)
        dil_shr = _safe(inc, "Diluted Average Shares", col)

        shares = dil_shr
        if not shares and net_inc and eps_d and eps_d != 0:
            shares = net_inc / eps_d

        records.append({
            "year":     col.strftime("%Y") if hasattr(col, "strftime") else str(col)[:4],
            "end_date": col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)[:10],
            "rev":      _safe(inc, "Total Revenue",   col),
            "gross":    _safe(inc, "Gross Profit",     col),
            "op_inc":   _safe(inc, "Operating Income", col),
            "net_inc":  net_inc,
            "ebitda":   _safe(inc, "EBITDA",           col),
            "eps_b":    eps_b,
            "eps_d":    eps_d,
            "shares":   shares,
            "cur_ast":  _safe(bal, "Current Assets",    bc) if bc else None,
            "cur_lib":  _safe(bal, "Current Liabilities", bc) if bc else None,
            "inventory":_safe(bal, "Inventory",         bc) if bc else None,
            "equity":   _safe(bal, "Common Stock Equity", bc) if bc else None,
            "tot_ast":  _safe(bal, "Total Assets",      bc) if bc else None,
            "tot_debt": _safe(bal, "Total Debt",        bc) if bc else None,
            "cash":     _safe(bal, "Cash And Cash Equivalents", bc) if bc else None,
        })
    return records


def _compute_ratios(periods, records, prices):
    """Compute all ratio sections from standardized records + year-end prices."""
    def _fx(v, decimals=1, suffix="x"):
        return f"{v:.{decimals}f}{suffix}" if v is not None else "—"
    def _fp(v, decimals=1):
        return f"{v*100:.{decimals}f}%" if v is not None else "—"
    def _fd(v, decimals=2):
        return f"${v:.{decimals}f}" if v is not None else "—"
    def _div(a, b):
        return (a / b) if a is not None and b and b != 0 else None

    val_r = {"P/E Ratio": [], "P/B Ratio": [], "EV/EBITDA": [], "EV/Revenue": [], "Price/Sales": []}
    pro_r = {"Gross Margin": [], "Operating Margin": [], "Net Margin": [],
              "Return on Equity": [], "Return on Assets": []}
    ps_r  = {"EPS (Basic)": [], "EPS (Diluted)": [], "Revenue/Share": []}
    hlt_r = {"Current Ratio": [], "Quick Ratio": [], "Debt / Equity": []}

    for r, p in zip(records, prices):
        shares = r.get("shares"); rev = r.get("rev"); gross = r.get("gross")
        op_inc = r.get("op_inc"); net_inc = r.get("net_inc"); ebitda = r.get("ebitda")
        eps_b  = r.get("eps_b"); eps_d   = r.get("eps_d")
        cur_ast = r.get("cur_ast"); cur_lib = r.get("cur_lib"); inventory = r.get("inventory")
        equity  = r.get("equity");  tot_ast = r.get("tot_ast")
        tot_debt = r.get("tot_debt"); cash = r.get("cash")

        mkt_cap = (p * shares) if p and shares else None
        ev      = (mkt_cap + (tot_debt or 0) - (cash or 0)) if mkt_cap else None
        bvps    = _div(equity, shares)

        val_r["P/E Ratio"].append(_fx(_div(p, eps_d)))
        val_r["P/B Ratio"].append(_fx(_div(p, bvps)))
        val_r["EV/EBITDA"].append(_fx(_div(ev, ebitda)))
        val_r["EV/Revenue"].append(_fx(_div(ev, rev)))
        val_r["Price/Sales"].append(_fx(_div(p, _div(rev, shares))))

        pro_r["Gross Margin"].append(_fp(_div(gross, rev)))
        pro_r["Operating Margin"].append(_fp(_div(op_inc, rev)))
        pro_r["Net Margin"].append(_fp(_div(net_inc, rev)))
        pro_r["Return on Equity"].append(_fp(_div(net_inc, equity)))
        pro_r["Return on Assets"].append(_fp(_div(net_inc, tot_ast)))

        ps_r["EPS (Basic)"].append(_fd(eps_b))
        ps_r["EPS (Diluted)"].append(_fd(eps_d))
        ps_r["Revenue/Share"].append(_fd(_div(rev, shares)))

        hlt_r["Current Ratio"].append(_fx(_div(cur_ast, cur_lib), suffix=""))
        quick = _div((cur_ast or 0) - (inventory or 0), cur_lib) if cur_ast and cur_lib else None
        hlt_r["Quick Ratio"].append(_fx(quick, suffix=""))
        hlt_r["Debt / Equity"].append(_fx(_div(tot_debt, equity), suffix="x"))

    def _sec(title, rd):
        return {"title": title, "rows": [{"label": l, "values": v} for l, v in rd.items()]}

    return {
        "periods": periods,
        "sections": [
            _sec("Valuation",        val_r),
            _sec("Profitability",    pro_r),
            _sec("Per Share",        ps_r),
            _sec("Financial Health", hlt_r),
        ],
    }


# ─── Chart / Returns / Quote ──────────────────────────────────────────────────

PERIODS = {
    "1D":  ("5d",  "1m"),   "5D":  ("5d",  "5m"),
    "1M":  ("1mo", "15m"),  "YTD": ("ytd", "1h"),
    "3M":  ("3mo", "1h"),   "6M":  ("6mo", "1h"),
    "1Y":  ("1y",  "1d"),   "5Y":  ("5y",  "1d"),
    "Max": ("max", "1wk"),
}


def fmt_label(ts, period: str) -> str:
    dt = ts.to_pydatetime()
    h, m = dt.hour, dt.minute
    ampm = "AM" if h < 12 else "PM"
    h12  = h % 12 or 12
    if period == "1D":  return f"{h12}:{m:02d} {ampm}"
    if period == "5D":  return f"{dt.strftime('%a')} {h12}:{m:02d} {ampm}"
    if period in ("1M", "3M"): return f"{dt.strftime('%b')} {dt.day}"
    return f"{dt.strftime('%b')} {dt.day}, {dt.year}"


@router.get("/stock/{ticker}/chart")
def get_chart(ticker: str, period: str = "1D"):
    if period not in PERIODS:
        raise HTTPException(status_code=400, detail=f"Unknown period '{period}'")
    yf_period, interval = PERIODS[period]
    try:
        hist = yf.Ticker(ticker.upper()).history(period=yf_period, interval=interval, auto_adjust=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if hist.empty:
        raise HTTPException(status_code=404, detail=f"No data for '{ticker}'")
    if period == "1D":
        by_date = {}
        for ts in hist.index:
            d = ts.date(); by_date[d] = by_date.get(d, 0) + 1
        all_dates = sorted(by_date.keys(), reverse=True)
        best = all_dates[0]
        if by_date[best] < 5 and len(all_dates) > 1:
            best = all_dates[1]
        hist = hist[[ts.date() == best for ts in hist.index]]
    return {"data": [
        {"time": fmt_label(ts, period), "price": round(float(row["Close"]), 2)}
        for ts, row in hist.iterrows() if not math.isnan(row["Close"])
    ]}


@router.get("/stock/{ticker}/returns")
def get_returns(ticker: str):
    try:
        t       = yf.Ticker(ticker.upper())
        hist    = t.history(period="max", interval="1d", auto_adjust=True)
        current = float(t.fast_info.last_price)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if hist.empty:
        raise HTTPException(status_code=404, detail=f"No data for '{ticker}'")
    closes  = hist["Close"]
    last_ts = closes.index[-1]

    def prior(cutoff):
        s = closes[closes.index <= cutoff]
        return float(s.iloc[-1]) if not s.empty else None

    def ret(past):
        return round((current - past) / past * 100, 2) if past else None

    ytd_start = pd.Timestamp(f"{last_ts.year}-01-01", tz=str(last_ts.tzinfo))
    return {
        "1D":  ret(float(closes.iloc[-2])) if len(closes) >= 2 else None,
        "5D":  ret(prior(last_ts - pd.tseries.offsets.BDay(5))),
        "1M":  ret(prior(last_ts - pd.DateOffset(months=1))),
        "6M":  ret(prior(last_ts - pd.DateOffset(months=6))),
        "YTD": ret(prior(ytd_start)),
        "1Y":  ret(prior(last_ts - pd.DateOffset(years=1))),
        "5Y":  ret(prior(last_ts - pd.DateOffset(years=5))),
        "Max": ret(float(closes.iloc[0])),
    }


@router.get("/stock/{ticker}/quote")
def get_quote(ticker: str):
    try:
        t       = yf.Ticker(ticker.upper())
        current = float(t.fast_info.last_price)
        hist    = t.history(period="5d", interval="1d", auto_adjust=True)
        if hist.empty or len(hist) < 2:
            raise ValueError("Insufficient history")
        prev = float(hist["Close"].iloc[-2])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if not current:
        raise HTTPException(status_code=404, detail=f"No quote for '{ticker}'")
    change = round(current - prev, 2)
    return {
        "currentPrice":  round(current, 2),
        "previousClose": round(prev, 2),
        "change":        change,
        "changePct":     round((change / prev) * 100, 2) if prev else 0.0,
    }


# ─── About / Founded / Trading ────────────────────────────────────────────────

_WP_HEADERS = {"User-Agent": "StockViewApp/1.0 (stockview@example.com)"}
_YEAR_RE    = re.compile(r'\b(1[6-9]\d{2}|20\d{2})\b')
_INFOBOX_RE = re.compile(
    r'\|\s*(?:founded|foundation|founded_date)[^=\n]*=\s*[^\n]*?(\b1[6-9]\d{2}\b|\b20\d{2}\b)',
    re.IGNORECASE,
)


def _get_founded_year(company_name: str):
    try:
        ddg = _req.get("https://api.duckduckgo.com/", headers=_WP_HEADERS,
                       params={"q": company_name, "format": "json",
                               "no_html": "1", "skip_disambig": "1"}, timeout=6).json()
        content = ddg.get("Infobox", {}).get("content", []) if isinstance(ddg, dict) else []
        item = next((i for i in content if i.get("label", "").lower() == "founded"), None)
        if item:
            years = _YEAR_RE.findall(item.get("value", ""))
            if years:
                return years[-1]
    except Exception:
        pass
    try:
        search = _req.get("https://en.wikipedia.org/w/api.php", headers=_WP_HEADERS,
                          params={"action": "query", "list": "search", "srsearch": company_name,
                                  "format": "json", "srlimit": 1}, timeout=6).json()
        results = search.get("query", {}).get("search", [])
        if not results:
            return None
        title = results[0]["title"]
        summary = _req.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{title.replace(' ', '_')}",
            headers=_WP_HEADERS, timeout=6).json()
        m = re.search(
            r'(?:founded|formed|incorporated|established)\s+(?:in\s+)?(?:[A-Za-z]+\s+)?'
            r'(\b1[6-9]\d{2}\b|\b20\d{2}\b)', summary.get("extract", ""), re.IGNORECASE)
        if m:
            return m.group(1)
        wt = _req.get("https://en.wikipedia.org/w/api.php", headers=_WP_HEADERS,
                      params={"action": "query", "prop": "revisions", "titles": title,
                              "rvprop": "content", "rvsection": "0", "format": "json"}, timeout=6).json()
        pages    = wt.get("query", {}).get("pages", {})
        wikitext = next(iter(pages.values()), {}).get("revisions", [{}])[0].get("*", "")
        m = _INFOBOX_RE.search(wikitext)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


@router.get("/stock/{ticker}/about")
def get_about(ticker: str):
    try:
        info = yf.Ticker(ticker.upper()).info
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    officers = info.get("companyOfficers", [])
    ceo = next((o.get("name") for o in officers
                if any(t in o.get("title", "").upper() for t in ["CEO", "CHIEF EXECUTIVE"])), None)
    raw_site = info.get("website", "") or ""
    display_site = (raw_site.replace("https://www.", "").replace("http://www.", "")
                    .replace("https://", "").replace("http://", "").rstrip("/"))
    emp = info.get("fullTimeEmployees")
    return {
        "employees":   f"{int(emp):,}" if emp else None,
        "ceo":         ceo,
        "website":     display_site or None,
        "description": info.get("longBusinessSummary"),
    }


@router.get("/stock/{ticker}/founded")
def get_founded(ticker: str):
    try:
        info = yf.Ticker(ticker.upper()).info
        company_name = info.get("longName") or info.get("shortName") or ticker
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    year = _get_founded_year(company_name)
    if year is None:
        raise HTTPException(status_code=404, detail="Founded year not found")
    return {"founded": year}


@router.get("/stock/{ticker}/trading-info")
def get_trading_info(ticker: str):
    try:
        t    = yf.Ticker(ticker.upper())
        info = t.info
        fi   = t.fast_info
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    def safe(*keys, default=None):
        for k in keys:
            v = info.get(k)
            if v is not None: return v
        return default

    def fmt_large(n):
        if n is None: return "N/A"
        n = float(n)
        if n >= 1e12: return f"{n/1e12:.2f}T"
        if n >= 1e9:  return f"{n/1e9:.2f}B"
        if n >= 1e6:  return f"{n/1e6:.1f}M"
        if n >= 1e3:  return f"{n/1e3:.1f}K"
        return str(int(n))

    current = float(fi.last_price) if fi.last_price else safe("currentPrice", "regularMarketPrice", default=0)
    earnings_date = None
    try:
        cal = t.calendar
        ed  = cal.get("Earnings Date") if cal else None
        if ed:
            raw = ed[0] if isinstance(ed, (list, tuple)) else ed
            earnings_date = pd.Timestamp(raw).strftime("%b %d, %Y")
    except Exception:
        pass
    if not earnings_date:
        for key in ("earningsTimestampStart", "earningsTimestamp"):
            ts = info.get(key)
            if ts:
                try:
                    earnings_date = pd.Timestamp(float(ts), unit="s").strftime("%b %d, %Y")
                    break
                except Exception:
                    pass

    return {
        "currentPrice": round(current, 2),
        "prevClose":    round(safe("previousClose", "regularMarketPreviousClose", default=0), 2),
        "dayLow":       round(safe("dayLow",  "regularMarketDayLow",  default=0), 2),
        "dayHigh":      round(safe("dayHigh", "regularMarketDayHigh", default=0), 2),
        "w52Low":       round(safe("fiftyTwoWeekLow",  default=0), 2),
        "w52High":      round(safe("fiftyTwoWeekHigh", default=0), 2),
        "bid":          round(safe("bid", default=0), 2),
        "ask":          round(safe("ask", default=0), 2),
        "volume":       fmt_large(safe("volume", "regularMarketVolume", default=0)),
        "avgVolume":    fmt_large(safe("averageVolume", "averageDailyVolume10Day", default=0)),
        "marketCap":    fmt_large(safe("marketCap")),
        "shares":       fmt_large(safe("sharesOutstanding")),
        "earningsDate": earnings_date,
    }


@router.get("/stock/{ticker}/valuation")
def get_valuation(ticker: str):
    """
    Return analyst consensus price target (from yFinance) as the fair value.
    """
    t    = yf.Ticker(ticker.upper())
    info = t.info

    # ── Current price ────────────────────────────────────────────
    try:
        current_price = float(t.fast_info.last_price)
    except Exception:
        current_price = float(info.get("currentPrice")
                              or info.get("regularMarketPrice") or 0)
    if not current_price:
        raise HTTPException(status_code=404, detail="No price data")

    # ── Analyst consensus price target via yFinance ───────────────
    analyst_target = info.get("targetMeanPrice")
    analyst_median = info.get("targetMedianPrice")
    analyst_high   = info.get("targetHighPrice")
    analyst_low    = info.get("targetLowPrice")
    analyst_count  = info.get("numberOfAnalystOpinions")
    rec_key        = (info.get("recommendationKey") or "").lower()
    RATING = {
        "strong_buy": "Strong Buy", "buy": "Buy", "hold": "Hold",
        "underperform": "Sell",     "sell": "Sell", "strong_sell": "Strong Sell",
    }
    analyst_rating = RATING.get(rec_key, rec_key.replace("_", " ").title() or None)

    if not analyst_target:
        raise HTTPException(status_code=404, detail="No analyst consensus data available")

    fair_value = round(float(analyst_target), 2)
    label      = "Target Price"

    def upside(v):
        return round((v - current_price) / current_price * 100, 1)

    is_under = fair_value > current_price
    disc_pct = abs(round((current_price - fair_value) / fair_value * 100, 1))

    return {
        "currentPrice":   round(current_price, 2),
        "fairValue":      fair_value,
        "fairValueLabel": label,
        "isUndervalued":  is_under,
        "discountPct":    disc_pct,
        "methods": [
            {"name": label, "value": fair_value, "upside": upside(fair_value)},
        ],
        "analystRating": analyst_rating or None,
        "analystTarget": fair_value,
        "analystHigh":   round(float(analyst_high),   2) if analyst_high   else None,
        "analystLow":    round(float(analyst_low),    2) if analyst_low    else None,
        "analystMedian": round(float(analyst_median), 2) if analyst_median else None,
        "analystCount":  int(analyst_count) if analyst_count else None,
    }


@router.get("/search")
def search_companies(q: str = ""):
    """
    Search all SEC EDGAR filers by ticker prefix or name substring.
    Returns up to 12 results: ticker-prefix matches first, then name matches.
    Falls back gracefully if the background load hasn't finished yet.
    """
    if not q:
        return []
    # Block briefly (≤15 s) if still loading for the very first call
    if not _edgar_search_ready:
        _edgar_load_search_list()

    q_up = q.upper()
    q_lo = q.lower()

    ticker_hits = [c for c in _edgar_search_list if c["ticker"].startswith(q_up)]
    seen        = {c["ticker"] for c in ticker_hits}
    name_hits   = [c for c in _edgar_search_list
                   if c["ticker"] not in seen and q_lo in c["name"].lower()]

    return (ticker_hits + name_hits)[:12]


@router.get("/health")
def health():
    return {"status": "ok"}


# ─── Financials row definitions (for yfinance fallback) ───────────────────────

_INCOME_ROWS = [
    ("Total Revenue",                      "Total Revenue",           False, "currency", True),
    ("Cost Of Revenue",                    "Cost of Revenue",         True,  "currency", False),
    ("Gross Profit",                        "Gross Profit",            False, "currency", True),
    ("Research And Development",           "Research & Development",  True,  "currency", False),
    ("Selling General And Administration", "SG&A",                    True,  "currency", False),
    ("Operating Income",                   "Operating Income",        False, "currency", True),
    ("Interest Expense Non Operating",     "Interest Expense",        True,  "currency", False),
    ("Pretax Income",                      "Pre-tax Income",          False, "currency", False),
    ("Tax Provision",                      "Income Tax",              True,  "currency", False),
    ("Net Income",                         "Net Income",              False, "currency", True),
    ("EBITDA",                             "EBITDA",                  False, "currency", False),
    ("Basic EPS",                          "EPS (Basic)",             False, "eps",      False),
    ("Diluted EPS",                        "EPS (Diluted)",           False, "eps",      False),
]
_BALANCE_ROWS = [
    ("Cash And Cash Equivalents",               "Cash & Equivalents",        False, "currency", False),
    ("Other Short Term Investments",            "Short-term Investments",    True,  "currency", False),
    ("Receivables",                             "Receivables",               True,  "currency", False),
    ("Inventory",                               "Inventory",                 True,  "currency", False),
    ("Current Assets",                          "Total Current Assets",      False, "currency", True),
    ("Net PPE",                                 "Net PP&E",                  True,  "currency", False),
    ("Total Assets",                            "Total Assets",              False, "currency", True),
    ("Current Liabilities",                     "Total Current Liabilities", False, "currency", True),
    ("Long Term Debt",                          "Long-term Debt",            True,  "currency", False),
    ("Total Liabilities Net Minority Interest", "Total Liabilities",         False, "currency", True),
    ("Common Stock Equity",                     "Stockholders' Equity",      False, "currency", True),
    ("Net Debt",                                "Net Debt",                  False, "currency", False),
]
_CASHFLOW_ROWS = [
    ("Operating Cash Flow", "Operating Cash Flow", False, "currency", True),
    ("Capital Expenditure", "Capital Expenditure", True,  "currency", False),
    ("Free Cash Flow",      "Free Cash Flow",      False, "currency", True),
    ("Investing Cash Flow", "Investing Cash Flow", False, "currency", False),
    ("Financing Cash Flow", "Financing Cash Flow", False, "currency", False),
    ("Changes In Cash",     "Net Change in Cash",  False, "currency", False),
]


def _fmt_fin(v, fmt_type="currency"):
    try:
        if v is None or math.isnan(float(v)):
            return "—"
    except (TypeError, ValueError):
        return "—"
    v = float(v)
    if fmt_type == "eps":
        return f"${v:.2f}"
    neg = v < 0;  av = abs(v)
    if   av >= 1e12: s = f"${av/1e12:.2f}T"
    elif av >= 1e9:  s = f"${av/1e9:.2f}B"
    elif av >= 1e6:  s = f"${av/1e6:.1f}M"
    elif av >= 1e3:  s = f"${av/1e3:.0f}K"
    else:            s = f"${av:.2f}"
    return f"({s})" if neg else s


def _yf_financials(ticker: str, statement: str, freq: str):
    """yfinance financial table — used for quarterly and as ultimate fallback."""
    t = yf.Ticker(ticker.upper())
    if statement == "income":
        df = t.financials if freq == "annual" else t.quarterly_financials
        row_defs = _INCOME_ROWS
    elif statement == "balance":
        df = t.balance_sheet if freq == "annual" else t.quarterly_balance_sheet
        row_defs = _BALANCE_ROWS
    elif statement == "cashflow":
        df = t.cashflow if freq == "annual" else t.quarterly_cashflow
        row_defs = _CASHFLOW_ROWS
    else:
        return None

    if df is None or df.empty:
        return None

    cols = list(df.columns)
    if freq == "annual":
        periods = [c.strftime("%Y") if hasattr(c, "strftime") else str(c)[:4] for c in cols]
    else:
        periods = [c.strftime("%b '%y") if hasattr(c, "strftime") else str(c)[:7] for c in cols]

    rows = []
    for (key, label, indent, fmt, bold) in row_defs:
        if key in df.index:
            raw_vals  = [df.loc[key, c] for c in cols]
            formatted = [_fmt_fin(v, fmt) for v in raw_vals]
            raw_nums  = [None if (v is None or (isinstance(v, float) and math.isnan(v)))
                         else float(v) for v in raw_vals]
        else:
            formatted = ["—"] * len(cols); raw_nums = [None] * len(cols)
        rows.append({"label": label, "indent": indent, "bold": bold,
                     "values": formatted, "raw": raw_nums})

    n_rows = len(rows)
    good_cols = [i for i in range(len(periods))
                 if sum(1 for r in rows if r["values"][i] != "—") / n_rows >= 0.40]
    if len(good_cols) < len(periods):
        periods = [periods[i] for i in good_cols]
        for r in rows:
            r["values"] = [r["values"][i] for i in good_cols]
            r["raw"]    = [r["raw"][i]    for i in good_cols]

    return {"periods": periods, "rows": rows, "source": "yfinance"}


# ─── Financials endpoints ─────────────────────────────────────────────────────

@router.get("/stock/{ticker}/financials")
def get_financials(ticker: str, statement: str = "income", freq: str = "annual"):
    # 1. IBKR (Reuters) — if gateway running and subscribed
    xml = _ibkr_xml(ticker, "ReportsFinStatements")
    if xml:
        result = _parse_reuters_financials(xml, statement, freq)
        if result:
            return result

    # 2. SEC EDGAR — annual only (unlimited, free, 10+ years)
    if freq == "annual":
        try:
            records = _edgar_annual_records(ticker.upper())
            result  = _edgar_build_financials(records, statement)
            if result:
                return result
        except Exception:
            pass

    # 3. yfinance — always available, covers quarterly too
    try:
        result = _yf_financials(ticker, statement, freq)
        if result:
            return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    raise HTTPException(status_code=404, detail="No financial data available")


@router.get("/stock/{ticker}/financials/ratios")
def get_ratios(ticker: str):
    # 1. IBKR
    source  = "yfinance"
    records = []
    xml = _ibkr_xml(ticker, "ReportsFinStatements")
    if xml:
        ibkr_recs = _ibkr_annual_records(xml)
        if ibkr_recs:
            records = ibkr_recs; source = "ibkr"

    # 2. SEC EDGAR
    if not records:
        try:
            edgar_recs = _edgar_annual_records(ticker.upper())
            if edgar_recs:
                records = edgar_recs; source = "edgar"
        except Exception:
            pass

    # 3. yfinance
    if not records:
        try:
            records = _yfinance_annual_records(yf.Ticker(ticker.upper()))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    if not records:
        raise HTTPException(status_code=404, detail="Insufficient financial data")

    # Year-end prices always from yfinance
    try:
        hist = yf.Ticker(ticker.upper()).history(period="12y", interval="1d", auto_adjust=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    def _price_at(end_date_str):
        try:
            cutoff = pd.Timestamp(end_date_str).date()
            subset = hist[hist.index.date <= cutoff]
            return float(subset["Close"].iloc[-1]) if not subset.empty else None
        except Exception:
            return None

    periods = [r["year"]     for r in records]
    prices  = [_price_at(r["end_date"]) for r in records]

    result           = _compute_ratios(periods, records, prices)
    result["source"] = source
    return result


# Register all routes under /api
app.include_router(router)
