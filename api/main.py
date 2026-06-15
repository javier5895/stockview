import os
import concurrent.futures
from typing import Optional
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
import math
import re
import threading
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import pandas as pd
import requests as _req
import yfinance as yf
from fastapi import APIRouter, FastAPI, HTTPException, Query
from pydantic import BaseModel
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
            ("Financing Cash Flow", lambda d: _rval(d, "FTLF"),  False, "currency", False),
            ("Investing Cash Flow", lambda d: _rval(d, "ITLI"),  False, "currency", False),
            ("Net Change in Cash",  lambda d: _rval(d, "SNCC"),  False, "currency", False),
            ("Capital Expenditure", lambda d: _rval(d, "SCEX"),  True,  "currency", False),
            ("Free Cash Flow",      _fcf,                         False, "currency", True),
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
    "sga":      ["SellingGeneralAndAdministrativeExpense",
                 "SellingGeneralAndAdministrativeExpenseExcludingDepreciation"],
    # Separate G&A / Marketing — used to compute SG&A when combined tag is absent
    "ga":       ["GeneralAndAdministrativeExpense"],
    "marketing":["MarketingExpense", "SellingAndMarketingExpense",
                 "AdvertisingExpense"],
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
    Try all concept names; return {end_date: value} for the candidate with the
    most recent data.  Trying all (rather than stopping at first match) handles
    companies that switched XBRL tags mid-history — e.g. Copart used 'Revenues'
    through 2020 then switched to 'RevenueFromContractWithCustomerIncludingAssessedTax'.

    EDGAR includes both consolidated totals AND segment-level data under the same
    concept name (dimensional context is stripped by the companyfacts API).  To
    always pick the consolidated figure we:
      1. Group by (end_date, filed_date) and keep the MAX value — total > any segment.
      2. Then deduplicate by end_date keeping the most-recently-filed version
         (handles 10-K amendments / restatements).
    """
    best_map      = {}
    best_max_date = ""

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

        if not by_end:
            continue

        # Keep the concept whose data reaches furthest into the future
        max_date = max(by_end.keys())
        if max_date > best_max_date:
            best_max_date = max_date
            best_map = {end: pair[0] for end, pair in by_end.items()}

    return best_map


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
    sga_m  = gc("sga",     _E_INC);  ga_m   = gc("ga",      _E_INC)
    mkt_m  = gc("marketing",_E_INC); opi_m  = gc("op_inc",  _E_INC)
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
            "rev":      cv(rev_m),  "cogs":     cv(cgs_m),
            "gross":    cv(grp_m) if cv(grp_m) is not None else (
                        (cv(rev_m) - cv(cgs_m))
                        if cv(rev_m) is not None and cv(cgs_m) is not None else None),
            "rd":       cv(rd_m),
            "sga":      cv(sga_m) if cv(sga_m) is not None else (
                        (cv(ga_m) + cv(mkt_m))
                        if cv(ga_m) is not None and cv(mkt_m) is not None
                        else (cv(ga_m) or cv(mkt_m))),
            "op_inc":   op_inc,
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
        # 7-tuple: (label, fn, indent, fmt, bold, group_id, parent_group)
        row_specs = [
            ("Total Revenue",          lambda r: r["rev"],      False, "currency", True,  None,            None),
            ("Cost of Revenue",        lambda r: r["cogs"],     True,  "currency", False, None,            None),
            ("Gross Profit",           lambda r: r["gross"],    False, "currency", True,  None,            None),
            ("Research & Development", lambda r: r["rd"],       True,  "currency", False, None,            None),
            ("SG&A",                   lambda r: r["sga"],      True,  "currency", False, None,            None),
            ("Operating Income",       lambda r: r["op_inc"],   False, "currency", True,  None,            None),
            ("Interest Expense",       lambda r: r["interest"], True,  "currency", False, None,            None),
            ("Pre-tax Income",         lambda r: r["pretax"],   False, "currency", False, None,            None),
            ("Income Tax",             lambda r: r["tax"],      True,  "currency", False, None,            None),
            ("Net Income",             lambda r: r["net_inc"],  False, "currency", True,  "grp_netincome", None),
            ("EBITDA",                 lambda r: r["ebitda"],   False, "currency", False, None,            "grp_netincome"),
            ("EPS (Basic)",            lambda r: r["eps_b"],    False, "eps",      False, None,            "grp_netincome"),
            ("EPS (Diluted)",          lambda r: r["eps_d"],    False, "eps",      False, None,            "grp_netincome"),
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
            ("Operating Cash Flow", lambda r: r["op_cf"],                                       False, "currency", True),
            ("Financing Cash Flow", lambda r: r["fin_cf"],                                       False, "currency", False),
            ("Investing Cash Flow", lambda r: r["inv_cf"],                                       False, "currency", False),
            ("Net Change in Cash",  lambda r: r["net_chg"],                                      False, "currency", False),
            ("Capital Expenditure", lambda r: (-r["capex"] if r["capex"] is not None else None), True,  "currency", False),
            ("Free Cash Flow",      lambda r: r["fcf"],                                          False, "currency", True),
        ]

    rows = []
    for row_spec in row_specs:
        if len(row_spec) == 7:
            label, fn, indent, fmt, bold, group_id, parent_group = row_spec
        else:
            label, fn, indent, fmt, bold = row_spec
            group_id, parent_group = None, None
        raw_vals  = [fn(r) for r in records]
        formatted = [_fmt_fin(v, fmt) for v in raw_vals]
        rows.append({
            "label": label, "indent": indent, "bold": bold,
            "groupId": group_id, "parentGroup": parent_group,
            "values": formatted, "raw": raw_vals,
        })

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


_INDEX_MAP = {
    "SPX": "^GSPC",
    "NDX": "^NDX",
    "DJI": "^DJI",
    "RUT": "^RUT",
}

_INDEX_NAMES = {
    "SPX": "S&P 500",
    "NDX": "Nasdaq 100",
    "DJI": "Dow Jones",
    "RUT": "Russell 2000",
}

_INDICES_CACHE: dict = {}
_INDICES_CACHE_TS: float = 0.0

@router.get("/indices")
def get_indices():
    global _INDICES_CACHE, _INDICES_CACHE_TS
    if time.time() - _INDICES_CACHE_TS < 60 and _INDICES_CACHE:
        return _INDICES_CACHE

    def _fetch_one(sym):
        yf_sym = _INDEX_MAP[sym]
        try:
            t    = yf.Ticker(yf_sym)
            fi   = t.fast_info
            hist = t.history(period="1d", interval="5m", auto_adjust=True)
            current  = float(fi.last_price or 0)
            prev     = float(fi.previous_close or 0)
            change   = round(current - prev, 2) if prev else 0
            change_pct = round((change / prev) * 100, 2) if prev else 0
            spark = []
            if not hist.empty:
                closes = hist["Close"].dropna().tolist()
                spark = [round(float(v), 2) for v in closes]
            return {
                "ticker":    sym,
                "name":      _INDEX_NAMES[sym],
                "value":     round(current, 2),
                "change":    change_pct,
                "sparkData": spark,
            }
        except Exception:
            return None

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(_fetch_one, sym): sym for sym in _INDEX_MAP}
        for fut in concurrent.futures.as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)

    # preserve display order
    order = list(_INDEX_MAP.keys())
    results.sort(key=lambda x: order.index(x["ticker"]) if x["ticker"] in order else 99)

    _INDICES_CACHE = results
    _INDICES_CACHE_TS = time.time()
    return results

_INDEX_DESC = {
    "SPX": "Tracks 500 large-cap US companies across all sectors. Widely regarded as the best single gauge of the US equity market.",
    "NDX": "Tracks the 100 largest non-financial companies listed on the Nasdaq Stock Market, heavily weighted toward technology.",
    "DJI": "Price-weighted average of 30 blue-chip US companies. One of the oldest and most-followed equity indices in the world.",
    "RUT": "Measures performance of roughly 2,000 small-cap US companies. A key benchmark for smaller domestic businesses.",
}

@router.get("/index/{symbol}/detail")
def get_index_detail(symbol: str):
    sym = symbol.upper()
    yf_sym = _INDEX_MAP.get(sym, sym)
    try:
        t    = yf.Ticker(yf_sym)
        info = t.info
        fi   = t.fast_info
        hist = t.history(period="5d", interval="1d", auto_adjust=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    current = float(fi.last_price or info.get("regularMarketPrice") or 0)
    prev    = float(fi.previous_close or info.get("regularMarketPreviousClose") or 0)
    change     = round(current - prev, 2) if prev else 0
    change_pct = round((change / prev) * 100, 2) if prev else 0

    def _s(*keys):
        for k in keys:
            v = info.get(k)
            if v is not None:
                return v
        return None

    def _fmt(n):
        if not n: return None
        n = float(n)
        if n >= 1e12: return f"{n/1e12:.2f}T"
        if n >= 1e9:  return f"{n/1e9:.2f}B"
        if n >= 1e6:  return f"{n/1e6:.1f}M"
        return f"{int(n):,}"

    # YTD return
    ytd_ret = None
    try:
        year_start = pd.Timestamp(f"{hist.index[-1].year}-01-01", tz=str(hist.index[-1].tzinfo))
        ytd_hist = t.history(start=year_start, interval="1d", auto_adjust=True)
        if not ytd_hist.empty:
            ytd_ret = round((current / float(ytd_hist["Close"].iloc[0]) - 1) * 100, 2)
    except Exception:
        pass

    # 1-year return
    one_yr_ret = None
    try:
        yr_hist = t.history(period="1y", interval="1d", auto_adjust=True)
        if not yr_hist.empty:
            one_yr_ret = round((current / float(yr_hist["Close"].iloc[0]) - 1) * 100, 2)
    except Exception:
        pass

    return {
        "name":        _s("longName", "shortName") or symbol.upper(),
        "symbol":      sym,
        "description": _INDEX_DESC.get(sym),
        "current":     round(current, 2),
        "change":      change,
        "changePct":   change_pct,
        "prevClose":   round(prev, 2),
        "dayHigh":     round(float(_s("dayHigh", "regularMarketDayHigh") or current), 2),
        "dayLow":      round(float(_s("dayLow",  "regularMarketDayLow")  or current), 2),
        "w52High":     round(float(_s("fiftyTwoWeekHigh")  or 0), 2),
        "w52Low":      round(float(_s("fiftyTwoWeekLow")   or 0), 2),
        "volume":      _fmt(_s("volume", "regularMarketVolume")),
        "avgVolume":   _fmt(_s("averageVolume")),
        "ytdReturn":   ytd_ret,
        "oneYrReturn": one_yr_ret,
    }


@router.get("/stock/{ticker}/quote")
def get_quote(ticker: str):
    def _fmt(n):
        if n is None: return None
        n = float(n)
        if n >= 1e12: return f"{n/1e12:.2f}T"
        if n >= 1e9:  return f"{n/1e9:.2f}B"
        if n >= 1e6:  return f"{n/1e6:.1f}M"
        if n >= 1e3:  return f"{n/1e3:.0f}K"
        return str(int(n))

    # 1. FMP: quote (price/change) + ratios-ttm (PE) in parallel
    try:
        BASE = "https://financialmodelingprep.com/stable"
        tk = ticker.upper()
        def _fq(): return _req.get(f"{BASE}/quote?symbol={tk}&apikey={FMP_KEY}", timeout=10).json()
        def _fr(): return _req.get(f"{BASE}/ratios-ttm?symbol={tk}&apikey={FMP_KEY}", timeout=10).json()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fq_fut = pool.submit(_fq)
            fr_fut = pool.submit(_fr)
            fq = fq_fut.result(); fr = fr_fut.result()
        q = fq[0] if isinstance(fq, list) and fq else {}
        r = fr[0] if isinstance(fr, list) and fr else {}
        if q.get("price"):
            price = float(q["price"])
            prev  = float(q.get("previousClose") or price)
            change = round(float(q.get("change") or 0), 2)
            change_pct = round(float(q.get("changePercentage") or 0), 2)
            pe_v = r.get("priceToEarningsRatioTTM")
            pe = round(float(pe_v), 1) if pe_v and math.isfinite(float(pe_v)) else None
            # Earnings date: yfinance (FMP price-target empty on this tier)
            earnings_date = None
            try:
                t_yf = yf.Ticker(tk)
                cal   = t_yf.calendar
                ed    = cal.get("Earnings Date") if cal else None
                if ed:
                    raw = ed[0] if isinstance(ed, (list, tuple)) else ed
                    earnings_date = pd.Timestamp(raw).strftime("%b %d")
            except Exception:
                pass
            return {
                "currentPrice":  round(price, 2),
                "previousClose": round(prev, 2),
                "change":        change,
                "changePct":     change_pct,
                "pe":            pe,
                "marketCap":     _fmt(q.get("marketCap")),
                "volume":        _fmt(q.get("volume")),
                "earningsDate":  earnings_date,
            }
    except Exception:
        pass

    # 2. yfinance fallback
    try:
        t       = yf.Ticker(ticker.upper())
        info    = t.info
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
    pe_raw = info.get("trailingPE") or info.get("forwardPE")
    pe = round(float(pe_raw), 1) if pe_raw and math.isfinite(float(pe_raw)) else None
    earnings_date = None
    try:
        cal = t.calendar
        ed  = cal.get("Earnings Date") if cal else None
        if ed:
            raw = ed[0] if isinstance(ed, (list, tuple)) else ed
            earnings_date = pd.Timestamp(raw).strftime("%b %d")
    except Exception:
        pass
    if not earnings_date:
        for key in ("earningsTimestampStart", "earningsTimestamp"):
            ts = info.get(key)
            if ts:
                try:
                    earnings_date = pd.Timestamp(float(ts), unit="s").strftime("%b %d")
                    break
                except Exception:
                    pass
    return {
        "currentPrice":  round(current, 2),
        "previousClose": round(prev, 2),
        "change":        change,
        "changePct":     round((change / prev) * 100, 2) if prev else 0.0,
        "pe":            pe,
        "marketCap":     _fmt(info.get("marketCap")),
        "volume":        _fmt(info.get("volume") or info.get("regularMarketVolume")),
        "earningsDate":  earnings_date,
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


_EXCHANGE_MAP = {
    "NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ",
    "NYQ": "NYSE",   "NYA": "NYSE",
    "ASE": "AMEX",
    "PCX": "ARCA",
    "BTS": "BATS",
    "LSE": "LSE",
    "TSX": "TSX",
    "TOR": "TSX",
}

def _fmt_mktcap(n):
    if not n: return None
    n = float(n)
    if n >= 1e12: return f"{n/1e12:.2f}T"
    if n >= 1e9:  return f"{n/1e9:.2f}B"
    if n >= 1e6:  return f"{n/1e6:.1f}M"
    return str(int(n))

@router.get("/stock/{ticker}/about")
def get_about(ticker: str):
    # 1. FMP profile — richer than yfinance (has direct logo URL via 'image')
    try:
        tk = ticker.upper()
        r  = _req.get(
            f"https://financialmodelingprep.com/stable/profile?symbol={tk}&apikey={FMP_KEY}",
            timeout=12)
        items = r.json() if r.ok else []
        if items and isinstance(items, list):
            p = items[0]
            raw_site = p.get("website", "") or ""
            display_site = (raw_site.replace("https://www.", "").replace("http://www.", "")
                            .replace("https://", "").replace("http://", "").rstrip("/"))
            emp = p.get("fullTimeEmployees")
            exch_raw = p.get("exchangeFullName") or p.get("exchange") or ""
            exch = _EXCHANGE_MAP.get(exch_raw.upper(), exch_raw or None)
            return {
                "name":        p.get("companyName") or tk,
                "sector":      p.get("sector") or None,
                "exchange":    exch,
                "marketCap":   _fmt_mktcap(p.get("marketCap")),
                "employees":   f"{int(emp):,}" if emp else None,
                "ceo":         p.get("ceo") or None,
                "website":     display_site or None,
                "logo":        p.get("image") or None,   # FMP provides logo directly
                "description": p.get("description") or None,
            }
    except Exception:
        pass

    # 2. yfinance fallback
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
    domain = display_site.split("/")[0] if display_site else ""
    logo_url = f"https://logo.clearbit.com/{domain}" if domain else None
    emp = info.get("fullTimeEmployees")
    raw_exchange = info.get("exchange") or ""
    exchange = _EXCHANGE_MAP.get(raw_exchange.upper(), raw_exchange.upper() or None)
    return {
        "name":        info.get("longName") or info.get("shortName") or ticker.upper(),
        "sector":      info.get("sector") or None,
        "exchange":    exchange,
        "marketCap":   _fmt_mktcap(info.get("marketCap")),
        "employees":   f"{int(emp):,}" if emp else None,
        "ceo":         ceo,
        "website":     display_site or None,
        "logo":        logo_url,
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
    def fmt_large(n):
        if n is None: return "N/A"
        n = float(n)
        if n >= 1e12: return f"{n/1e12:.2f}T"
        if n >= 1e9:  return f"{n/1e9:.2f}B"
        if n >= 1e6:  return f"{n/1e6:.1f}M"
        if n >= 1e3:  return f"{n/1e3:.1f}K"
        return str(int(n))

    # 1. FMP: quote (price/H/L/52w/vol/mcap) + profile (avgVol/shares/beta) in parallel
    try:
        tk = ticker.upper()
        BASE = "https://financialmodelingprep.com/stable"
        def _fq(): return _req.get(f"{BASE}/quote?symbol={tk}&apikey={FMP_KEY}", timeout=10).json()
        def _fp(): return _req.get(f"{BASE}/profile?symbol={tk}&apikey={FMP_KEY}", timeout=10).json()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fq_fut = pool.submit(_fq); fp_fut = pool.submit(_fp)
            fq = fq_fut.result(); fp = fp_fut.result()
        q = fq[0] if isinstance(fq, list) and fq else {}
        p = fp[0] if isinstance(fp, list) and fp else {}
        if q.get("price"):
            # Earnings date still from yfinance (FMP tier doesn't have it)
            earnings_date = None
            try:
                t_yf = yf.Ticker(tk)
                cal   = t_yf.calendar
                ed    = cal.get("Earnings Date") if cal else None
                if ed:
                    raw = ed[0] if isinstance(ed, (list, tuple)) else ed
                    earnings_date = pd.Timestamp(raw).strftime("%b %d, %Y")
            except Exception:
                pass
            return {
                "currentPrice": round(float(q["price"]), 2),
                "prevClose":    round(float(q.get("previousClose") or q["price"]), 2),
                "dayLow":       round(float(q.get("dayLow")  or 0), 2),
                "dayHigh":      round(float(q.get("dayHigh") or 0), 2),
                "w52Low":       round(float(q.get("yearLow")  or 0), 2),
                "w52High":      round(float(q.get("yearHigh") or 0), 2),
                "bid":          0.0,   # not available on this FMP tier
                "ask":          0.0,
                "volume":       fmt_large(q.get("volume")),
                "avgVolume":    fmt_large(p.get("averageVolume") or q.get("averageVolume")),
                "marketCap":    fmt_large(q.get("marketCap")),
                "shares":       fmt_large(p.get("sharesOutstanding")),
                "earningsDate": earnings_date,
            }
    except Exception:
        pass

    # 2. yfinance fallback
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

    # ── PE vs Fair PE ────────────────────────────────────────────
    # Fair PE = what the PE would be at the analyst target price, using current EPS
    # i.e. fairPE = trailingPE × (analystTarget / currentPrice)
    current_pe_raw = info.get("trailingPE")
    fair_pe_val    = None
    try:
        if current_pe_raw and current_price and fair_value:
            fair_pe_val = round(float(current_pe_raw) * float(fair_value) / current_price, 1)
    except Exception:
        pass

    # ── Key Valuation Metrics (ratios from yFinance, fundamentals from EDGAR) ──
    key_metrics = {}
    try:
        # Ratios — yFinance has these as trailing/current values
        pe       = info.get("trailingPE")
        ps       = info.get("priceToSalesTrailing12Months")
        pb       = info.get("priceToBook")
        ev_ebitda = info.get("enterpriseToEbitda")
        mkt_cap  = info.get("marketCap")

        # Fundamentals — pull from EDGAR (most recent annual record)
        edgar_recs = _edgar_annual_records(ticker.upper())
        latest     = sorted(edgar_recs, key=lambda r: r["end_date"], reverse=True)[0] \
                     if edgar_recs else {}

        net_inc    = latest.get("net_inc")
        revenue    = latest.get("rev")
        equity     = latest.get("equity")
        ebitda     = latest.get("ebitda")
        edgar_shares = latest.get("shares")

        # Derive missing ratios from EDGAR fundamentals + current price
        if not pe and net_inc and edgar_shares and edgar_shares > 0:
            eps = net_inc / edgar_shares
            if eps > 0: pe = current_price / eps
        if not ps and revenue and edgar_shares and edgar_shares > 0:
            rps = revenue / edgar_shares
            if rps > 0: ps = current_price / rps
        if not pb and equity and edgar_shares and edgar_shares > 0:
            bvps = equity / edgar_shares
            if bvps > 0: pb = current_price / bvps

        def _r1(v): return round(float(v), 1) if v is not None else None
        def _ri(v): return int(v) if v is not None else None

        key_metrics = {
            "pe":        _r1(pe),
            "ps":        _r1(ps),
            "pb":        _r1(pb),
            "evEbitda":  _r1(ev_ebitda),
            "marketCap": _ri(mkt_cap),
            "earnings":  _ri(net_inc),
            "revenue":   _ri(revenue),
            "bookValue": _ri(equity),
            "ebitda":    _ri(ebitda),
        }
    except Exception:
        pass

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
        "keyMetrics":    key_metrics,
        "currentPE":     round(float(current_pe_raw), 1) if current_pe_raw else None,
        "fairPE":        fair_pe_val,
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

# Income rows: (yf_key, label, indent, fmt, bold, group_id, parent_group)
# group_id   → this row is a collapsible section header with this id
# parent_group → this row is a child of the named section header
_INCOME_ROWS = [
    ("Total Revenue",                                       "Total Revenue",                        False, "currency", True,  "grp_revenue",   None),
    ("Operating Revenue",                                   "Operating Revenue",                    True,  "currency", False, None,            "grp_revenue"),
    ("Cost Of Revenue",                                     "Cost of Revenue",                      False, "currency", False, None,            None),
    ("Gross Profit",                                        "Gross Profit",                         False, "currency", True,  None,            None),
    ("Operating Expense",                                   "Operating Expense",                    False, "currency", True,  "grp_opex",      None),
    ("Research And Development",                            "Research & Development",               True,  "currency", False, None,            "grp_opex"),
    ("Selling General And Administration",                  "SG&A",                                 True,  "currency", False, None,            "grp_opex"),
    ("Operating Income",                                    "Operating Income",                     False, "currency", True,  None,            None),
    ("Net Non Operating Interest Income Expense",           "Net Non-Operating Interest",           False, "currency", False, "grp_nonop",     None),
    ("Interest Income Non Operating",                       "Interest Income",                      True,  "currency", False, None,            "grp_nonop"),
    ("Interest Expense Non Operating",                      "Interest Expense",                     True,  "currency", False, None,            "grp_nonop"),
    ("Other Income Expense",                                "Other Income / Expense",               False, "currency", False, "grp_other",     None),
    ("Other Non Operating Income Expenses",                 "Other Non-Operating Income",           True,  "currency", False, None,            "grp_other"),
    ("Pretax Income",                                       "Pretax Income",                        False, "currency", True,  None,            None),
    ("Tax Provision",                                       "Tax Provision",                        True,  "currency", False, None,            None),
    ("Net Income Common Stockholders",                      "Net Income Common Stockholders",       False, "currency", True,  "grp_netincome", None),
    ("Net Income",                                          "Net Income",                           True,  "currency", False, None,            "grp_netincome"),
    ("Net Income Including Noncontrolling Interests",       "Net Income incl. Minority Interest",   True,  "currency", False, None,            "grp_netincome"),
    ("Net Income Continuous Operations",                    "Net Income from Cont. Ops",            True,  "currency", False, None,            "grp_netincome"),
    ("Diluted NI Availto Com Stockholders",                 "Diluted NI Avail. to Stockholders",   True,  "currency", False, None,            "grp_netincome"),
    ("Basic EPS",                                           "Basic EPS",                            False, "eps",      False, None,            None),
    ("Diluted EPS",                                         "Diluted EPS",                          False, "eps",      False, None,            None),
    ("Basic Average Shares",                                "Basic Average Shares",                 False, "shares",   False, None,            None),
    ("Diluted Average Shares",                              "Diluted Average Shares",               False, "shares",   False, None,            None),
    ("Total Operating Income As Reported",                  "Total Operating Income As Reported",   False, "currency", False, None,            None),
    ("Total Expenses",                                      "Total Expenses",                       False, "currency", False, None,            None),
    ("Net Income From Continuing And Discontinued Operation","Net Income from Cont. & Disc. Ops",  False, "currency", False, None,            None),
    ("Normalized Income",                                   "Normalized Income",                    False, "currency", False, None,            None),
    ("Interest Income",                                     "Interest Income",                      False, "currency", False, None,            None),
    ("Interest Expense",                                    "Interest Expense",                     False, "currency", False, None,            None),
    ("Net Interest Income",                                 "Net Interest Income",                  False, "currency", False, None,            None),
    ("EBIT",                                                "EBIT",                                 False, "currency", False, None,            None),
    ("EBITDA",                                              "EBITDA",                               False, "currency", False, None,            None),
    ("Reconciled Cost Of Revenue",                          "Reconciled Cost of Revenue",           False, "currency", False, None,            None),
    ("Reconciled Depreciation",                             "Reconciled Depreciation",              False, "currency", False, None,            None),
    ("Net Income From Continuing Operation Net Minority Interest", "Net Income from Cont. Ops (Net MI)", False, "currency", False, None,     None),
    ("Normalized EBITDA",                                   "Normalized EBITDA",                    False, "currency", False, None,            None),
    ("Tax Rate For Calcs",                                  "Tax Rate for Calcs",                   False, "pct",      False, None,            None),
    ("Tax Effect Of Unusual Items",                         "Tax Effect of Unusual Items",          False, "currency", False, None,            None),
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
    ("Financing Cash Flow", "Financing Cash Flow", False, "currency", False),
    ("Investing Cash Flow", "Investing Cash Flow", False, "currency", False),
    ("Changes In Cash",     "Net Change in Cash",  False, "currency", False),
    ("Capital Expenditure", "Capital Expenditure", True,  "currency", False),
    ("Free Cash Flow",      "Free Cash Flow",      False, "currency", True),
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
    if fmt_type == "pct":
        return f"{v*100:.1f}%" if abs(v) <= 1 else f"{v:.1f}%"
    if fmt_type == "shares":
        av = abs(v)
        if   av >= 1e9: s = f"{av/1e9:.2f}B"
        elif av >= 1e6: s = f"{av/1e6:.1f}M"
        elif av >= 1e3: s = f"{av/1e3:.0f}K"
        else:           s = f"{av:.0f}"
        return f"({s})" if v < 0 else s
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
    for row_def in row_defs:
        if len(row_def) == 7:
            key, label, indent, fmt, bold, group_id, parent_group = row_def
        else:
            key, label, indent, fmt, bold = row_def
            group_id, parent_group = None, None
        if key in df.index:
            raw_vals  = [df.loc[key, c] for c in cols]
            formatted = [_fmt_fin(v, fmt) for v in raw_vals]
            raw_nums  = [None if (v is None or (isinstance(v, float) and math.isnan(v)))
                         else float(v) for v in raw_vals]
        else:
            formatted = ["—"] * len(cols); raw_nums = [None] * len(cols)
        rows.append({
            "label":       label,
            "indent":      indent,
            "bold":        bold,
            "groupId":     group_id,
            "parentGroup": parent_group,
            "values":      formatted,
            "raw":         raw_nums,
        })

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

    # 2. FMP — clean, consistent data for all company types
    try:
        result = _fmp_financials(ticker, statement, freq)
        if result:
            return result
    except Exception:
        pass

    # 3. SEC EDGAR — annual only fallback
    if freq == "annual":
        try:
            records = _edgar_annual_records(ticker.upper())
            result  = _edgar_build_financials(records, statement)
            if result:
                return result
        except Exception:
            pass

    # 4. yfinance — last resort
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
    xml = _ibkr_xml(ticker, "ReportsFinStatements")
    if xml:
        ibkr_recs = _ibkr_annual_records(xml)
        if ibkr_recs:
            hist = yf.Ticker(ticker.upper()).history(period="12y", interval="1d", auto_adjust=True)
            def _price_at(d):
                try:
                    cutoff = pd.Timestamp(d).date()
                    sub = hist[hist.index.date <= cutoff]
                    return float(sub["Close"].iloc[-1]) if not sub.empty else None
                except Exception:
                    return None
            periods = [r["year"] for r in ibkr_recs]
            prices  = [_price_at(r["end_date"]) for r in ibkr_recs]
            result  = _compute_ratios(periods, ibkr_recs, prices)
            result["source"] = "ibkr"
            return result

    # 2. FMP key-metrics — clean ratios for all company types
    try:
        result = _fmp_ratios(ticker)
        if result:
            return result
    except Exception:
        pass

    # 3. SEC EDGAR + computed ratios
    records = []
    try:
        records = _edgar_annual_records(ticker.upper())
    except Exception:
        pass

    # 4. yfinance fallback
    if not records:
        try:
            records = _yfinance_annual_records(yf.Ticker(ticker.upper()))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    if not records:
        raise HTTPException(status_code=404, detail="Insufficient financial data")

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
    result  = _compute_ratios(periods, records, prices)
    result["source"] = "edgar"
    return result



# ─── FMP ─────────────────────────────────────────────────────────────────────
FMP_KEY       = "2c8007ad9aea11afba28af5b915d2918"
_peers_cache: dict[str, dict] = {}
_fmp_fin_cache: dict = {}           # key → {ts, data}
_FMP_FIN_TTL  = 3600                # 1 hour

# ── Sector ETF → industry averages cache ─────────────────────────
_etf_industry_cache: dict = {}   # etf_symbol → {ts, roe, roic, roa}
_ETF_INDUSTRY_TTL = 21600        # 6 hours

# FMP sector string → SPDR sector ETF
_SECTOR_ETF_MAP = {
    "Technology":              "XLK",
    "Healthcare":              "XLV",
    "Financials":              "XLF",
    "Financial Services":      "XLF",
    "Consumer Cyclical":       "XLY",
    "Consumer Defensive":      "XLP",
    "Energy":                  "XLE",
    "Utilities":               "XLU",
    "Basic Materials":         "XLB",
    "Industrials":             "XLI",
    "Real Estate":             "XLRE",
    "Communication Services":  "XLC",
}

def _fetch_etf_sector_averages(sector: str) -> dict:
    """Return median ROE/ROIC/ROA for the sector using top large-cap companies via screener."""
    import concurrent.futures as _cf

    cached = _etf_industry_cache.get(sector)
    if cached and (time.time() - cached["ts"]) < _ETF_INDUSTRY_TTL:
        return cached

    try:
        # Get top 15 large-cap companies in the sector
        screen_url = (
            f"https://financialmodelingprep.com/stable/company-screener"
            f"?sector={sector}&marketCapMoreThan=5000000000&limit=15&apikey={FMP_KEY}"
        )
        screened = _req.get(screen_url, timeout=8).json() or []
        syms = [c["symbol"] for c in screened if c.get("symbol")][:15]

        if not syms:
            return {}

        def _km(sym):
            try:
                url = (f"https://financialmodelingprep.com/stable/key-metrics-ttm"
                       f"?symbol={sym}&apikey={FMP_KEY}")
                d = _req.get(url, timeout=8).json()
                return d[0] if d and isinstance(d, list) and d[0] else {}
            except Exception:
                return {}

        with _cf.ThreadPoolExecutor(max_workers=8) as ex:
            results = list(ex.map(_km, syms))

        def _median(vals):
            s = sorted(vals)
            n = len(s)
            if not n:
                return None
            return round(s[n // 2] if n % 2 else (s[n//2 - 1] + s[n//2]) / 2, 1)

        roe_vals  = [float(x["returnOnEquityTTM"])          * 100 for x in results if x.get("returnOnEquityTTM")          is not None]
        roic_vals = [float(x["returnOnInvestedCapitalTTM"]) * 100 for x in results if x.get("returnOnInvestedCapitalTTM") is not None]
        roa_vals  = [float(x["returnOnAssetsTTM"])          * 100 for x in results if x.get("returnOnAssetsTTM")          is not None]

        result = {
            "ts":   time.time(),
            "roe":  _median(roe_vals),
            "roic": _median(roic_vals),
            "roa":  _median(roa_vals),
        }
        _etf_industry_cache[sector] = result
        return result
    except Exception:
        return {}

# ── Shared company stats cache (profile + quote + TTM metrics + growth) ────────
_fmp_stats_cache: dict = {}   # ticker → {ts, data}
_FMP_STATS_TTL = 3600         # 1 hour


def _fmp_company_stats(ticker: str) -> dict:
    """Fetch and merge 5 FMP endpoints in parallel, return a single flat dict.

    Endpoints:
      stable/profile        → name, logo (image), CEO, sector, exchange,
                               employees, website, description, ipoDate,
                               averageVolume, beta, country
      stable/quote          → price, change, changePercentage, dayHigh/Low,
                               yearHigh/Low, marketCap, volume, previousClose
      stable/key-metrics-ttm→ returnOnEquityTTM, returnOnAssetsTTM,
                               returnOnInvestedCapitalTTM, currentRatioTTM,
                               assetTurnoverTTM*, salesGAToRevenueTTM, RDToRevTTM,
                               investedCapitalTTM, workingCapitalTTM, …
      stable/ratios-ttm     → grossProfitMarginTTM, netProfitMarginTTM,
                               operatingProfitMarginTTM, debtToEquityRatioTTM,
                               currentRatioTTM, quickRatioTTM,
                               interestCoverageRatioTTM, priceToEarningsRatioTTM,
                               priceToBookRatioTTM, …
      stable/financial-growth→ revenueGrowth, netIncomeGrowth, epsgrowth,
                               freeCashFlowGrowth, bookValueperShareGrowth,
                               dividendsPerShareGrowth, fiveYRevenueGrowthPerShare, …

    Result is cached for 1 hour per ticker. Returns {} on complete failure.
    """
    tk = ticker.upper()
    cached = _fmp_stats_cache.get(tk)
    if cached and time.time() - cached["ts"] < _FMP_STATS_TTL:
        return cached["data"]

    BASE = "https://financialmodelingprep.com/stable"

    def _get(path):
        try:
            r = _req.get(f"{BASE}/{path}&apikey={FMP_KEY}", timeout=12)
            if r.ok:
                d = r.json()
                return d[0] if isinstance(d, list) and d else (d if isinstance(d, dict) else {})
        except Exception:
            pass
        return {}

    tasks = [
        lambda: ("profile",  _get(f"profile?symbol={tk}")),
        lambda: ("quote",    _get(f"quote?symbol={tk}")),
        lambda: ("km_ttm",   _get(f"key-metrics-ttm?symbol={tk}")),
        lambda: ("rat_ttm",  _get(f"ratios-ttm?symbol={tk}")),
        lambda: ("growth",   _get(f"financial-growth?symbol={tk}&period=annual&limit=1")),
    ]

    raw: dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(fn) for fn in tasks]
        for fut in concurrent.futures.as_completed(futures):
            try:
                key, val = fut.result()
                raw[key] = val
            except Exception:
                pass

    # Merge all dicts into one flat namespace (later keys override earlier on conflict)
    merged: dict = {}
    for part in ("profile", "quote", "km_ttm", "rat_ttm", "growth"):
        merged.update(raw.get(part, {}))

    _fmp_stats_cache[tk] = {"ts": time.time(), "data": merged}
    return merged

# Income Statement: (fmp_key, label, indent, fmt, bold, group_id, parent_group)
# fmp_key starting with "__yoy:" → compute YoY % growth from the named field's values.
_FMP_INCOME_ROWS = [
    ("revenue",                                  "Revenue",                      False, "currency", True,  "grp_revenue",   None),
    ("__yoy:revenue",                            "Revenue Growth (YoY)",         True,  "pct",      False, None,            "grp_revenue"),
    ("costOfRevenue",                            "Cost of Revenue",              False, "currency", False, None,            None),
    ("grossProfit",                              "Gross Profit",                 False, "currency", True,  None,            None),
    ("sellingGeneralAndAdministrativeExpenses",  "Selling, General & Admin",     False, "currency", False, None,            None),
    ("researchAndDevelopmentExpenses",           "Research & Development",       False, "currency", False, None,            None),
    ("otherExpenses",                            "Other Operating Expenses",     False, "currency", False, None,            None),
    ("operatingExpenses",                        "Total Operating Expenses",     False, "currency", False, None,            None),
    ("operatingIncome",                          "Operating Income",             False, "currency", True,  None,            None),
    ("totalOtherIncomeExpensesNet",              "Total Non-Operating Income",   False, "currency", False, None,            None),
    ("incomeBeforeTax",                          "Pretax Income",                False, "currency", True,  None,            None),
    ("incomeTaxExpense",                         "Provision for Income Taxes",   False, "currency", False, None,            None),
    ("netIncome",                                "Net Income",                   False, "currency", False, None,            None),
    ("bottomLineNetIncome",                      "Net Income to Common",         False, "currency", True,  "grp_netincome", None),
    ("__yoy:bottomLineNetIncome",                "Net Income Growth",            True,  "pct",      False, None,            "grp_netincome"),
    ("weightedAverageShsOut",                    "Shares Outstanding (Basic)",   False, "shares",   False, "grp_shares",    None),
    ("weightedAverageShsOutDil",                 "Shares Outstanding (Diluted)", False, "shares",   True,  None,            None),
    ("__yoy:weightedAverageShsOutDil",           "Shares Change (YoY)",          True,  "pct",      False, None,            None),
    ("eps",                                      "EPS (Basic)",                  False, "eps",      False, None,            None),
    ("epsDiluted",                               "EPS (Diluted)",                False, "eps",      True,  "grp_eps",       None),
    ("__yoy:epsDiluted",                         "EPS Growth",                   True,  "pct",      False, None,            "grp_eps"),
]

# Balance Sheet: (fmp_key, label, indent, fmt, bold)
_FMP_BALANCE_ROWS = [
    # ── Current Assets ──────────────────────────────────────────────────────────
    ("cashAndCashEquivalents",                  "Cash & Equivalents",                     False, "currency", False, None,           None),
    ("shortTermInvestments",                    "Short-Term Investments",                 False, "currency", False, None,           None),
    ("cashAndShortTermInvestments",             "Cash & Short-Term Investments",          False, "currency", True,  "grp_cash",     None),
    ("__yoy:cashAndShortTermInvestments",       "Cash Growth",                            True,  "pct",      False, None,           "grp_cash"),
    ("accountsReceivables",                     "Accounts Receivable",                    False, "currency", False, None,           None),
    ("otherReceivables",                        "Other Receivables",                      False, "currency", False, None,           None),
    ("netReceivables",                          "Total Trade Receivables",                False, "currency", False, None,           None),
    ("inventory",                               "Inventory",                              False, "currency", False, None,           None),
    ("otherCurrentAssets",                      "Other Current Assets",                   False, "currency", False, None,           None),
    ("totalCurrentAssets",                      "Total Current Assets",                   False, "currency", True,  None,           None),
    # ── Non-Current Assets ─────────────────────────────────────────────────────
    ("propertyPlantEquipmentNet",               "Net Property, Plant & Equipment",        False, "currency", False, None,           None),
    ("goodwillAndIntangibleAssets",             "Other Intangible Assets",                False, "currency", False, None,           None),
    ("longTermInvestments",                     "Long-Term Investments",                  False, "currency", False, None,           None),
    ("otherNonCurrentAssets",                   "Other Long-Term Assets",                 False, "currency", False, None,           None),
    ("totalAssets",                             "Total Assets",                           False, "currency", True,  None,           None),
    # ── Current Liabilities ────────────────────────────────────────────────────
    ("accountPayables",                         "Accounts Payable",                       False, "currency", False, None,           None),
    ("shortTermDebt",                           "Short-Term Debt",                        False, "currency", False, None,           None),
    ("capitalLeaseObligationsCurrent",          "Current Portion of Long-Term Debt",      False, "currency", False, None,           None),
    ("deferredRevenue",                         "Unearned Revenue",                       False, "currency", False, None,           None),
    ("otherCurrentLiabilities",                 "Other Current Liabilities",              False, "currency", False, None,           None),
    ("totalCurrentLiabilities",                 "Total Current Liabilities",              False, "currency", True,  None,           None),
    # ── Non-Current Liabilities ────────────────────────────────────────────────
    ("longTermDebt",                            "Long-Term Debt",                         False, "currency", False, None,           None),
    ("otherNonCurrentLiabilities",              "Other Long-Term Liabilities",            False, "currency", False, None,           None),
    ("totalNonCurrentLiabilities",              "Total Long-Term Liabilities",            False, "currency", False, None,           None),
    ("totalLiabilities",                        "Total Liabilities",                      False, "currency", True,  None,           None),
    # ── Equity ─────────────────────────────────────────────────────────────────
    ("commonStock",                             "Common Stock",                           False, "currency", False, None,           None),
    ("accumulatedOtherComprehensiveIncomeLoss", "Accumulated Other Comprehensive Income", False, "currency", False, None,           None),
    ("retainedEarnings",                        "Retained Earnings",                      False, "currency", False, None,           None),
    ("totalStockholdersEquity",                 "Shareholders' Equity",                   False, "currency", True,  None,           None),
    ("totalLiabilitiesAndTotalEquity",          "Total Liabilities & Equity",             False, "currency", False, None,           None),
    # ── Supplemental ───────────────────────────────────────────────────────────
    ("totalDebt",                               "Total Debt",                             False, "currency", True,  None,           None),
    ("__neg:netDebt",                           "Net Cash (Debt)",                        False, "currency", True,  "grp_netcash",  None),
    ("__yoy:__neg:netDebt",                     "Net Cash Growth",                        True,  "pct",      False, None,           "grp_netcash"),
    ("__ratios:cashPerShare",                   "Net Cash Per Share",                     False, "eps",      False, None,           None),
    ("totalStockholdersEquity",                 "Book Value",                             False, "currency", False, None,           None),
    ("__ratios:bookValuePerShare",              "Book Value Per Share",                   False, "eps",      False, None,           None),
    ("__sub:totalStockholdersEquity:goodwillAndIntangibleAssets", "Tangible Book Value",  False, "currency", False, None,           None),
    ("__ratios:tangibleBookValuePerShare",      "Tangible Book Value Per Share",          False, "eps",      False, None,           None),
]

# Cash Flow Statement
_FMP_CASHFLOW_ROWS = [
    # ── Operating Activities ────────────────────────────────────────────────────
    ("netIncome",                             "Net Income",                            False, "currency", False, None,        None),
    ("depreciationAndAmortization",           "Depreciation & Amortization",           False, "currency", False, None,        None),
    ("stockBasedCompensation",                "Stock-Based Compensation",              False, "currency", False, None,        None),
    ("otherNonCashItems",                     "Other Adjustments",                     False, "currency", False, None,        None),
    ("accountsReceivables",                   "Change in Receivables",                 False, "currency", False, None,        None),
    ("inventory",                             "Changes in Inventories",                False, "currency", False, None,        None),
    ("accountsPayables",                      "Changes in Accounts Payable",           False, "currency", False, None,        None),
    ("otherWorkingCapital",                   "Changes in Other Operating Assets",     False, "currency", False, None,        None),
    ("operatingCashFlow",                     "Operating Cash Flow",                   False, "currency", True,  "grp_ocf",   None),
    ("__yoy:operatingCashFlow",               "Operating Cash Flow Growth",            True,  "pct",      False, None,        "grp_ocf"),
    # ── Investing Activities ────────────────────────────────────────────────────
    ("capitalExpenditure",                    "Capital Expenditures",                  False, "currency", False, None,        None),
    ("purchasesOfInvestments",                "Purchases of Investments",              False, "currency", False, None,        None),
    ("salesMaturitiesOfInvestments",          "Proceeds from Sale of Investments",     False, "currency", False, None,        None),
    ("otherInvestingActivities",              "Other Investing Activities",            False, "currency", False, None,        None),
    ("netCashProvidedByInvestingActivities",  "Investing Cash Flow",                   False, "currency", True,  None,        None),
    # ── Financing Activities ────────────────────────────────────────────────────
    ("shortTermNetDebtIssuance",              "Net Short-Term Debt Issued (Repaid)",   False, "currency", False, None,        None),
    ("longTermNetDebtIssuance",               "Net Long-Term Debt Issued (Repaid)",    False, "currency", False, None,        None),
    ("commonStockRepurchased",                "Repurchase of Common Stock",            False, "currency", False, None,        None),
    ("netCommonStockIssuance",                "Net Common Stock Issued (Repurchased)", False, "currency", False, None,        None),
    ("commonDividendsPaid",                   "Common Dividends Paid",                 False, "currency", False, None,        None),
    ("otherFinancingActivities",              "Other Financing Activities",            False, "currency", False, None,        None),
    ("netCashProvidedByFinancingActivities",  "Financing Cash Flow",                   False, "currency", True,  None,        None),
    # ── Summary ────────────────────────────────────────────────────────────────
    ("netChangeInCash",                       "Net Cash Flow",                         False, "currency", True,  None,        None),
    ("freeCashFlow",                          "Free Cash Flow",                        False, "currency", True,  "grp_fcf",   None),
    ("__yoy:freeCashFlow",                    "Free Cash Flow Growth",                 True,  "pct",      False, None,        "grp_fcf"),
    ("__fcfmargin",                           "FCF Margin",                            False, "pct",      False, None,        None),
    ("__ratios:freeCashFlowPerShare",         "Free Cash Flow Per Share",              False, "eps",      False, None,        None),
    ("__keymetrics:freeCashFlowToEquity",     "Levered Free Cash Flow",                False, "currency", False, None,        None),
    ("__keymetrics:freeCashFlowToFirm",       "Unlevered Free Cash Flow",              False, "currency", False, None,        None),
]

# Income: epsDiluted field name differs from v3 (epsdiluted → epsDiluted in stable)
# (epsDiluted field name is consistent across FMP stable API versions)


def _fmp_financials(ticker: str, statement: str, freq: str):
    """Fetch income / balance / cashflow from FMP stable API. Returns {periods, rows, source}."""
    cache_key = f"{ticker}:{statement}:{freq}"
    cached = _fmp_fin_cache.get(cache_key)
    if cached and time.time() - cached["ts"] < _FMP_FIN_TTL:
        return cached["data"]

    ep = {"income": "income-statement",
          "balance": "balance-sheet-statement",
          "cashflow": "cash-flow-statement"}.get(statement)
    if not ep:
        return None

    period_param = "annual" if freq == "annual" else "quarter"
    url = (f"https://financialmodelingprep.com/stable/{ep}"
           f"?symbol={ticker.upper()}&period={period_param}&limit=10&apikey={FMP_KEY}")
    r = _req.get(url, timeout=12)
    r.raise_for_status()
    items = r.json()
    if not items or not isinstance(items, list):
        return None

    # Filter to correct period type in case API returns mixed
    target = "FY" if freq == "annual" else None
    if target:
        items = [it for it in items if it.get("period") == target] or items

    if freq == "annual":
        periods = [str(it.get("fiscalYear") or it["date"][:4]) for it in items]
    else:
        periods = [f"{it.get('period','Q?')} '{it['date'][2:4]}" for it in items]

    row_defs = {"income": _FMP_INCOME_ROWS,
                "balance": _FMP_BALANCE_ROWS,
                "cashflow": _FMP_CASHFLOW_ROWS}[statement]

    # For balance sheet + cash flow, fetch auxiliary endpoints for per-share / computed metrics
    ratios_by_pos     = [{} for _ in items]
    keymetrics_by_pos = [{} for _ in items]
    income_by_pos     = [{} for _ in items]

    def _aux_fetch(ep_name):
        """Fetch an auxiliary FMP endpoint and return a date→row dict."""
        try:
            url_x = (f"https://financialmodelingprep.com/stable/{ep_name}"
                     f"?symbol={ticker.upper()}&period={period_param}&limit=10&apikey={FMP_KEY}")
            rx = _req.get(url_x, timeout=12)
            if rx.ok:
                data = rx.json()
                if target:
                    data = [x for x in data if x.get("period") == target] or data
                return {x.get("date", "")[:10]: x for x in data}
        except Exception:
            pass
        return {}

    if statement == "balance":
        ratios_by_date = _aux_fetch("ratios")
        for idx, it in enumerate(items):
            ratios_by_pos[idx] = ratios_by_date.get((it.get("date") or "")[:10], {})

    elif statement == "cashflow":
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            fut_ratios = pool.submit(_aux_fetch, "ratios")
            fut_km     = pool.submit(_aux_fetch, "key-metrics")
            fut_income = pool.submit(_aux_fetch, "income-statement")
        ratios_by_date = fut_ratios.result()
        km_by_date     = fut_km.result()
        income_by_date = fut_income.result()
        for idx, it in enumerate(items):
            date_key = (it.get("date") or "")[:10]
            ratios_by_pos[idx]     = ratios_by_date.get(date_key, {})
            keymetrics_by_pos[idx] = km_by_date.get(date_key, {})
            income_by_pos[idx]     = income_by_date.get(date_key, {})

    # Build a lookup of raw values by fmp_key for YoY / computed rows
    raw_by_key: dict = {}

    rows = []
    for row_def in row_defs:
        if len(row_def) == 7:
            fmp_key, label, indent, fmt, bold, group_id, parent_group = row_def
        else:
            fmp_key, label, indent, fmt, bold = row_def
            group_id, parent_group = None, None

        # ── Negated field  __neg:fieldName ───────────────────────────────
        if fmp_key.startswith("__neg:"):
            src_key = fmp_key[6:]
            if src_key in raw_by_key:
                src_raw = raw_by_key[src_key]
            else:
                # Field not yet seen as a row — pull directly from items
                src_raw = []
                for it in items:
                    v = it.get(src_key)
                    src_raw.append(float(v) if v is not None else None)
                raw_by_key[src_key] = src_raw
            raw_vals = [(-v if v is not None else None) for v in src_raw]
            raw_by_key[fmp_key] = raw_vals
            formatted = [_fmt_fin(v, fmt) for v in raw_vals]
            rows.append({
                "label": label, "indent": indent, "bold": bold,
                "groupId": group_id, "parentGroup": parent_group,
                "values": formatted, "raw": raw_vals,
            })
            continue

        # ── Ratios field  __ratios:fieldName ─────────────────────────────
        if fmp_key.startswith("__ratios:"):
            field = fmp_key[9:]
            raw_vals = []
            for rd in ratios_by_pos:
                v = rd.get(field)
                raw_vals.append(float(v) if v is not None else None)
            raw_by_key[fmp_key] = raw_vals
            formatted = [_fmt_fin(v, fmt) for v in raw_vals]
            rows.append({
                "label": label, "indent": indent, "bold": bold,
                "groupId": group_id, "parentGroup": parent_group,
                "values": formatted, "raw": raw_vals,
            })
            continue

        # ── Key-metrics field  __keymetrics:fieldName ────────────────────
        if fmp_key.startswith("__keymetrics:"):
            field = fmp_key[13:]
            raw_vals = []
            for km in keymetrics_by_pos:
                v = km.get(field)
                raw_vals.append(float(v) if v is not None else None)
            raw_by_key[fmp_key] = raw_vals
            formatted = [_fmt_fin(v, fmt) for v in raw_vals]
            rows.append({
                "label": label, "indent": indent, "bold": bold,
                "groupId": group_id, "parentGroup": parent_group,
                "values": formatted, "raw": raw_vals,
            })
            continue

        # ── FCF Margin  __fcfmargin  (freeCashFlow / revenue × 100) ──────
        if fmp_key == "__fcfmargin":
            fcf_raw = raw_by_key.get("freeCashFlow", [None] * len(items))
            growth_vals = []
            growth_raw  = []
            for i, fcf in enumerate(fcf_raw):
                rev = income_by_pos[i].get("revenue") if i < len(income_by_pos) else None
                if fcf is not None and rev not in (None, 0):
                    pct = fcf / float(rev) * 100
                    growth_vals.append(f"{'+' if pct >= 0 else ''}{pct:.1f}%")
                    growth_raw.append(pct)
                else:
                    growth_vals.append("—")
                    growth_raw.append(None)
            rows.append({
                "label": label, "indent": indent, "bold": bold,
                "groupId": group_id, "parentGroup": parent_group,
                "values": growth_vals, "raw": growth_raw,
                "isGrowthRow": True,
            })
            continue

        # ── Subtracted field  __sub:fieldA:fieldB  (A - B) ───────────────
        if fmp_key.startswith("__sub:"):
            parts = fmp_key[6:].split(":", 1)
            key_a, key_b = parts[0], parts[1]
            raw_a = raw_by_key.get(key_a, [None] * len(items))
            raw_b = raw_by_key.get(key_b, [None] * len(items))
            raw_vals = []
            for a, b in zip(raw_a, raw_b):
                raw_vals.append((a - b) if (a is not None and b is not None) else None)
            raw_by_key[fmp_key] = raw_vals
            formatted = [_fmt_fin(v, fmt) for v in raw_vals]
            rows.append({
                "label": label, "indent": indent, "bold": bold,
                "groupId": group_id, "parentGroup": parent_group,
                "values": formatted, "raw": raw_vals,
            })
            continue

        # ── Computed YoY growth row ───────────────────────────────────────
        if fmp_key.startswith("__yoy:"):
            src_key = fmp_key[6:]
            src_raw = raw_by_key.get(src_key, [])
            growth_vals = []
            growth_raw  = []
            for i, v in enumerate(src_raw):
                prev = src_raw[i + 1] if i + 1 < len(src_raw) else None
                if v is not None and prev not in (None, 0):
                    pct = (v - prev) / abs(prev) * 100
                    growth_vals.append(f"{'+' if pct >= 0 else ''}{pct:.1f}%")
                    growth_raw.append(pct)
                else:
                    growth_vals.append("—")
                    growth_raw.append(None)
            rows.append({
                "label": label, "indent": indent, "bold": bold,
                "groupId": group_id, "parentGroup": parent_group,
                "values": growth_vals, "raw": growth_raw,
                "isGrowthRow": True,
            })
            continue

        # ── Regular FMP field row ─────────────────────────────────────────
        raw_vals = []
        for it in items:
            v = it.get(fmp_key)
            raw_vals.append(float(v) if v is not None else None)

        # capitalExpenditure is a cash outflow — keep FMP's native negative sign

        raw_by_key[fmp_key] = raw_vals

        formatted = [_fmt_fin(v, fmt) for v in raw_vals]
        rows.append({
            "label": label, "indent": indent, "bold": bold,
            "groupId": group_id, "parentGroup": parent_group,
            "values": formatted, "raw": raw_vals,
        })

    result = {"periods": periods, "rows": rows, "source": "fmp"}
    _fmp_fin_cache[cache_key] = {"ts": time.time(), "data": result}
    return result


def _fmp_ratios(ticker: str):
    """Fetch ratios from 5 FMP endpoints in parallel. Returns {periods, sections, source}."""
    cache_key = f"{ticker}:ratios"
    cached = _fmp_fin_cache.get(cache_key)
    if cached and time.time() - cached["ts"] < _FMP_FIN_TTL:
        return cached["data"]

    sym = ticker.upper()

    def _fetch(ep):
        try:
            url = (f"https://financialmodelingprep.com/stable/{ep}"
                   f"?symbol={sym}&period=annual&limit=10&apikey={FMP_KEY}")
            rx = _req.get(url, timeout=12)
            if rx.ok:
                data = rx.json()
                fy = [x for x in data if x.get("period") == "FY"] or data
                return {x.get("date", "")[:10]: x for x in fy}
        except Exception:
            pass
        return {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        fut_r  = pool.submit(_fetch, "ratios")
        fut_km = pool.submit(_fetch, "key-metrics")
        fut_is = pool.submit(_fetch, "income-statement")
        fut_bs = pool.submit(_fetch, "balance-sheet-statement")
        fut_cf = pool.submit(_fetch, "cash-flow-statement")

    r_by_date  = fut_r.result()
    km_by_date = fut_km.result()
    is_by_date = fut_is.result()
    bs_by_date = fut_bs.result()
    cf_by_date = fut_cf.result()

    dates = sorted(r_by_date.keys(), reverse=True)[:10]
    if not dates:
        return None

    # Merge all sources per date (km last = highest priority for overlapping keys)
    merged = []
    periods = []
    for d in dates:
        m = {}
        for src in (cf_by_date, bs_by_date, is_by_date, r_by_date, km_by_date):
            m.update(src.get(d, {}))
        merged.append(m)
        periods.append(str(m.get("fiscalYear") or d[:4]))

    # ── Formatters ───────────────────────────────────────────────────────────
    def _fx(v, d=1, s="x"):
        """Multiplier: 34.1x"""
        try: return f"{float(v):.{d}f}{s}" if v is not None else "—"
        except: return "—"

    def _fp(v, d=1):
        """Percentage from 0-1 decimal: 0.311 → 31.1%"""
        try: return f"{float(v)*100:.{d}f}%" if v is not None else "—"
        except: return "—"

    def _fc(v):
        """Currency: $3.82T"""
        return _fmt_fin(v, "currency")

    def _fpr(v, d=2):
        """Price: $255.33"""
        try: return f"${float(v):.{d}f}" if v is not None else "—"
        except: return "—"

    def _fyoy(raw):
        """YoY growth % strings from raw numeric list."""
        result = []
        for i, v in enumerate(raw):
            prev = raw[i + 1] if i + 1 < len(raw) else None
            try:
                fv, fp = float(v), float(prev)
                if fp != 0:
                    pct = (fv - fp) / abs(fp) * 100
                    result.append(f"{'+' if pct >= 0 else ''}{pct:.1f}%")
                    continue
            except (TypeError, ValueError):
                pass
            result.append("—")
        return result

    # ── Row builder ──────────────────────────────────────────────────────────
    def R(label, vals, indent=False, bold=False, is_growth=False):
        return {"label": label, "values": vals,
                "indent": indent, "bold": bold, "isGrowthRow": is_growth}

    # ── Derived per-period helpers ────────────────────────────────────────────
    def _safe(fn, *args):
        try: return fn(*args)
        except (TypeError, ValueError, ZeroDivisionError): return None

    def _ratio(a, b):
        return _safe(lambda x, y: float(x) / float(y) if y and float(y) != 0 else None, a, b)

    def _ptbv(m):
        try:
            pb    = float(m.get("priceToBookRatio") or 0)
            bvps  = float(m.get("bookValuePerShare") or 0)
            tbvps = float(m.get("tangibleBookValuePerShare") or 0)
            if pb and bvps and tbvps:
                return pb * bvps / tbvps
        except (TypeError, ValueError):
            pass
        return None

    def _buyback(m):
        try:
            csr = m.get("commonStockRepurchased")  # negative in CF
            mc  = m.get("marketCap")
            if csr is not None and mc and float(mc) != 0:
                return abs(float(csr)) / float(mc)
        except (TypeError, ValueError):
            pass
        return None

    def _tsr(m):
        try:
            by = _buyback(m) or 0.0
            dy = float(m.get("dividendYield") or 0)
            total = by + dy
            return total if total else None
        except (TypeError, ValueError):
            return None

    # Last Close Price ≈ priceToSalesRatio × revenuePerShare
    price_raw = [
        _safe(lambda ps, rs: float(ps) * float(rs), m.get("priceToSalesRatio"), m.get("revenuePerShare"))
        for m in merged
    ]
    mc_raw = [m.get("marketCap") for m in merged]

    # ── Build sections ────────────────────────────────────────────────────────
    def _sec(title, rows):
        return {"title": title, "rows": rows}

    sections = [
        _sec("Valuation", [
            R("Market Cap",                        [_fc(v)  for v in mc_raw],                                            bold=True),
            R("Market Cap Growth",                 _fyoy(mc_raw),                                                         indent=True, is_growth=True),
            R("Enterprise Value",                  [_fc(m.get("enterpriseValue"))                for m in merged]),
            R("Last Close Price",                  [_fpr(v) for v in price_raw]),
            R("PE Ratio",                          [_fx(m.get("priceToEarningsRatio"))           for m in merged]),
            R("PS Ratio",                          [_fx(m.get("priceToSalesRatio"))              for m in merged]),
            R("PB Ratio",                          [_fx(m.get("priceToBookRatio"))               for m in merged]),
            R("P/TBV Ratio",                       [_fx(_ptbv(m))                                for m in merged]),
            R("P/FCF Ratio",                       [_fx(m.get("priceToFreeCashFlowRatio"))       for m in merged]),
            R("P/OCF Ratio",                       [_fx(m.get("priceToOperatingCashFlowRatio"))  for m in merged]),
            R("EV/Sales Ratio",                    [_fx(m.get("evToSales"))                      for m in merged]),
            R("EV/EBITDA Ratio",                   [_fx(m.get("evToEBITDA"))                     for m in merged]),
            R("EV/EBIT Ratio",                     [_fx(_ratio(m.get("enterpriseValue"), m.get("operatingIncome"))) for m in merged]),
            R("EV/FCF Ratio",                      [_fx(m.get("evToFreeCashFlow"))               for m in merged]),
        ]),
        _sec("Leverage", [
            R("Debt / Equity Ratio",               [_fx(m.get("debtToEquityRatio"))              for m in merged]),
            R("Debt / EBITDA Ratio",               [_fx(_ratio(m.get("totalDebt"), m.get("ebitda")))   for m in merged]),
            R("Debt / FCF Ratio",                  [_fx(_ratio(m.get("totalDebt"), m.get("freeCashFlow"))) for m in merged]),
            R("Net Debt / Equity Ratio",           [_fx(_ratio(m.get("netDebt"), m.get("totalStockholdersEquity"))) for m in merged]),
            R("Net Debt / EBITDA Ratio",           [_fx(m.get("netDebtToEBITDA"))                for m in merged]),
            R("Net Debt / FCF Ratio",              [_fx(_ratio(m.get("netDebt"), m.get("freeCashFlow"))) for m in merged]),
        ]),
        _sec("Efficiency", [
            R("Asset Turnover",                    [_fx(m.get("assetTurnover"))                  for m in merged]),
            R("Inventory Turnover",                [_fx(m.get("inventoryTurnover"))              for m in merged]),
            R("Quick Ratio",                       [_fx(m.get("quickRatio"),   s="")             for m in merged]),
            R("Current Ratio",                     [_fx(m.get("currentRatio"), s="")             for m in merged]),
        ]),
        _sec("Profitability", [
            R("Return on Equity (ROE)",            [_fp(m.get("returnOnEquity"))                 for m in merged]),
            R("Return on Assets (ROA)",            [_fp(m.get("returnOnAssets"))                 for m in merged]),
            R("Return on Invested Capital (ROIC)", [_fp(m.get("returnOnInvestedCapital"))        for m in merged]),
            R("Return on Capital Employed (ROCE)", [_fp(m.get("returnOnCapitalEmployed"))        for m in merged]),
        ]),
        _sec("Yield & Income", [
            R("Earnings Yield",                    [_fp(m.get("earningsYield"))                  for m in merged]),
            R("FCF Yield",                         [_fp(m.get("freeCashFlowYield"))              for m in merged]),
            R("Dividend Yield",                    [_fp(m.get("dividendYield"))                  for m in merged]),
            R("Payout Ratio",                      [_fp(m.get("dividendPayoutRatio"))            for m in merged]),
            R("Buyback Yield / Dilution",          [_fp(_buyback(m))   for m in merged]),
            R("Total Shareholder Return",          [_fp(_tsr(m))       for m in merged]),
        ]),
    ]

    result = {"periods": periods, "sections": sections, "source": "fmp"}
    _fmp_fin_cache[cache_key] = {"ts": time.time(), "data": result}
    return result


def _fmp_peers(ticker: str) -> list:
    """Return list of peer tickers from FMP stable/stock-peers endpoint."""
    url = (
        f"https://financialmodelingprep.com/stable/stock-peers"
        f"?symbol={ticker.upper()}&apikey={FMP_KEY}"
    )
    r = _req.get(url, timeout=10)
    r.raise_for_status()
    data = r.json()
    if data and isinstance(data, list):
        return [item["symbol"] for item in data if "symbol" in item]
    return []


def _yf_peer_stats(ticker: str):
    """Fetch PE, PS, PB ratios for a single ticker via yFinance."""
    try:
        info = yf.Ticker(ticker.upper()).info
        pe   = info.get("trailingPE") or info.get("forwardPE")
        ps   = info.get("priceToSalesTrailing12Months")
        pb   = info.get("priceToBook")
        name = info.get("shortName") or info.get("longName") or ticker
        if pe is None or pe <= 0 or pe > 500:
            return None
        def _r(v): return round(float(v), 1) if v is not None and float(v) > 0 else None
        return {
            "ticker": ticker.upper(),
            "name":   name,
            "pe":     _r(pe),
            "ps":     _r(ps),
            "pb":     _r(pb),
        }
    except Exception:
        return None


@router.get("/stock/{ticker}/peers")
def get_peers(ticker: str):
    t = ticker.upper()

    # Serve from cache if available
    if t in _peers_cache:
        return _peers_cache[t]

    # 1. Get peer ticker list from FMP
    try:
        peer_tickers = _fmp_peers(t)[:6]          # cap at 6 peers
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FMP error: {exc}")

    # 2. Fetch main ticker stats
    main_stats = _yf_peer_stats(t)
    if main_stats is None:
        raise HTTPException(status_code=404, detail="Could not fetch main ticker data")

    main_item = {**main_stats, "isMain": True}

    # 3. Fetch stats for each peer (skip any with bad/missing PE)
    peer_items = []
    for pt in peer_tickers:
        if pt == t:
            continue
        s = _yf_peer_stats(pt)
        if s:
            peer_items.append({**s, "isMain": False})

    if not peer_items:
        raise HTTPException(status_code=404, detail="No peer data available")

    # 4. Peer average PE
    peer_avg = round(
        sum(p["pe"] for p in peer_items) / len(peer_items), 1
    )

    # 5. Sort: main first, then peers by PE descending
    all_items = [main_item] + sorted(peer_items, key=lambda x: x["pe"], reverse=True)

    result = {"items": all_items, "peerAvg": peer_avg}
    _peers_cache[t] = result
    return result



# ─── Economics ───────────────────────────────────────────────────────────────
_econ_caches: dict = {}          # keyed by country code
_ECON_TTL = 3600  # 1 hour

_COUNTRIES = [
    {"code": "US", "name": "United States",  "flag": "us"},
    {"code": "GB", "name": "United Kingdom",  "flag": "gb"},
    {"code": "DE", "name": "Germany",         "flag": "de"},
    {"code": "JP", "name": "Japan",           "flag": "jp"},
    {"code": "CN", "name": "China",           "flag": "cn"},
    {"code": "CA", "name": "Canada",          "flag": "ca"},
    {"code": "AU", "name": "Australia",       "flag": "au"},
    {"code": "BR", "name": "Brazil",          "flag": "br"},
    {"code": "IN", "name": "India",           "flag": "in"},
    {"code": "KR", "name": "South Korea",     "flag": "kr"},
    {"code": "MX", "name": "Mexico",          "flag": "mx"},
]

# World Bank indicators for non-US countries (annual data, no API key needed)
_WB_INDICATORS = [
    {
        "wb_id": "NY.GDP.MKTP.KD.ZG", "key": "gdpGrowth",
        "label": "GDP Growth", "unit": "%", "unitLabel": "PCT",
        "category": "Growth", "color": "#3b82f6", "freq": "Annual",
        "description": (
            "Annual GDP growth rate (constant prices). Measures how fast the economy is "
            "expanding or contracting. Two consecutive negative quarters typically signal "
            "a recession."
        ),
    },
    {
        "wb_id": "FP.CPI.TOTL.ZG", "key": "inflationRate",
        "label": "Inflation Rate", "unit": "%", "unitLabel": "PCT",
        "category": "Prices", "color": "#ef4444", "freq": "Annual",
        "description": (
            "Annual percentage change in consumer prices (CPI). Most central banks target "
            "around 2% as the sweet spot to prevent deflation without eroding purchasing power."
        ),
    },
    {
        "wb_id": "SL.UEM.TOTL.ZS", "key": "unemploymentRate",
        "label": "Unemployment Rate", "unit": "%", "unitLabel": "PCT",
        "category": "Labor", "color": "#f59e0b", "freq": "Annual",
        "description": (
            "Share of the labor force that is jobless and actively seeking work. "
            "A falling rate signals economic health; a sharp rise often confirms a recession."
        ),
    },
    {
        "wb_id": "NY.GDP.PCAP.KD", "key": "realGDPPerCapita",
        "label": "GDP Per Capita", "unit": "", "unitLabel": "USD",
        "category": "Growth", "color": "#3b82f6", "freq": "Annual",
        "description": (
            "Real GDP per capita in constant 2015 USD — the most direct measure of "
            "material living standards and long-run productivity growth."
        ),
    },
    {
        "wb_id": "FP.CPI.TOTL", "key": "CPI",
        "label": "Consumer Price Index", "unit": "", "unitLabel": "Index",
        "category": "Prices", "color": "#ef4444", "freq": "Annual",
        "description": (
            "CPI measures the average price level of a fixed basket of goods and services "
            "purchased by consumers. Used to adjust wages, pensions, and inflation-linked bonds."
        ),
    },
    {
        "wb_id": "GC.DOD.TOTL.GD.ZS", "key": "govDebt",
        "label": "Government Debt", "unit": "%", "unitLabel": "of GDP",
        "category": "Fiscal", "color": "#dc2626", "freq": "Annual",
        "description": (
            "Central government debt as a percentage of GDP. High and rising debt can "
            "crowd out private investment and limit fiscal space for future stimulus."
        ),
    },
    {
        "wb_id": "NV.IND.TOTL.KD.ZG", "key": "industrialGrowth",
        "label": "Industry Growth", "unit": "%", "unitLabel": "PCT",
        "category": "Manufacturing", "color": "#0891b2", "freq": "Annual",
        "description": (
            "Annual growth in industrial value added (manufacturing, mining, utilities, "
            "and construction) — a classic business-cycle bellwether."
        ),
    },
    {
        "wb_id": "BN.CAB.XOKA.GD.ZS", "key": "currentAccount",
        "label": "Current Account", "unit": "%", "unitLabel": "of GDP",
        "category": "Trade", "color": "#0891b2", "freq": "Annual",
        "description": (
            "Current account balance as a percentage of GDP. A surplus means the country "
            "exports more than it imports; a deficit means the opposite."
        ),
    },
]

# Rich metadata for every indicator — used by both backend fetch and frontend display
_ECON_META = [
    {
        "key": "realGDP", "label": "Real GDP", "unit": "B", "unitLabel": "USD",
        "category": "Growth", "color": "#3b82f6", "freq": "Quarterly",
        "description": (
            "Real GDP measures the inflation-adjusted value of all goods and services "
            "produced in the US. It's the broadest scorecard of the economy's health. "
            "Positive growth means expansion; two consecutive negative quarters typically "
            "signal a recession. The Fed and White House use it to set policy."
        ),
    },
    {
        "key": "federalFunds", "label": "Interest Rate", "unit": "%", "unitLabel": "PCT",
        "category": "Monetary Policy", "color": "#8b5cf6", "freq": "Monthly",
        "description": (
            "The Federal Funds Rate is the overnight lending rate between banks, set by "
            "the Federal Open Market Committee (FOMC). It's the primary monetary-policy "
            "lever: higher rates cool inflation and credit; lower rates stimulate growth. "
            "Every other interest rate in the economy — mortgages, car loans, credit cards "
            "— moves in its shadow."
        ),
    },
    {
        "key": "inflationRate", "label": "Inflation Rate", "unit": "%", "unitLabel": "PCT",
        "category": "Prices", "color": "#ef4444", "freq": "Monthly",
        "description": (
            "The inflation rate tracks the annual percentage change in consumer prices. "
            "The Fed targets 2% as the sweet spot — enough to prevent deflation without "
            "eroding purchasing power. Sustained readings above 3–4% prompt rate hikes; "
            "below 1% may trigger rate cuts or quantitative easing."
        ),
    },
    {
        "key": "unemploymentRate", "label": "Unemployment Rate", "unit": "%", "unitLabel": "PCT",
        "category": "Labor", "color": "#f59e0b", "freq": "Monthly",
        "description": (
            "The U-3 unemployment rate is the share of the civilian labor force that is "
            "jobless and actively seeking work. The Fed considers 4–5% roughly 'full "
            "employment.' A rate falling too low can fuel wage-price inflation; rising "
            "sharply often confirms a recession."
        ),
    },
    {
        "key": "CPI", "label": "Consumer Price Index", "unit": "", "unitLabel": "Index",
        "category": "Prices", "color": "#ef4444", "freq": "Monthly",
        "description": (
            "The CPI measures the average price of a fixed basket of goods and services "
            "purchased by urban consumers. It is the benchmark used to adjust Social "
            "Security payments, tax brackets, and inflation-protected securities (TIPS). "
            "The Bureau of Labor Statistics publishes it monthly."
        ),
    },
    {
        "key": "consumerSentiment", "label": "Consumer Sentiment", "unit": "", "unitLabel": "Index",
        "category": "Consumer", "color": "#16a34a", "freq": "Monthly",
        "description": (
            "The University of Michigan Consumer Sentiment Index surveys ~500 households "
            "on their financial outlook and willingness to spend. Because consumer "
            "spending is ~70% of GDP, this forward-looking index is one of the most "
            "closely watched leading indicators in the US. A reading below 70 often "
            "precedes slowdowns."
        ),
    },
    {
        "key": "retailSales", "label": "Retail Sales", "unit": "M", "unitLabel": "USD",
        "category": "Consumer", "color": "#16a34a", "freq": "Monthly",
        "description": (
            "Retail Sales measure total receipts at stores that sell durable and "
            "non-durable goods. Released by the Census Bureau, it covers about "
            "one-third of consumer spending and is a high-frequency pulse check "
            "on household demand. A month-over-month change of ±0.5% moves markets."
        ),
    },
    {
        "key": "totalNonfarmPayroll", "label": "Nonfarm Payrolls", "unit": "K", "unitLabel": "Jobs",
        "category": "Labor", "color": "#f59e0b", "freq": "Monthly",
        "description": (
            "Total Nonfarm Payrolls, from the Bureau of Labor Statistics 'jobs report,' "
            "counts paid US workers excluding farm, household, and non-profit employees. "
            "Released the first Friday of each month, it's often the single most "
            "market-moving piece of US economic data. Consensus often targets 150–200K "
            "new jobs as a healthy pace."
        ),
    },
    {
        "key": "initialClaims", "label": "Initial Jobless Claims", "unit": "K", "unitLabel": "Claims",
        "category": "Labor", "color": "#f59e0b", "freq": "Weekly",
        "description": (
            "Initial Jobless Claims count the number of people filing for unemployment "
            "insurance for the first time in a given week. As the most timely labor "
            "indicator (released every Thursday), it's a real-time warning signal for "
            "layoffs. A sustained move above 300K typically signals labor market stress."
        ),
    },
    {
        "key": "industrialProductionTotalIndex", "label": "Industrial Production", "unit": "", "unitLabel": "Index",
        "category": "Manufacturing", "color": "#0891b2", "freq": "Monthly",
        "description": (
            "The Industrial Production Index, published by the Federal Reserve, measures "
            "real output in manufacturing, mining, and utilities. Although manufacturing "
            "is now ~11% of GDP, IP is a classic business-cycle bellwether — factory "
            "output typically contracts sharply at the start of recessions and rebounds "
            "quickly in early recoveries."
        ),
    },
    {
        "key": "durableGoods", "label": "Durable Goods Orders", "unit": "M", "unitLabel": "USD",
        "category": "Manufacturing", "color": "#0891b2", "freq": "Monthly",
        "description": (
            "Durable Goods Orders measure new orders at manufacturers for items expected "
            "to last three years or more — aircraft, machinery, electronics, vehicles. "
            "Because durable purchases are large and discretionary, the series is "
            "volatile but rich with signal. The 'core' reading (ex-defense, ex-aircraft) "
            "is a proxy for business capital investment plans."
        ),
    },
    {
        "key": "newPrivatelyOwnedHousingUnitsStartedTotalUnits", "label": "Housing Starts", "unit": "K", "unitLabel": "Units",
        "category": "Housing", "color": "#dc2626", "freq": "Monthly",
        "description": (
            "Housing Starts count how many new residential construction projects began "
            "in a given month. Housing has outsized economic multiplier effects — "
            "construction jobs, appliance sales, mortgages, property taxes. The series "
            "is cyclically sensitive; a sharp drop often precedes a broader slowdown, "
            "as seen before the 2008 recession."
        ),
    },
    {
        "key": "totalVehicleSales", "label": "Vehicle Sales", "unit": "M", "unitLabel": "Units",
        "category": "Consumer", "color": "#16a34a", "freq": "Monthly",
        "description": (
            "Total Vehicle Sales (seasonally adjusted annual rate) measures how many "
            "cars and light trucks are sold in a month, annualized. Auto purchases are "
            "one of the largest individual expenditures consumers make and are highly "
            "sensitive to interest rates (auto loan rates) and consumer confidence. "
            "Healthy readings run 15–17 million units per year."
        ),
    },
    {
        "key": "retailMoneyFunds", "label": "Money Market Funds", "unit": "B", "unitLabel": "USD",
        "category": "Financial", "color": "#8b5cf6", "freq": "Monthly",
        "description": (
            "Retail Money Market Fund assets track how much cash households are parking "
            "in short-term, liquid, near-risk-free instruments. A surge indicates "
            "risk-aversion or attractive short-term yields (often during rate-hike "
            "cycles). When rates fall, these funds can become a large source of 'dry "
            "powder' that flows back into equities and bonds."
        ),
    },
    {
        "key": "smoothedUSRecessionProbabilities", "label": "Recession Probability", "unit": "%", "unitLabel": "PCT",
        "category": "Risk", "color": "#dc2626", "freq": "Monthly",
        "description": (
            "Smoothed US Recession Probabilities, from the Federal Reserve Bank of "
            "St. Louis, apply a dynamic-factor Markov-switching model to four monthly "
            "coincident indicators: non-farm payrolls, industrial production, personal "
            "income ex-transfers, and manufacturing sales. Readings above 50% have "
            "historically coincided with NBER-designated recessions."
        ),
    },
    {
        "key": "realGDPPerCapita", "label": "Real GDP Per Capita", "unit": "", "unitLabel": "USD",
        "category": "Growth", "color": "#3b82f6", "freq": "Quarterly",
        "description": (
            "Real GDP Per Capita divides inflation-adjusted GDP by the total population, "
            "giving the most direct measure of material living standards. Long-run "
            "growth in this metric — driven by productivity gains and capital deepening "
            "— is what sustains rising wages, corporate profits, and equity valuations "
            "over time."
        ),
    },
]


@router.get("/economics")
def get_economics(country: str = Query("US")):
    """Return macro dashboard for a given country. US uses FMP; others use World Bank."""
    country = country.upper()
    cache = _econ_caches.setdefault(country, {"ts": 0, "data": None})
    if time.time() - cache["ts"] < _ECON_TTL and cache["data"]:
        return cache["data"]

    # ── US: existing FMP high-frequency path ──────────────────────────────────
    if country == "US":
        import datetime as _dt
        from_date = ((_dt.date.today() - _dt.timedelta(days=365 * 11)).isoformat())
        to_date   = _dt.date.today().isoformat()

        def _fetch_treasury():
            r = _req.get(f"https://financialmodelingprep.com/stable/treasury-rates?apikey={FMP_KEY}", timeout=12)
            r.raise_for_status()
            items = r.json()
            return items[0] if items else {}

        def _fetch_fmp(meta):
            key = meta["key"]
            r = _req.get(
                f"https://financialmodelingprep.com/stable/economic-indicators"
                f"?name={key}&from={from_date}&to={to_date}&limit=1000&apikey={FMP_KEY}",
                timeout=12,
            )
            r.raise_for_status()
            raw = sorted(r.json() or [], key=lambda x: x.get("date", ""))
            if not raw:
                return None
            if len(raw) > 200:
                step = max(1, len(raw) // 150)
                sampled = raw[::step]
                if raw[-1] not in sampled:
                    sampled.append(raw[-1])
                raw = sampled
            history = [{"date": x["date"], "value": x["value"]} for x in raw]
            last = history[-1] if history else None
            return {**meta, "history": history,
                    "lastValue": last["value"] if last else None,
                    "lastDate":  last["date"]  if last else None}

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=17) as pool:
                fut_t = pool.submit(_fetch_treasury)
                ind_futs = {pool.submit(_fetch_fmp, m): m for m in _ECON_META}

            treasury   = fut_t.result()
            indicators = []
            for fut, meta in ind_futs.items():
                try:
                    d = fut.result()
                    if d: indicators.append(d)
                except Exception:
                    pass

            order = {m["key"]: i for i, m in enumerate(_ECON_META)}
            indicators.sort(key=lambda x: order.get(x["key"], 99))

            data = {"treasury": treasury, "indicators": indicators, "countries": _COUNTRIES}
            cache.update({"ts": time.time(), "data": data})
            return data

        except Exception as exc:
            if cache["data"]: return cache["data"]
            raise HTTPException(status_code=502, detail=str(exc))

    # ── Non-US: World Bank annual data ────────────────────────────────────────
    def _fetch_wb(meta):
        wb_id = meta["wb_id"]
        url = (
            f"https://api.worldbank.org/v2/country/{country}/indicator/{wb_id}"
            f"?format=json&mrv=20&per_page=20"
        )
        r = _req.get(url, timeout=12)
        r.raise_for_status()
        payload = r.json()
        if not payload or len(payload) < 2 or not payload[1]:
            return None
        raw = sorted(
            [{"date": x["date"], "value": x["value"]}
             for x in payload[1] if x.get("value") is not None],
            key=lambda x: x["date"],
        )
        if not raw:
            return None
        last = raw[-1]
        return {**meta, "history": raw,
                "lastValue": last["value"],
                "lastDate":  last["date"]}

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(_WB_INDICATORS)) as pool:
            ind_futs = {pool.submit(_fetch_wb, m): m for m in _WB_INDICATORS}

        indicators = []
        for fut, meta in ind_futs.items():
            try:
                d = fut.result()
                if d: indicators.append(d)
            except Exception:
                pass

        order = {m["key"]: i for i, m in enumerate(_WB_INDICATORS)}
        indicators.sort(key=lambda x: order.get(x["key"], 99))

        data = {"treasury": None, "indicators": indicators, "countries": _COUNTRIES}
        cache.update({"ts": time.time(), "data": data})
        return data

    except Exception as exc:
        if cache["data"]: return cache["data"]
        raise HTTPException(status_code=502, detail=str(exc))


# ── Economic Calendar ─────────────────────────────────────────────────────────
_cal_cache: dict = {}   # keyed by "from|to"
_CAL_TTL = 900          # 15 min

@router.get("/economic-calendar")
def get_economic_calendar(
    from_date: str = Query(None),
    to_date:   str = Query(None),
):
    import datetime as _dt
    today = _dt.date.today()
    if not from_date:
        from_date = (today - _dt.timedelta(days=7)).isoformat()
    if not to_date:
        to_date   = (today + _dt.timedelta(days=7)).isoformat()

    cache_key = f"{from_date}|{to_date}"
    cached = _cal_cache.get(cache_key)
    if cached and time.time() - cached["ts"] < _CAL_TTL:
        return cached["data"]

    try:
        r = _req.get(
            f"https://financialmodelingprep.com/stable/economic-calendar"
            f"?from={from_date}&to={to_date}&limit=2000&apikey={FMP_KEY}",
            timeout=15,
        )
        r.raise_for_status()
        events = r.json() or []

        # Sort chronologically
        events.sort(key=lambda x: x.get("date", ""))

        _cal_cache[cache_key] = {"ts": time.time(), "data": events}
        return events

    except Exception as exc:
        if cached:
            return cached["data"]
        raise HTTPException(status_code=502, detail=str(exc))


_earn_cache: dict = {}
_div_cache:  dict = {}
_ipo_cache:  dict = {}
_CAL2_TTL = 900   # 15 min

# Persistent exchange cache — symbol → exchange string (never expires; exchanges don't change)
_sym_exchange_cache: dict = {}
_LISTED_EXCHANGES = {"NYSE", "NASDAQ", "AMEX", "NYSE ARCA", "NYSE MKT", "BATS", "CBOE", "IEX"}

def _fetch_exchange(symbol: str) -> str:
    """Return the exchange short name for a symbol, cached indefinitely."""
    if symbol in _sym_exchange_cache:
        return _sym_exchange_cache[symbol]
    try:
        url = f"https://financialmodelingprep.com/stable/profile?symbol={symbol}&apikey={FMP_KEY}"
        resp = _req.get(url, timeout=6).json()
        if resp:
            exch = (resp[0].get("exchange") or "").upper().strip()
            name = resp[0].get("companyName") or ""
            if name and name != symbol:
                _name_cache[symbol] = {"ts": time.time(), "name": name}
        else:
            exch = ""
    except Exception:
        exch = ""
    _sym_exchange_cache[symbol] = exch
    return exch

def _filter_listed(symbols: list) -> set:
    """Return the subset of symbols that are on a major listed US exchange."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    uncached = [s for s in symbols if s not in _sym_exchange_cache]
    if uncached:
        with ThreadPoolExecutor(max_workers=20) as ex:
            list(ex.map(_fetch_exchange, uncached))  # populate cache
    return {s for s in symbols if _sym_exchange_cache.get(s, "") in _LISTED_EXCHANGES}

def _cal_fetch(url, cache_store, cache_key):
    """Generic calendar fetch with per-key caching."""
    cached = cache_store.get(cache_key)
    if cached and time.time() - cached["ts"] < _CAL2_TTL:
        return cached["data"]
    r = _req.get(url, timeout=15)
    r.raise_for_status()
    data = r.json() or []
    cache_store[cache_key] = {"ts": time.time(), "data": data}
    return data

_name_cache: dict = {}
_NAME_TTL = 86400

def _batch_names(symbols: list[str]) -> dict[str, str]:
    """Return {symbol: companyName} for a list of symbols, using FMP batch profile."""
    now = time.time()
    result = {}
    missing = []
    for s in symbols:
        entry = _name_cache.get(s)
        if entry and now - entry["ts"] < _NAME_TTL:
            result[s] = entry["name"]
        else:
            missing.append(s)
    if missing:
        def _fetch_one_name(sym):
            try:
                url = f"https://financialmodelingprep.com/stable/quote?symbol={sym}&apikey={FMP_KEY}"
                r = _req.get(url, timeout=8)
                data = r.json() if r.ok else []
                if isinstance(data, list) and data:
                    name = data[0].get("name")
                    if name and name != sym:
                        return sym, name
            except Exception:
                pass
            # Fallback: try profile endpoint
            try:
                url = f"https://financialmodelingprep.com/stable/profile?symbol={sym}&apikey={FMP_KEY}"
                r = _req.get(url, timeout=8)
                data = r.json() if r.ok else []
                if isinstance(data, list) and data:
                    name = data[0].get("companyName")
                    if name and name != sym:
                        return sym, name
            except Exception:
                pass
            return sym, sym
        import concurrent.futures as _cf
        with _cf.ThreadPoolExecutor(max_workers=10) as ex:
            for sym, name in ex.map(_fetch_one_name, missing):
                _name_cache[sym] = {"ts": now, "name": name}
                result[sym] = name
    return result

@router.get("/earnings-calendar")
def get_earnings_calendar(from_date: str = Query(None), to_date: str = Query(None)):
    import datetime as _dt
    today = _dt.date.today()
    from_date = from_date or (today - _dt.timedelta(days=7)).isoformat()
    to_date   = to_date   or (today + _dt.timedelta(days=14)).isoformat()
    url = (f"https://financialmodelingprep.com/stable/earnings-calendar"
           f"?from={from_date}&to={to_date}&limit=2000&apikey={FMP_KEY}")
    try:
        data = _cal_fetch(url, _earn_cache, f"{from_date}|{to_date}")
        data = [e for e in data if "." not in e.get("symbol", "")]
        symbols = list({e["symbol"] for e in data if e.get("symbol")})
        listed = _filter_listed(symbols)
        data = [e for e in data if e.get("symbol") in listed]
        data.sort(key=lambda x: x.get("date", ""))
        symbols = [e["symbol"] for e in data if e.get("symbol")]
        names = _batch_names(symbols)
        for e in data:
            e["name"] = names.get(e.get("symbol", ""), e.get("symbol", ""))
        return data
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

@router.get("/dividends-calendar")
def get_dividends_calendar(from_date: str = Query(None), to_date: str = Query(None)):
    import datetime as _dt
    today = _dt.date.today()
    from_date = from_date or (today - _dt.timedelta(days=7)).isoformat()
    to_date   = to_date   or (today + _dt.timedelta(days=14)).isoformat()
    url = (f"https://financialmodelingprep.com/stable/dividends-calendar"
           f"?from={from_date}&to={to_date}&limit=2000&apikey={FMP_KEY}")
    try:
        data = _cal_fetch(url, _div_cache, f"{from_date}|{to_date}")
        data = [e for e in data if "." not in e.get("symbol", "")]
        symbols = list({e["symbol"] for e in data if e.get("symbol")})
        listed = _filter_listed(symbols)
        data = [e for e in data if e.get("symbol") in listed]
        data.sort(key=lambda x: x.get("date", ""))
        names = _batch_names(symbols)
        for e in data:
            e["name"] = names.get(e.get("symbol", ""), e.get("symbol", ""))
        return data
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

@router.get("/ipo-calendar")
def get_ipo_calendar(from_date: str = Query(None), to_date: str = Query(None)):
    import datetime as _dt
    today = _dt.date.today()
    from_date = from_date or today.isoformat()
    to_date   = to_date   or (today + _dt.timedelta(days=60)).isoformat()
    url = (f"https://financialmodelingprep.com/stable/ipos-calendar"
           f"?from={from_date}&to={to_date}&limit=500&apikey={FMP_KEY}")
    try:
        data = _cal_fetch(url, _ipo_cache, f"{from_date}|{to_date}")
        data.sort(key=lambda x: x.get("date", ""))

        # Derive IPO price from marketCap / shares
        for e in data:
            mc = e.get("marketCap")
            sh = e.get("shares")
            e["ipoPrice"] = round(mc / sh, 2) if mc and sh else None

        # Fetch current price for Priced IPOs
        priced_syms = [e["symbol"] for e in data if e.get("actions") == "Priced" and e.get("symbol")]
        def _fetch_price(sym):
            try:
                r = _req.get(f"https://financialmodelingprep.com/stable/quote?symbol={sym}&apikey={FMP_KEY}", timeout=6)
                q = r.json()
                if isinstance(q, list) and q:
                    return sym, q[0].get("price")
            except Exception:
                pass
            return sym, None
        import concurrent.futures as _cf
        price_map = {}
        with _cf.ThreadPoolExecutor(max_workers=10) as ex:
            for sym, price in ex.map(_fetch_price, priced_syms):
                price_map[sym] = price
        for e in data:
            e["currentPrice"] = price_map.get(e["symbol"])

        return data
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/stock/{ticker}/scores")
def get_scores(ticker: str):
    """Single-call scoring endpoint — FMP TTM data primary, yfinance for analyst data."""

    def _f(v):
        try: return float(v) if v is not None else None
        except Exception: return None

    # 1. FMP: financial metrics via _fmp_company_stats (cached, 5 parallel calls)
    d = {}
    try:
        d = _fmp_company_stats(ticker)
    except Exception:
        pass

    current = _f(d.get("price"))
    roe     = _f(d.get("returnOnEquityTTM"))
    roa     = _f(d.get("returnOnAssetsTTM"))
    gm      = _f(d.get("grossProfitMarginTTM"))
    nm      = _f(d.get("netProfitMarginTTM"))
    om      = _f(d.get("operatingProfitMarginTTM"))
    rev_g   = _f(d.get("revenueGrowth"))
    ear_g   = _f(d.get("netIncomeGrowth"))
    cr      = _f(d.get("currentRatioTTM"))
    de      = _f(d.get("debtToEquityRatioTTM"))   # FMP gives ratio, not %
    at      = _f(d.get("assetTurnoverTTM"))
    # FCF via yield × mcap; cash ratio for health check
    fcf_y   = _f(d.get("freeCashFlowYieldTTM"))
    mcap_v  = _f(d.get("marketCap"))
    fcf     = (fcf_y * mcap_v) if fcf_y is not None and mcap_v else None
    cash_r  = _f(d.get("cashRatioTTM"))   # cash/current-liab
    name    = d.get("companyName") or ticker.upper()
    exch    = d.get("exchange") or ""

    # 2. yfinance: analyst target/rating only (FMP price-target empty on this tier)
    target = rating = None
    try:
        yf_info = yf.Ticker(ticker.upper()).info
        target  = _f(yf_info.get("targetMeanPrice"))
        rating  = (yf_info.get("recommendationKey") or "").lower()
        if not current: current = _f(yf_info.get("currentPrice") or yf_info.get("regularMarketPrice"))
        if not name:    name    = yf_info.get("longName") or yf_info.get("shortName") or ticker.upper()
        if not exch:    exch    = yf_info.get("exchange") or ""
        if not mcap_v:  mcap_v  = _f(yf_info.get("marketCap"))
    except Exception:
        pass

    # ── Valuation (0-5) ────────────────────────────────────────
    val = 0
    if current and target:
        if target > current:        val += 2
        if target > current * 1.10: val += 1
        if target > current * 1.20: val += 1
    if rating in ["buy", "strong_buy"]: val += 1

    # ── Profitability (0-5) ────────────────────────────────────
    prof = sum([
        1 if roe and roe > 0.15 else 0,
        1 if roa and roa > 0.10 else 0,
        1 if gm  and gm  > 0.40 else 0,
        1 if nm  and nm  > 0.20 else 0,
        1 if om  and om  > 0.15 else 0,
    ])

    # ── Growth (0-5) ───────────────────────────────────────────
    grow = sum([
        1 if rev_g and rev_g > 0.05  else 0,
        1 if rev_g and rev_g > 0.15  else 0,
        1 if ear_g and ear_g > 0     else 0,
        1 if ear_g and ear_g > 0.10  else 0,
        1 if rev_g and ear_g and rev_g > 0 and ear_g > 0 else 0,
    ])

    # ── Health (0-5): cr, D/E (ratio not %), FCF, cash ratio, cr>2 ──
    hlth = sum([
        1 if cr     and cr    > 1.5  else 0,
        1 if de     and de    < 1.0  else 0,   # D/E ratio (not %)
        1 if fcf    and fcf   > 0    else 0,
        1 if cash_r and cash_r > 0.5 else 0,
        1 if cr     and cr    > 2.0  else 0,
    ])

    # ── Efficiency (0-5) ───────────────────────────────────────
    eff = sum([
        1 if at  and at  > 0.5  else 0,
        1 if at  and at  > 0.8  else 0,
        1 if om  and om  > 0.15 else 0,
        1 if fcf and fcf > 0    else 0,
        1 if roe and roe > 0.15 else 0,
    ])

    def fmt_cap(v):
        if not v: return None
        if v >= 1e12: return f"${v/1e12:.2f}T"
        if v >= 1e9:  return f"${v/1e9:.1f}B"
        return f"${v/1e6:.0f}M"

    return {
        "name":      name,
        "exchange":  exch,
        "marketCap": fmt_cap(mcap_v),
        "scores":    [min(5, val), prof, grow, hlth, eff],
    }


@router.get("/stock/{ticker}/efficiency")
def get_efficiency(ticker: str):
    import math as _math

    def _dfget(df, *labels):
        for lbl in labels:
            if lbl in df.index:
                try:
                    v = float(df.loc[lbl].iloc[0])
                    return None if _math.isnan(v) else v
                except Exception:
                    pass
        return None

    def _dfcol(df, lbl, col):
        try:
            if lbl in df.index and len(df.columns) > col:
                v = float(df.loc[lbl].iloc[col])
                return None if _math.isnan(v) else v
        except Exception:
            pass
        return None

    dep_pct = repurchase = asset_turnover = capex_pct = inv_turnover_chg = rd_pct = None

    # 1. FMP: asset turnover (assetTurnoverTTM) + R&D % of GP
    try:
        d = _fmp_company_stats(ticker)
        at = d.get("assetTurnoverTTM")
        if at is not None: asset_turnover = round(float(at), 2)
        rd_rev = d.get("researchAndDevelopementToRevenueTTM")
        gpm    = d.get("grossProfitMarginTTM")
        if rd_rev is not None and gpm and float(gpm) > 0:
            rd_pct = round(abs(float(rd_rev)) / float(gpm) * 100, 1)
        # CapEx as % of earnings: capexToRevenue / netMargin
        capex_rev = d.get("capexToRevenueTTM")
        net_m     = d.get("netProfitMarginTTM")
        if capex_rev is not None and net_m and float(net_m) > 0:
            capex_pct = round(abs(float(capex_rev)) / float(net_m) * 100, 1)
    except Exception:
        pass

    # 2. yfinance for D&A%, repurchases, inv turnover (need raw statement line items)
    try:
        t    = yf.Ticker(ticker.upper())
        info = t.info
        fin  = t.financials
        bs   = t.balance_sheet
        cf   = t.cashflow
        gp   = _dfget(fin, 'Gross Profit')

        if dep_pct is None:
            dep = _dfget(cf, 'Depreciation And Amortization') or _dfget(fin, 'Reconciled Depreciation')
            if dep and gp and gp > 0: dep_pct = round(abs(dep) / gp * 100, 1)
        if repurchase is None:
            rep = _dfget(cf, 'Repurchase Of Capital Stock')
            if rep is not None: repurchase = round(abs(rep) / 1e9, 1)
        if asset_turnover is None:
            rev    = float(info.get('totalRevenue') or 0)
            assets = _dfget(bs, 'Total Assets')
            if rev and assets and assets > 0: asset_turnover = round(rev / assets, 2)
        if capex_pct is None:
            capex   = _dfget(cf, 'Capital Expenditure')
            net_inc = _dfget(fin, 'Net Income', 'Net Income Common Stockholders')
            if capex is not None and net_inc and net_inc > 0:
                capex_pct = round(abs(capex) / net_inc * 100, 1)
        if inv_turnover_chg is None:
            cogs_c = _dfcol(fin, 'Cost Of Revenue', 0); cogs_p = _dfcol(fin, 'Cost Of Revenue', 1)
            inv_c  = _dfcol(bs, 'Inventory', 0);        inv_p  = _dfcol(bs, 'Inventory', 1)
            if all(v is not None and v > 0 for v in [cogs_c, cogs_p, inv_c, inv_p]):
                it_c = cogs_c / inv_c; it_p = cogs_p / inv_p
                inv_turnover_chg = round((it_c - it_p) / it_p * 100, 1)
        if rd_pct is None:
            rd = _dfget(fin, 'Research And Development')
            if rd is not None and gp and gp > 0: rd_pct = round(abs(rd) / gp * 100, 1)
    except Exception:
        pass

    metrics = [
        {"id": "depPct",  "name": "Depreciation as % of Gross Profit",
         "value": dep_pct,         "target": 10,  "direction": "lower",
         "unit": "%",              "targetLabel": "< 10%",
         "description": "D&A relative to gross profit — lower means assets require less ongoing replacement cost."},
        {"id": "repurch", "name": "Stock Repurchases",
         "value": repurchase,      "target": 0,   "direction": "higher",
         "unit": "$B",             "targetLabel": "Yes (any amount)",
         "description": "Annual stock buybacks in $B — repurchases signal management confidence and return capital to shareholders."},
        {"id": "assetTO", "name": "Asset Turnover Ratio",
         "value": asset_turnover,  "target": 0.8, "direction": "higher",
         "unit": "x",              "targetLabel": "> 0.8×",
         "description": "Revenue ÷ total assets — measures how efficiently assets generate sales."},
        {"id": "capexPct","name": "CapEx as % of Earnings",
         "value": capex_pct,       "target": 25,  "direction": "lower",
         "unit": "%",              "targetLabel": "< 25%",
         "description": "Capital expenditures relative to net income — lower means more earnings flow to shareholders vs. reinvestment."},
        {"id": "invTO",   "name": "Inventory Turnover Trend",
         "value": inv_turnover_chg,"target": 0,   "direction": "higher",
         "unit": "%",              "targetLabel": "Improving or stable",
         "description": "Year-over-year change in inventory turnover — positive means goods are moving faster than last year."},
        {"id": "rdPct",   "name": "R&D as % of Gross Profit",
         "value": rd_pct,          "target": 30,  "direction": "lower",
         "unit": "%",              "targetLabel": "< 30% (moat indicator)",
         "description": "R&D spend relative to gross profit — moderate R&D can signal a durable competitive moat."},
    ]
    met = sum(1 for m in metrics if m["value"] is not None and (
        (m["direction"] == "higher" and m["value"] >= m["target"]) or
        (m["direction"] == "lower"  and m["value"] <= m["target"])
    ))
    total = sum(1 for m in metrics if m["value"] is not None)
    return {"metrics": metrics, "met": met, "total": total}


@router.get("/stock/{ticker}/health")
def get_health(ticker: str):
    import math as _math

    def _dfget(df, *labels):
        for lbl in labels:
            if lbl in df.index:
                try:
                    v = float(df.loc[lbl].iloc[0])
                    return None if _math.isnan(v) else v
                except Exception:
                    pass
        return None

    # 1. FMP: D/E, current ratio, interest coverage, SG&A%, FCF via TTM endpoints
    de_ratio = current_ratio = int_margin = sga_pct = fcf_val = z_score = None
    try:
        d = _fmp_company_stats(ticker)
        # D/E: FMP gives ratio (not %) — convert to %
        de_raw = d.get("debtToEquityRatioTTM")
        if de_raw is not None: de_ratio = round(float(de_raw) * 100, 1)
        # Current ratio
        cr_raw = d.get("currentRatioTTM")
        if cr_raw is not None: current_ratio = round(float(cr_raw), 2)
        # Interest margin: interestCoverageRatio = EBIT/Interest → interest/GP
        # FMP gives interest coverage; convert to interest-as-%-of-GP via ebitMargin
        # ebitMargin × (1/coverage) × (rev/GP). Since grossProfitMargin is available:
        cov = d.get("interestCoverageRatioTTM")
        ebit_m = d.get("ebitMarginTTM")
        gpm    = d.get("grossProfitMarginTTM")
        if cov and ebit_m and gpm and float(gpm) > 0 and float(cov) != 0:
            # interest/GP = (ebit/rev) / (GP/rev) / coverage = ebit_margin/gp_margin/coverage
            int_margin = round(abs(float(ebit_m) / float(gpm) / float(cov)) * 100, 1)
        # SG&A % of GP: salesGAToRevenueTTM / grossProfitMarginTTM
        sga_rev = d.get("salesGeneralAndAdministrativeToRevenueTTM")
        if sga_rev is not None and gpm and float(gpm) > 0:
            sga_pct = round(abs(float(sga_rev)) / float(gpm) * 100, 1)
        # FCF: freeCashFlowYieldTTM × marketCap → FCF in $B
        fcf_yield = d.get("freeCashFlowYieldTTM")
        mcap      = d.get("marketCap")
        if fcf_yield is not None and mcap:
            fcf_val = round(float(fcf_yield) * float(mcap) / 1e9, 2)
    except Exception:
        pass

    # 2. yfinance fallback for still-missing + Altman Z-score (needs raw BS items)
    try:
        t    = yf.Ticker(ticker.upper())
        info = t.info
        fin  = t.financials
        bs   = t.balance_sheet
        cf   = t.cashflow

        if de_ratio is None:
            debt   = _dfget(bs, 'Total Debt') or 0
            equity = _dfget(bs, 'Stockholders Equity', 'Common Stock Equity',
                            'Total Equity Gross Minority Interest')
            if equity and equity > 0: de_ratio = round(debt / equity * 100, 1)
        if current_ratio is None:
            cr = info.get('currentRatio')
            if cr is not None: current_ratio = round(float(cr), 2)
        if int_margin is None:
            interest = _dfget(fin, 'Interest Expense Non Operating', 'Interest Expense')
            gp       = _dfget(fin, 'Gross Profit')
            if interest is not None and gp and gp > 0:
                int_margin = round(abs(interest) / gp * 100, 1)
        if sga_pct is None:
            sga = _dfget(fin, 'Selling General And Administration')
            gp  = _dfget(fin, 'Gross Profit')
            if sga is not None and gp and gp > 0:
                sga_pct = round(abs(sga) / gp * 100, 1)
        if fcf_val is None:
            fcf = _dfget(cf, 'Free Cash Flow')
            if fcf is not None: fcf_val = round(fcf / 1e9, 2)

        # Altman Z-score always requires raw balance sheet items
        total_assets = _dfget(bs, 'Total Assets')
        total_liab   = _dfget(bs, 'Total Liabilities Net Minority Interest')
        wc           = _dfget(bs, 'Working Capital')
        ret_earn     = _dfget(bs, 'Retained Earnings')
        ebit         = _dfget(fin, 'EBIT', 'Operating Income')
        revenue      = float(info.get('totalRevenue') or 0)
        mkt_cap      = float(info.get('marketCap') or 0)
        if all(v is not None and v != 0 for v in [total_assets, total_liab, wc, ret_earn, ebit]):
            X1 = wc       / total_assets
            X2 = ret_earn / total_assets
            X3 = ebit     / total_assets
            X4 = mkt_cap  / total_liab  if total_liab else 0
            X5 = revenue  / total_assets if total_assets else 0
            z_score = round(1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5, 2)
    except Exception:
        pass

    metrics = [
        {"id": "sga",    "name": "SG&A as % of Gross Profit",
         "value": sga_pct,      "target": 30,  "direction": "lower",
         "unit": "%",           "targetLabel": "< 30%",
         "description": "Selling, general & admin costs as a share of gross profit — lower signals operating efficiency."},
        {"id": "de",     "name": "Total Debt / Equity",
         "value": de_ratio,     "target": 100, "direction": "lower",
         "unit": "%",           "targetLabel": "< 100%",
         "description": "Total debt relative to shareholders' equity — lower leverage means less solvency risk."},
        {"id": "intM",   "name": "Interest Margin",
         "value": int_margin,   "target": 15,  "direction": "lower",
         "unit": "%",           "targetLabel": "< 15% of gross profit",
         "description": "Interest expense as % of gross profit — gauges how much core earnings go toward debt servicing."},
        {"id": "cr",     "name": "Current Ratio",
         "value": current_ratio,"target": 1.5, "direction": "higher",
         "unit": "x",           "targetLabel": "> 1.5×",
         "description": "Current assets ÷ current liabilities — measures ability to cover short-term obligations."},
        {"id": "zscore", "name": "Altman Z-Score",
         "value": z_score,      "target": 3.0, "direction": "higher",
         "unit": "",            "targetLabel": "> 3.0 (safe zone)",
         "description": "Composite bankruptcy-risk score. Above 3.0 = safe zone; below 1.8 = distress zone."},
        {"id": "fcf",    "name": "Free Cash Flow",
         "value": fcf_val,      "target": 0,   "direction": "higher",
         "unit": "$B",          "targetLabel": "Consistently positive",
         "description": "Most recent annual free cash flow — positive FCF signals healthy cash generation after capex."},
    ]
    met = sum(1 for m in metrics if m["value"] is not None and (
        (m["direction"] == "higher" and m["value"] >= m["target"]) or
        (m["direction"] == "lower"  and m["value"] <= m["target"])
    ))
    total = sum(1 for m in metrics if m["value"] is not None)
    return {"metrics": metrics, "met": met, "total": total}


@router.get("/stock/{ticker}/debt-history")
def get_debt_history(ticker: str):
    import math as _math

    def _fv(v):
        try:
            f = float(v)
            return None if _math.isnan(f) or _math.isinf(f) else round(f / 1e9, 3)
        except Exception:
            return None

    def _build_from_fmp(rows):
        points = []
        for r in sorted(rows, key=lambda x: x.get("date", "")):
            debt   = _fv(r.get("totalDebt") or r.get("longTermDebt"))
            equity = _fv(r.get("totalStockholdersEquity") or r.get("stockholdersEquity"))
            cash   = _fv(r.get("cashAndCashEquivalents") or r.get("cashAndShortTermInvestments"))
            de_ratio = round((debt / equity) * 100, 1) if debt is not None and equity and equity > 0 else None
            points.append({"date": r.get("date", "")[:10], "debt": debt, "equity": equity, "cash": cash, "deRatio": de_ratio})
        return points

    annual, quarterly = [], []
    try:
        ann_url = (f"https://financialmodelingprep.com/stable/balance-sheet-statement"
                   f"?symbol={ticker.upper()}&period=annual&limit=10&apikey={FMP_KEY}")
        ann_data = _req.get(ann_url, timeout=8).json() or []
        annual = _build_from_fmp(ann_data)
    except Exception:
        pass

    try:
        qtr_url = (f"https://financialmodelingprep.com/stable/balance-sheet-statement"
                   f"?symbol={ticker.upper()}&period=quarter&limit=20&apikey={FMP_KEY}")
        qtr_data = _req.get(qtr_url, timeout=8).json() or []
        quarterly = _build_from_fmp(qtr_data)
    except Exception:
        pass

    return {"annual": annual, "quarterly": quarterly}


@router.get("/stock/{ticker}/revenue-segments")
def get_revenue_segments(ticker: str):
    import math as _math

    def _fetch(endpoint, period="annual", limit=6):
        url = (f"https://financialmodelingprep.com/stable/{endpoint}"
               f"?symbol={ticker.upper()}&period={period}&limit={limit}&apikey={FMP_KEY}")
        try:
            rows = _req.get(url, timeout=8).json() or []
            result = []
            for r in sorted(rows, key=lambda x: x.get("date", "")):
                data = r.get("data") or {}
                cleaned = {}
                for k, v in data.items():
                    try:
                        f = float(v or 0)
                        if not _math.isnan(f) and f > 0:
                            cleaned[k] = round(f / 1e9, 2)
                    except Exception:
                        pass
                if cleaned:
                    result.append({"date": r.get("date", "")[:10], "fiscalYear": r.get("fiscalYear"), "data": cleaned})
            return result
        except Exception:
            return []

    product  = _fetch("revenue-product-segmentation",     "annual", 6)
    geo      = _fetch("revenue-geographic-segmentation",  "annual", 6)
    prod_q   = _fetch("revenue-product-segmentation",     "quarter", 8)
    geo_q    = _fetch("revenue-geographic-segmentation",  "quarter", 8)

    return {"product": product, "geo": geo, "productQ": prod_q, "geoQ": geo_q}


@router.get("/stock/{ticker}/balance-sheet-snapshot")
def get_balance_sheet_snapshot(ticker: str):
    import math as _math

    def _b(v):
        try:
            f = float(v or 0)
            return None if _math.isnan(f) else round(f / 1e9, 2)
        except Exception:
            return None

    try:
        url = (f"https://financialmodelingprep.com/stable/balance-sheet-statement"
               f"?symbol={ticker.upper()}&period=annual&limit=1&apikey={FMP_KEY}")
        rows = _req.get(url, timeout=8).json() or []
        if not rows:
            return {"error": "no data"}
        r = rows[0]

        cash_st   = _b(r.get("cashAndShortTermInvestments")) or 0
        receivable = _b(r.get("netReceivables")) or 0
        inventory  = _b(r.get("inventory")) or 0
        physical   = _b(r.get("propertyPlantEquipmentNet")) or 0
        total_ast  = _b(r.get("totalAssets")) or 0
        lt_other   = max(0, round(total_ast - cash_st - receivable - inventory - physical, 2))

        total_debt      = _b(r.get("totalDebt")) or 0
        acct_payable    = _b(r.get("accountPayables")) or 0
        equity          = _b(r.get("totalStockholdersEquity")) or 0
        total_liab      = _b(r.get("totalLiabilities")) or 0
        other_liab      = max(0, round(total_liab - total_debt - acct_payable, 2))

        return {
            "date": r.get("date", "")[:10],
            "assets": [
                {"label": "Long Term & Other Assets", "value": lt_other,   "color": "asset"},
                {"label": "Cash & Short Term Investments", "value": cash_st, "color": "asset"},
                {"label": "Receivables",   "value": receivable, "color": "asset"},
                {"label": "Physical Assets","value": physical,  "color": "asset"},
                {"label": "Inventory",     "value": inventory,  "color": "asset"},
            ],
            "liabilities": [
                {"label": "Other Liabilities", "value": other_liab,   "color": "liability"},
                {"label": "Equity",             "value": equity,       "color": "equity"},
                {"label": "Debt",               "value": total_debt,   "color": "debt"},
                {"label": "Accounts Payable",   "value": acct_payable, "color": "liability"},
            ],
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/stock/{ticker}/growth")
def get_growth(ticker: str):
    def pct(v):
        try: return round(float(v) * 100, 1) if v is not None else None
        except Exception: return None

    # 1. FMP financial-growth — covers all 6 metrics
    rev_growth = eps_growth = earn_cagr = fcf_growth = bv_cagr = div_growth = None
    try:
        d          = _fmp_company_stats(ticker)
        rev_growth = pct(d.get("revenueGrowth"))
        eps_growth = pct(d.get("epsgrowth"))
        # FMP provides 5y net income CAGR per share directly
        earn_cagr  = pct(d.get("fiveYNetIncomeGrowthPerShare") or d.get("netIncomeGrowth"))
        fcf_growth = pct(d.get("freeCashFlowGrowth"))
        # 5-year book value (equity) CAGR per share
        bv_cagr    = pct(d.get("fiveYShareholdersEquityGrowthPerShare") or d.get("bookValueperShareGrowth"))
        # Dividend growth (prefer 3y CAGR, fall back to YoY)
        div_growth = pct(d.get("threeYDividendperShareGrowthPerShare") or d.get("dividendsPerShareGrowth"))
    except Exception:
        pass

    # 2. yfinance fallback for any still-missing fields
    if any(v is None for v in [rev_growth, eps_growth, earn_cagr, fcf_growth, bv_cagr]):
        try:
            t    = yf.Ticker(ticker.upper())
            info = t.info

            def _cagr(series):
                try:
                    s = series.dropna().sort_index(); s = s[s > 0]
                    if len(s) < 2: return None
                    n = len(s) - 1
                    return round(((float(s.iloc[-1]) / float(s.iloc[0])) ** (1 / n) - 1) * 100, 1)
                except Exception: return None

            if rev_growth is None: rev_growth = pct(info.get("revenueGrowth"))
            if eps_growth is None: eps_growth = pct(info.get("earningsGrowth"))
            if earn_cagr  is None:
                fin = t.financials
                for lbl in ["Net Income", "Net Income Common Stockholders",
                            "Net Income From Continuing Operations"]:
                    if lbl in fin.index: earn_cagr = _cagr(fin.loc[lbl]); break
            if fcf_growth is None:
                cf = t.cashflow
                if "Free Cash Flow" in cf.index:
                    fcf = cf.loc["Free Cash Flow"].dropna().sort_index()
                    if len(fcf) >= 2:
                        a, b = float(fcf.iloc[-2]), float(fcf.iloc[-1])
                        if a != 0: fcf_growth = round((b - a) / abs(a) * 100, 1)
            if bv_cagr is None:
                bs = t.balance_sheet
                for lbl in ["Stockholders Equity", "Total Stockholder Equity",
                            "Common Stock Equity", "Total Equity Gross Minority Interest"]:
                    if lbl in bs.index: bv_cagr = _cagr(bs.loc[lbl]); break
            if div_growth is None:
                divs = t.dividends
                if divs is not None and len(divs) >= 4:
                    if divs.index.tz is not None:
                        divs = divs.copy(); divs.index = divs.index.tz_convert("UTC").tz_localize(None)
                    import datetime as _dt
                    annual = divs.resample("Y").sum()
                    annual = annual[annual.index.year < _dt.datetime.now().year]
                    annual = annual[annual > 0]
                    if len(annual) >= 2:
                        n = min(len(annual) - 1, 3)
                        div_growth = round(
                            ((float(annual.iloc[-1]) / float(annual.iloc[-n - 1])) ** (1 / n) - 1) * 100, 1)
                    else:
                        div_growth = 0.0
        except Exception:
            pass

    metrics = [
        {"id": "revGrowth", "name": "Revenue Growth",
         "value": rev_growth, "target": 15, "targetLabel": "> 15% YoY",
         "description": "Year-over-year revenue growth — shows if the top line is expanding."},
        {"id": "epsTrend",  "name": "EPS Trend",
         "value": eps_growth, "target": 0, "targetLabel": "Positive / stable",
         "description": "Year-over-year EPS growth — indicates improving per-share profitability."},
        {"id": "earnCAGR",  "name": "Earnings Growth (5yr CAGR)",
         "value": earn_cagr, "target": 10, "targetLabel": "> 10% per year",
         "description": "5-year compound annual growth in net earnings — measures sustained profit expansion."},
        {"id": "fcfGrowth", "name": "Free Cash Flow Growth",
         "value": fcf_growth, "target": 0, "targetLabel": "Positive trend",
         "description": "YoY change in free cash flow — rising FCF funds reinvestment and dividends."},
        {"id": "bvGrowth",  "name": "Book Value Growth (5yr)",
         "value": bv_cagr, "target": 8, "targetLabel": "> 8% per year",
         "description": "5-year CAGR of shareholders' equity — reflects compounding of retained earnings."},
        {"id": "divGrowth", "name": "Dividend Growth",
         "value": div_growth, "target": 0, "targetLabel": "Growing or stable",
         "description": "Annual dividend CAGR — consistent growth signals financial health and shareholder commitment."},
    ]
    met   = sum(1 for m in metrics if m["value"] is not None and m["value"] >= m["target"])
    total = sum(1 for m in metrics if m["value"] is not None)
    return {"metrics": metrics, "met": met, "total": total}


@router.get("/stock/{ticker}/profitability")
def get_profitability(ticker: str):
    def pct(v):
        try: return round(float(v) * 100, 1) if v is not None else None
        except Exception: return None

    # 1. FMP: key-metrics-ttm + ratios-ttm cover all 6 metrics
    roic = roe = roa = gross_m = net_m = op_m = None
    try:
        d = _fmp_company_stats(ticker)
        roic    = pct(d.get("returnOnInvestedCapitalTTM"))
        roe     = pct(d.get("returnOnEquityTTM"))
        roa     = pct(d.get("returnOnAssetsTTM"))
        gross_m = pct(d.get("grossProfitMarginTTM"))
        net_m   = pct(d.get("netProfitMarginTTM"))
        op_m    = pct(d.get("operatingProfitMarginTTM"))
    except Exception:
        pass

    # 2. yfinance fallback for any missing fields
    if any(v is None for v in [roic, roe, roa, gross_m, net_m, op_m]):
        try:
            t    = yf.Ticker(ticker.upper())
            info = t.info
            if roe     is None: roe     = pct(info.get("returnOnEquity"))
            if roa     is None: roa     = pct(info.get("returnOnAssets"))
            if gross_m is None: gross_m = pct(info.get("grossMargins"))
            if net_m   is None: net_m   = pct(info.get("profitMargins"))
            if op_m    is None: op_m    = pct(info.get("operatingMargins"))
            if roic is None:
                net_inc    = info.get("netIncomeToCommon")
                total_debt = info.get("totalDebt") or 0
                total_cash = info.get("totalCash") or 0
                bs = t.balance_sheet
                equity = None
                for label in ["Stockholders Equity", "Total Stockholder Equity",
                              "Common Stock Equity", "Total Equity Gross Minority Interest"]:
                    if label in bs.index:
                        equity = float(bs.loc[label].iloc[0]); break
                if net_inc and equity:
                    ic = equity + float(total_debt) - float(total_cash)
                    if ic > 0: roic = round(float(net_inc) / ic * 100, 1)
        except Exception:
            pass

    # 3. Industry averages via sector ETF holdings (top 12 holdings, median)
    ind_roe = ind_roic = ind_roa = None
    try:
        profile_resp = _req.get(
            f"https://financialmodelingprep.com/stable/profile?symbol={ticker}&apikey={FMP_KEY}",
            timeout=6
        ).json()
        fmp_sector = None
        if profile_resp:
            fmp_sector = profile_resp[0].get("sector")

        if fmp_sector:
            avg = _fetch_etf_sector_averages(fmp_sector)
            ind_roe  = avg.get("roe")
            ind_roic = avg.get("roic")
            ind_roa  = avg.get("roa")
    except Exception:
        pass

    metrics = [
        {"id": "roic",   "name": "ROIC",             "value": roic,    "target": 15,
         "description": "Return on Invested Capital — measures how efficiently the company deploys capital."},
        {"id": "roe",    "name": "ROE",               "value": roe,     "target": 15,
         "description": "Return on Equity — profit generated per dollar of shareholders' equity."},
        {"id": "grossM", "name": "Gross Margin",      "value": gross_m, "target": 40,
         "description": "Gross Profit ÷ Revenue — revenue remaining after direct production costs."},
        {"id": "netM",   "name": "Net Profit Margin", "value": net_m,   "target": 20,
         "description": "Net Income ÷ Revenue — the bottom-line margin after all expenses and taxes."},
        {"id": "roa",    "name": "Return on Assets",  "value": roa,     "target": 10,
         "description": "Net Income ÷ Total Assets — how effectively assets generate profit."},
        {"id": "opM",    "name": "Operating Margin",  "value": op_m,    "target": 15,
         "description": "Operating Income ÷ Revenue — profitability from core business operations."},
    ]
    met   = sum(1 for m in metrics if m["value"] is not None and m["value"] >= m["target"])
    total = sum(1 for m in metrics if m["value"] is not None)
    return {
        "metrics": metrics, "met": met, "total": total,
        "industry": {"roe": ind_roe, "roic": ind_roic, "roa": ind_roa},
    }



# ─── Market News (RSS) ──────────────────────────────────────────────────────
_news_cache: dict = {'ts': 0, 'data': []}
_NEWS_TTL = 300   # 5 minutes


def _detect_category(title: str, tickers: list) -> str:
    t = title.lower()
    if any(w in t for w in ['fed', 'federal reserve', 'rate', 'inflation', 'economy', 'gdp', 'jobs', 'unemployment', 'cpi']):
        return 'Economy'
    if any(w in t for w in ['nvidia', 'microsoft', 'apple', 'google', 'amazon', 'meta', ' ai ', 'artificial intelligence', 'tech', 'chip', 'semiconductor']):
        return 'Technology'
    if any(w in t for w in ['oil', 'gold', 'copper', 'opec', 'crude', 'commodity', 'commodities']):
        return 'Commodities'
    if any(w in t for w in ['bitcoin', 'crypto', 'ethereum', 'blockchain']):
        return 'Crypto'
    if any(w in t for w in ['tesla', 'electric vehicle', 'cybertruck', 'ev ', 'auto']):
        return 'Autos'
    if any(w in t for w in ['s&p', 'dow', 'nasdaq', 'wall street', 'market', 'stocks', 'shares', 'index', 'equity']):
        return 'Markets'
    return 'Finance'


@router.get("/news/market")
def get_market_news():
    now = time.time()
    if now - _news_cache['ts'] < _NEWS_TTL and _news_cache['data']:
        return _news_cache['data']

    try:
        url = f"https://financialmodelingprep.com/stable/news/stock-latest?limit=500&apikey={FMP_KEY}"
        resp = _req.get(url, timeout=12).json()
    except Exception:
        return _news_cache.get('data', [])

    seen, unique = set(), []
    for item in (resp if isinstance(resp, list) else []):
        title = (item.get('title') or '').strip()
        link  = (item.get('url')   or '').strip()
        if not title or not link:
            continue
        key = title[:60].lower()
        if key in seen:
            continue
        seen.add(key)

        pub = item.get('publishedDate') or ''
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(pub.replace('Z', '+00:00'))
            ts = dt.timestamp()
        except Exception:
            ts = now

        diff = int((now - ts) / 60)
        age  = f"{max(1, diff)}m" if diff < 60 else (
               f"{diff // 60}h"   if diff < 1440 else
               f"{diff // 1440}d")

        tickers = item.get('tickers') or []
        unique.append({
            'title':    title,
            'link':     link,
            'source':   item.get('site') or item.get('publisher') or 'FMP News',
            'age':      age,
            'image':    item.get('image') or None,
            'tickers':  tickers[:5],
            'category': _detect_category(title, tickers),
        })
        if len(unique) == 500:
            break

    if unique:
        _news_cache.update({'ts': now, 'data': unique})
    return unique or _news_cache.get('data', [])



# ─── Recent IPOs (SEC EDGAR 8-A12B filings — free, no API key) ───────────────
_ipo_cache: dict = {'ts': 0, 'data': []}
_IPO_TTL = 14400   # 4 hours

# Patterns that indicate non-IPO listings (ETFs, SPACs, structured products)
# Use word-boundary-aware substrings (leading/trailing space or punctuation)
_IPO_SKIP = [
    'trust', 'acquisition', ' spac ', 'spac,', '(spac)', ' etf ', 'etf,', '(etf)',
    ' fund', ' notes', 'warrant', 'blank check', 'blank-check', 'depositary',
    'preferred', 'certificate', 'limited partnership', ' lp ', 'royalty',
]


def _edgar_ipo_tickers(days_back: int = 90) -> list:
    """Return [(file_date, ticker, company_name)] from SEC EDGAR 8-A12B filings."""
    from datetime import date, timedelta
    import re as _re

    end_d   = date.today()
    start_d = end_d - timedelta(days=days_back)
    url = (
        "https://efts.sec.gov/LATEST/search-index"
        f"?forms=8-A12B&dateRange=custom&startdt={start_d}&enddt={end_d}"
        "&_source=display_names,file_date&from=0&size=200"
    )
    try:
        resp = _req.get(url, timeout=12,
                        headers={'User-Agent': 'StockView/1.0 contact@stockview.app'})
        hits = resp.json().get('hits', {}).get('hits', [])
    except Exception:
        return []

    candidates, seen = [], set()
    for h in hits:
        src       = h.get('_source', {})
        names     = src.get('display_names', [])
        file_date = src.get('file_date', '')
        if not names or not file_date:
            continue

        raw_name = names[0]
        low_name = raw_name.lower()

        # Skip ETFs, SPACs, structured products
        if any(kw in low_name for kw in _IPO_SKIP):
            continue

        # Extract exactly ONE ticker symbol (A-Z, 1-5 chars) from parentheses
        tickers = _re.findall(r'\(([A-Z]{1,5})\)', raw_name)
        if len(tickers) != 1:
            continue

        ticker  = tickers[0]
        company = raw_name.split('(')[0].strip().rstrip(',').strip()

        if ticker in seen:
            continue
        seen.add(ticker)
        candidates.append((file_date, ticker, company))

    # Newest first
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates


@router.get("/ipo/recent")
def get_recent_ipos():
    from datetime import datetime as _dt

    now = time.time()
    if now - _ipo_cache['ts'] < _IPO_TTL and _ipo_cache['data']:
        return _ipo_cache['data']

    candidates = _edgar_ipo_tickers(days_back=120)

    results = []
    for file_date, ticker, company in candidates:
        if len(results) >= 12:
            break
        try:
            # Try max history first; fall back to 5d for brand-new listings
            # (period='max' raises an exception on day-1 stocks, so catch it)
            t_obj = yf.Ticker(ticker)
            try:
                hist = t_obj.history(period='max')
            except Exception:
                hist = pd.DataFrame()
            if hist.empty:
                try:
                    hist = t_obj.history(period='5d')
                except Exception:
                    hist = pd.DataFrame()
            if hist.empty:
                continue

            # Skip if stock has trading history older than 200 days
            # (8-A12B amendments from established companies filing secondary listings)
            first_idx = hist.index[0]
            try:
                first_naive = first_idx.to_pydatetime().replace(tzinfo=None)
            except Exception:
                first_naive = _dt.utcnow()
            days_listed = (_dt.utcnow() - first_naive).days
            if days_listed > 200:
                continue

            # IPO price: use open of first bar if available, else first close
            ipo_price = float(hist['Open'].iloc[0]) if hist['Open'].iloc[0] > 0 else float(hist['Close'].iloc[0])
            current_price = float(hist['Close'].iloc[-1])

            # Skip bad data (sub-penny prices)
            if ipo_price < 0.5:
                continue

            # Day-1 IPO: return vs open → close
            if len(hist) == 1:
                change = (current_price - ipo_price) / ipo_price * 100
            else:
                change = (current_price - ipo_price) / ipo_price * 100

            d         = _dt.strptime(file_date, '%Y-%m-%d')
            formatted = f"{d.strftime('%b')} {d.day}"

            results.append({
                'date':   formatted,
                'ticker': ticker,
                'name':   company,
                'price':  round(ipo_price, 2),
                'change': round(change, 1),
            })
        except Exception:
            continue

    _ipo_cache.update({'ts': now, 'data': results})
    return results


# ─── Stock Screener ───────────────────────────────────────────────────────────
# Background-cache model: the endpoint always responds instantly.
# A daemon thread builds / refreshes the cache asynchronously.
#
# Universe: S&P 500 + popular large/mid/small-caps (~550 tickers).
# Yahoo Finance's free API rate-limits aggressively on bulk requests, so we
# use a small worker pool (8) + per-ticker retry on 429 errors to reliably
# get 400+ stocks without getting blocked.

_screener_cache: dict  = {"ts": 0, "data": [], "building": False}
_SCREENER_TTL          = 4 * 3600   # 4 hours
_screener_lock         = threading.Lock()

_SCREENER_UNIVERSE = [
    # ── S&P 500 core ─────────────────────────────────────────────────────────
    "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A","APD","ABNB",
    "AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL","GOOG","MO","AMZN",
    "AMCR","AEE","AAL","AEP","AXP","AIG","AMT","AWK","AMP","AME","AMGN","APH",
    "ADI","ANSS","AON","APA","AAPL","AMAT","APTV","ACGL","ADM","ANET","AJG",
    "AIZ","T","ATO","ADSK","AZO","AVB","AVY","AXON","BKR","BALL","BAC","BK",
    "BBWI","BAX","BDX","BBY","BIIB","BLK","BX","BA","BKNG","BWA","BSX","BMY",
    "AVGO","BR","BRO","BLDR","CHRW","CDNS","CZR","CPT","CPB","COF","CAH",
    "KMX","CCL","CARR","CAT","CBOE","CBRE","CDW","CE","COR","CNC","SCHW",
    "CHTR","CVX","CMG","CB","CHD","CI","CINF","CTAS","CSCO","C","CFG","CLX",
    "CME","CMS","KO","CTSH","CL","CMCSA","CMA","CAG","COP","ED","STZ","CEG",
    "COO","CPRT","GLW","CTVA","CSGP","COST","CTRA","CCI","CSX","CMI","CVS",
    "DHI","DHR","DRI","DVA","DE","DELL","DAL","DVN","DXCM","FANG","DLR","DFS",
    "DG","DLTR","D","DPZ","DOV","DOW","DTE","DUK","DD","EMN","ETN","EBAY",
    "ECL","EIX","EW","EA","ELV","LLY","EMR","ENPH","ETR","EOG","EPAM","EQT",
    "EFX","EQIX","EQR","ESS","EL","ETSY","EG","EVRG","ES","EXC","EXPE",
    "EXPD","EXR","XOM","FFIV","FDS","FICO","FAST","FRT","FDX","FIS","FITB",
    "FSLR","FE","FI","FMC","F","FTNT","FTV","FOXA","FOX","BEN","FCX","GRMN",
    "IT","GE","GEHC","GEN","GNRC","GD","GIS","GM","GPC","GILD","GS","HAL",
    "HIG","HAS","HCA","HSIC","HSY","HES","HPE","HLT","HOLX","HD","HON","HRL",
    "HST","HWM","HPQ","HUBB","HUM","HBAN","HII","IBM","IEX","IDXX","ITW",
    "INCY","IR","INTC","ICE","IFF","IP","IPG","INTU","ISRG","IVZ","INVH",
    "IQV","IRM","JBHT","JBL","JKHY","J","JNJ","JCI","JPM","K","KVUE","KDP",
    "KEY","KEYS","KMB","KIM","KMI","KLAC","KHC","KR","LHX","LH","LRCX","LW",
    "LVS","LDOS","LEN","LIN","LYV","LKQ","LMT","L","LOW","LULU","LYB","MTB",
    "MRO","MPC","MKTX","MAR","MMC","MLM","MAS","MA","MTCH","MKC","MCD","MCK",
    "MDT","MRK","META","MET","MTD","MGM","MCHP","MU","MSFT","MAA","MRNA",
    "MOH","TAP","MDLZ","MPWR","MNST","MCO","MS","MOS","MSI","MSCI","NDAQ",
    "NTAP","NFLX","NEM","NWSA","NWS","NEE","NKE","NI","NDSN","NSC","NTRS",
    "NOC","NCLH","NRG","NUE","NVDA","NVR","NXPI","ORLY","OXY","ODFL","OMC",
    "ON","OKE","ORCL","OTIS","PCAR","PKG","PANW","PH","PAYX","PYPL","PNR",
    "PEP","PFE","PCG","PM","PSX","PNW","PNC","POOL","PPG","PPL","PFG","PG",
    "PGR","PRU","PEG","PTC","PSA","PHM","PWR","QCOM","DGX","RL","RJF","RTX",
    "O","REG","REGN","RF","RSG","RMD","ROK","ROL","ROP","ROST","RCL","SPGI",
    "CRM","SBAC","SLB","STX","SRE","NOW","SHW","SPG","SWKS","SJM","SNA","SO",
    "LUV","SWK","SBUX","STT","STLD","STE","SYK","SMCI","SYF","SNPS","SYY",
    "TMUS","TROW","TTWO","TPR","TRGP","TGT","TEL","TDY","TFX","TER","TSLA",
    "TXN","TXT","TMO","TJX","TSCO","TT","TDG","TRV","TRMB","TFC","TYL","TSN",
    "USB","UBER","UDR","ULTA","UNP","UAL","UPS","URI","UNH","UHS","VLO","VTR",
    "VRSN","VRSK","VZ","VRTX","VTRS","VICI","V","VMC","WAB","WBA","WMT","DIS",
    "WBD","WM","WAT","WEC","WFC","WELL","WST","WDC","WY","WHR","WMB","WTW",
    "WYNN","XEL","XYL","YUM","ZBRA","ZBH","ZION","ZTS",
    # ── High-profile growth / tech ────────────────────────────────────────────
    "COIN","MSTR","MARA","RIOT","PLTR","SNOW","NET","DDOG","CRWD","ZS","MDB",
    "SHOP","HOOD","SOFI","AFRM","RIVN","LCID","NIO","BABA","TSM","ASML","SE",
    "SQ","DASH","RBLX","ROKU","ZM","DOCU","TWLO","TTD","OKTA","PATH","AI",
    "LYFT","PINS","SNAP","SPOT","PARA","NTNX","GTLB","BILL","HUBS","CFLT",
    "APP","APLD","SOUN","IONQ","QUBT","RGTI","ARRY","BLNK","CHPT","EVGO",
    # ── Finance / banking ─────────────────────────────────────────────────────
    "GS","MS","BAC","WFC","JPM","C","BLK","SCHW","AXP","V","MA","PYPL","SQ",
    "HOOD","SOFI","AFRM","LC","UPST","NU","ALLY","COF","DFS","SYF","CACC",
    # ── Energy ───────────────────────────────────────────────────────────────
    "XOM","CVX","COP","EOG","PXD","MPC","VLO","PSX","OXY","HES","DVN","FANG",
    "SLB","HAL","BKR","NOV","RIG","VAL","HP","WHD",
    # ── Healthcare / biotech ──────────────────────────────────────────────────
    "MRNA","BNTX","PFE","JNJ","ABBV","AMGN","GILD","REGN","VRTX","BMY","LLY",
    "NVO","AZN","RGEN","EXAS","ILMN","DXCM","PODD","INMD","TDOC","HIMS","RXRX",
    # ── Consumer ─────────────────────────────────────────────────────────────
    "AMZN","WMT","TGT","COST","HD","LOW","TJX","ROST","BBY","DG","DLTR","FIVE",
    "LULU","NKE","VFC","PVH","RL","TPR","CPRI","G","DNKN","CMG","MCD","SBUX",
    "YUM","QSR","DRI","EAT","TXRH","CAKE","DNUT",
    # ── Semiconductors ───────────────────────────────────────────────────────
    "NVDA","AMD","INTC","QCOM","AVGO","TXN","MU","MCHP","ADI","KLAC","LRCX",
    "AMAT","ASML","TSM","SWKS","QRVO","ON","WOLF","NXPI","STM","IFNNY",
    # ── Chinese ADRs / international ─────────────────────────────────────────
    "BABA","JD","PDD","BIDU","NIO","XPEV","LI","TCEHY","NTES","TME","YUMC",
    # ── REITs ────────────────────────────────────────────────────────────────
    "AMT","CCI","EQIX","PLD","SPG","O","WELL","VTR","EQR","AVB","ESS","MAA",
    "DLR","IRM","PSA","EXR","LSI","NSA","CUBE","REXR","COLD","FR",
    # ── Utilities ────────────────────────────────────────────────────────────
    "NEE","DUK","SO","D","AEE","AEP","ETR","EXC","PCG","PPL","XEL","ED","ES",
    "WEC","CMS","NI","LNT","EVRG","PNW","OGE","AVA","NWE","MGEE","OTTR",
    # ── Airlines / travel ────────────────────────────────────────────────────
    "DAL","UAL","AAL","LUV","JBLU","ALK","HA","SAVE","BKNG","EXPE","ABNB",
    "TRIP","CCL","RCL","NCLH","HLT","MAR","H","IHG","MGM","WYNN","LVS",
]

# Semaphore: cap total concurrent FMP calls (profile + ratios-ttm per ticker).
# Conservative limit: 8 slots keeps us well under FMP's $29-plan rate limit.
_screener_fmp_sem = threading.Semaphore(8)

def _fetch_screener_stock(ticker: str):
    """
    Fetch screener fields for one ticker via 2 direct FMP calls
    (profile + ratios-ttm) under a shared rate-limit semaphore.
    Retries once on HTTP 429 after a 65-second back-off.
    No nested ThreadPoolExecutor — safe to call from many threads simultaneously.
    """
    tk = ticker.upper()
    BASE = "https://financialmodelingprep.com/stable"

    def _fmp_get(endpoint: str) -> dict:
        """GET one FMP endpoint; acquires semaphore slot; retries once on 429."""
        for attempt in range(2):
            with _screener_fmp_sem:
                try:
                    url = f"{BASE}/{endpoint}&apikey={FMP_KEY}"
                    r   = _req.get(url, timeout=15)
                    if r.status_code == 429:
                        if attempt == 0:
                            time.sleep(65)   # wait for rate-limit window to reset
                            continue
                        return {}
                    if r.ok:
                        d = r.json()
                        if isinstance(d, list):
                            return d[0] if d else {}
                        return d if isinstance(d, dict) else {}
                except Exception:
                    pass
            return {}
        return {}

    try:
        # 2 sequential FMP calls — profile first (cheaper), then ratios-ttm
        prof = _fmp_get(f"profile?symbol={tk}")
        rat  = _fmp_get(f"ratios-ttm?symbol={tk}")
        km   = {}   # key-metrics-ttm omitted to save API quota; ROE/ROA from ratios proxy

        price = float(prof.get("price") or 0)
        if price <= 0:
            return None

        # Filter out ETFs and funds (keep ADRs — they're US-listed foreign stocks)
        if prof.get("isEtf") or prof.get("isFund"):
            return None

        mktcap  = float(prof.get("marketCap") or 0)
        chg_pct = float(prof.get("changePercentage") or 0)

        # 52-week range from profile "range" field ("195.07-317.40")
        w52h = w52l = None
        if prof.get("range"):
            parts = str(prof["range"]).split("-")
            if len(parts) == 2:
                try:
                    w52l, w52h = float(parts[0]), float(parts[1])
                except Exception:
                    pass

        w52pct = None
        if w52h and w52l and w52h > w52l:
            w52pct = round((price - w52l) / (w52h - w52l) * 100, 1)

        # Financial ratios from ratios-ttm
        pe  = rat.get("priceToEarningsRatioTTM")
        pb  = rat.get("priceToBookRatioTTM")
        ps  = rat.get("priceToSalesRatioTTM")
        gm  = rat.get("grossProfitMarginTTM")
        nm  = rat.get("netProfitMarginTTM")
        de  = rat.get("debtToEquityRatioTTM")
        cr  = rat.get("currentRatioTTM")
        ic  = rat.get("interestCoverageRatioTTM")
        at  = rat.get("assetTurnoverTTM")
        # ROE/ROA proxy from ratios-ttm (better than nothing without key-metrics-ttm)
        # net margin × asset turnover ≈ ROA (DuPont)
        roe_proxy = None
        roa_proxy = None
        if nm is not None and at is not None:
            roa_proxy = float(nm) * float(at)
        ocf_sales = rat.get("operatingCashFlowSalesRatioTTM")  # OCF / Revenue

        # Dividend yield: profile lastDividend (annual $) / price
        last_div  = float(prof.get("lastDividend") or 0)
        div_yield = round(last_div / price * 100, 2) if last_div and price else None

        # EPS derived from PE and price
        eps = round(price / float(pe), 2) if pe and float(pe) > 0 else None

        name     = (prof.get("companyName") or tk)[:40]
        sector   = prof.get("sector")   or "Other"
        industry = prof.get("industry") or "—"
        beta     = prof.get("beta")
        volume   = int(prof.get("volume")         or 0)
        avg_vol  = int(prof.get("averageVolume")  or 0)

        # ── Snowflake scores (0–5 per axis) ──────────────────────────────
        def _clamp(v): return max(0, min(5, v))

        # Valuation: PE, PB, PS
        val_s = 0
        if pe and float(pe) > 0:
            v = float(pe)
            val_s += 2 if v < 15 else (1 if v < 25 else 0)
        if pb and float(pb) > 0:
            v = float(pb)
            val_s += 2 if v < 1.5 else (1 if v < 3 else 0)
        if ps and float(ps) > 0 and float(ps) < 2:
            val_s += 1

        # Profitability: gross/net margins + ROE
        prof_s = 0
        if gm:
            v = float(gm)
            prof_s += 2 if v > 0.50 else (1 if v > 0.30 else 0)
        if nm:
            v = float(nm)
            prof_s += 2 if v > 0.15 else (1 if v > 0.05 else 0)
        if roa_proxy is not None and roa_proxy > 0.08:
            prof_s += 1   # DuPont ROA proxy

        # Growth: 52-week momentum + today's direction
        grow_s = 0
        if w52pct is not None:
            grow_s += 2 if w52pct > 70 else (1 if w52pct > 50 else 0)
        if chg_pct > 0:
            grow_s += 1
        if chg_pct > 2:
            grow_s += 1
        if nm and float(nm) > 0.15:   # high net margin → room for growth reinvestment
            grow_s += 1

        # Health: D/E, current ratio, interest coverage
        health_s = 0
        if de is not None:
            v = float(de)
            health_s += 2 if v < 0.5 else (1 if v < 1.0 else 0)
        if cr is not None:
            v = float(cr)
            health_s += 2 if v > 2 else (1 if v > 1 else 0)
        if ic and float(ic) > 5:
            health_s += 1

        # Efficiency: asset turnover, DuPont ROA proxy, OCF/Sales
        eff_s = 0
        if at:
            v = float(at)
            eff_s += 2 if v > 1.0 else (1 if v > 0.5 else 0)
        if roa_proxy is not None and roa_proxy > 0.10:
            eff_s += 1
        if ocf_sales and float(ocf_sales) > 0.15:   # strong operating cash conversion
            eff_s += 2
        elif ocf_sales and float(ocf_sales) > 0.05:
            eff_s += 1

        sf = {
            "value":         _clamp(val_s),
            "profitability": _clamp(prof_s),
            "growth":        _clamp(grow_s),
            "health":        _clamp(health_s),
            "efficiency":    _clamp(eff_s),
        }
        sf["total"] = sum(sf.values())

        def fmtcap(n):
            if not n: return None
            n = float(n)
            if n >= 1e12: return f"${n/1e12:.2f}T"
            if n >= 1e9:  return f"${n/1e9:.1f}B"
            if n >= 1e6:  return f"${n/1e6:.0f}M"
            return None

        def fmtvol(n):
            if not n: return None
            n = int(n)
            if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
            if n >= 1_000:     return f"{n/1_000:.0f}K"
            return str(n)

        return {
            "ticker":       tk,
            "name":         name,
            "sector":       sector,
            "industry":     industry,
            "price":        round(price, 2),
            "changePct":    round(chg_pct, 2),
            "marketCap":    mktcap if mktcap else None,
            "marketCapFmt": fmtcap(mktcap),
            "pe":           round(float(pe), 1)  if pe  and float(pe)  > 0 and float(pe)  < 1000 else None,
            "fwdPE":        None,
            "eps":          eps,
            "divYield":     div_yield,
            "payout":       None,
            "revenue":      None,
            "volume":       fmtvol(volume),
            "avgVolume":    fmtvol(avg_vol),
            "beta":         round(float(beta), 2) if beta else None,
            "pb":           round(float(pb), 2)   if pb  and float(pb)  > 0 else None,
            "ps":           round(float(ps), 2)   if ps  and float(ps)  > 0 else None,
            "w52High":      w52h,
            "w52Low":       w52l,
            "w52Pct":       w52pct,
            "snowflake":    sf,
        }
    except Exception:
        return None


def _build_screener_cache():
    """Background worker: fetch all stocks from FMP and populate the screener cache.
    Strategy: 10 outer workers, each making 2 sequential FMP calls under a shared
    semaphore (8 slots) → max 8 concurrent FMP requests at any time.
    On 429 rate-limit errors, each worker backs off 65 s before retrying.
    First build: ~3–5 min for ~590 tickers.  Cached for 4 hours.
    """
    global _screener_cache
    with _screener_lock:
        if _screener_cache.get("building"):
            return
        _screener_cache["building"] = True

    try:
        # Deduplicate universe preserving insertion order
        seen, universe = set(), []
        for tk in _SCREENER_UNIVERSE:
            if tk not in seen:
                seen.add(tk)
                universe.append(tk)

        results = []
        # 10 workers; concurrency capped to 8 FMP calls via _screener_fmp_sem
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
            futs = {ex.submit(_fetch_screener_stock, t): t for t in universe}
            for fut in concurrent.futures.as_completed(futs):
                r = fut.result()
                if r:
                    results.append(r)

        results.sort(key=lambda x: x.get("marketCap") or 0, reverse=True)
        with _screener_lock:
            _screener_cache = {"ts": time.time(), "data": results, "building": False}
    except Exception:
        with _screener_lock:
            _screener_cache["building"] = False

# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/screener")
def get_screener():
    """
    Always returns instantly — cached data, or [] while the background
    thread is still building.  Frontend polls every 10 s until data arrives.
    """
    fresh = (time.time() - _screener_cache["ts"]) < _SCREENER_TTL
    if fresh and _screener_cache["data"]:
        return _screener_cache["data"]

    if not _screener_cache.get("building"):
        threading.Thread(target=_build_screener_cache, daemon=True).start()

    return _screener_cache["data"]

@router.get("/screener/ticker/{ticker}")
def get_screener_ticker(ticker: str):
    """
    On-demand fetch for a single ticker — lets the screener search any stock
    from the EDGAR list even if it's not in the cached bulk universe.
    Returns the same shape as a row in /api/screener.
    """
    tk = ticker.strip().upper()
    # Check cache first
    for row in _screener_cache.get("data", []):
        if row.get("ticker") == tk:
            return row
    result = _fetch_screener_stock(tk)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No data for {tk}")
    return result


# ─── Market Movers ────────────────────────────────────────────────────────────

_movers_cache: dict = {"ts": 0, "data": {}}
_MOVERS_TTL = 5 * 60   # 5 minutes

@router.get("/movers")
def get_movers():
    """Real-time top gainers and losers via yfinance screener.
    Filtered to liquid, meaningful stocks (no penny stocks / micro-caps).
    """
    if time.time() - _movers_cache["ts"] < _MOVERS_TTL and _movers_cache["data"]:
        return _movers_cache["data"]

    def _parse(quotes, limit=10):
        out = []
        for q in quotes:
            sym   = q.get("symbol", "")
            price = float(q.get("regularMarketPrice") or 0)
            chg   = float(q.get("regularMarketChangePercent") or 0)
            if not sym or price <= 0:
                continue
            out.append({
                "ticker": sym,
                "name":   (q.get("shortName") or q.get("longName") or sym)[:35],
                "price":  round(price, 2),
                "change": round(chg, 2),
            })
            if len(out) >= limit:
                break
        return out

    try:
        gainers_raw = yf.screen("day_gainers", count=10).get("quotes", [])
        losers_raw  = yf.screen("day_losers",  count=10).get("quotes", [])
        data = {
            "gainers": _parse(gainers_raw),
            "losers":  _parse(losers_raw),
        }
        _movers_cache.update({"ts": time.time(), "data": data})
        return data
    except Exception:
        return _movers_cache.get("data") or {"gainers": [], "losers": []}


# ─── Crypto Markets ───────────────────────────────────────────────────────────

_CRYPTO_PAIRS = [
    "BTCUSD","ETHUSD","BNBUSD","XRPUSD","SOLUSD",
    "TRXUSD","DOGEUSD","ADAUSD","BCHUSD","LINKUSD",
    "XLMUSD","SUIUSD","ZECUSD","AVAXUSD","LTCUSD",
    "HBARUSD","SHIBUSD","TONUSD","DOTUSD","UNIUSD",
]

_crypto_cache: dict = {"ts": 0, "data": None}
_CRYPTO_TTL = 60  # 1-minute live refresh


_CRYPTO_NAMES = {
    "BTCUSD":"Bitcoin",  "ETHUSD":"Ethereum",  "BNBUSD":"BNB",
    "XRPUSD":"XRP",      "SOLUSD":"Solana",     "TRXUSD":"TRON",
    "DOGEUSD":"Dogecoin","ADAUSD":"Cardano",    "BCHUSD":"Bitcoin Cash",
    "LINKUSD":"Chainlink","XLMUSD":"Stellar",   "SUIUSD":"Sui",
    "ZECUSD":"Zcash",    "AVAXUSD":"Avalanche", "LTCUSD":"Litecoin",
    "HBARUSD":"Hedera",  "SHIBUSD":"Shiba Inu", "TONUSD":"Toncoin",
    "DOTUSD":"Polkadot", "UNIUSD":"Uniswap",
}


@router.get("/crypto")
def get_crypto():
    """Return live crypto data + 30-day sparklines for top coins.
    Strategy: one call per coin to stable/historical-price-eod/full (30-day window)
    gives price, change, dayH/L, and sparkline series all in one response.
    20 calls fired in parallel → wall-clock time ≈ one round-trip (~1-2 s).
    Result cached 60 s."""
    if time.time() - _crypto_cache["ts"] < _CRYPTO_TTL and _crypto_cache["data"]:
        return _crypto_cache["data"]

    from datetime import datetime, timedelta
    from_dt = (datetime.utcnow() - timedelta(days=32)).strftime("%Y-%m-%d")

    def _fetch_coin(sym):
        r = _req.get(
            f"https://financialmodelingprep.com/stable/historical-price-eod/full"
            f"?symbol={sym}&from={from_dt}&apikey={FMP_KEY}", timeout=15)
        r.raise_for_status()
        rows = r.json() or []  # newest-first from API
        if not rows:
            return (sym, None)
        latest   = rows[0]
        # Build sparkline oldest→newest (left-to-right in chart)
        spark    = [{"t": row["date"], "c": row["close"]} for row in reversed(rows)]
        return (sym, {
            "price":            latest.get("close"),
            "change":           latest.get("change"),
            "changesPercentage":latest.get("changePercent"),
            "dayHigh":          latest.get("high"),
            "dayLow":           latest.get("low"),
            "volume":           latest.get("volume"),
            "sparkline":        spark,
        })

    try:
        results: dict = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(_CRYPTO_PAIRS)) as pool:
            futures = {pool.submit(_fetch_coin, s): s for s in _CRYPTO_PAIRS}
            for fut in concurrent.futures.as_completed(futures):
                try:
                    sym, val = fut.result()
                    results[sym] = val
                except Exception:
                    pass

        coins = []
        for sym in _CRYPTO_PAIRS:
            short = sym.replace("USD", "")
            d     = results.get(sym) or {}
            coins.append({
                "symbol":            short,
                "pair":              sym,
                "name":              _CRYPTO_NAMES.get(sym, short),
                "price":             d.get("price"),
                "change":            d.get("change"),
                "changesPercentage": d.get("changesPercentage"),
                "dayHigh":           d.get("dayHigh"),
                "dayLow":            d.get("dayLow"),
                "volume":            d.get("volume"),
                "sparkline":         d.get("sparkline", []),
            })

        data = {"coins": coins}
        _crypto_cache.update({"ts": time.time(), "data": data})
        return data

    except Exception as exc:
        if _crypto_cache["data"]:
            return _crypto_cache["data"]
        raise HTTPException(status_code=502, detail=str(exc))


# ─── Sector Stock Heatmap (treemap) ──────────────────────────────────────────
_HEATMAP_STOCKS = {
    # XLK ~67  (removed JNPR/HPE acq, SPLK/Cisco acq, COUP/private; added DELL SWKS QRVO)
    'Technology': [
        'AAPL','MSFT','NVDA','AVGO','ORCL','AMD','QCOM','TXN','INTC','ADI',
        'MU','AMAT','ADBE','CRM','NOW','INTU','LRCX','KLAC','SNPS','CDNS',
        'MRVL','FTNT','PANW','CRWD','ANSS','KEYS','TRMB','VRSN','TDY','FSLR',
        'ENPH','MPWR','AKAM','ZBRA','GRMN','HPQ','HPE','CSCO','IBM','ACN',
        'CTSH','GLW','STX','WDC','NTAP','DELL','FFIV','PTC','EPAM','PAYC',
        'GDDY','TWLO','ZS','OKTA','DDOG','SNOW','MDB','NET','HUBS','VEEV',
        'WDAY','SWKS','QRVO','TTD','DOCN','APP','ANET',
    ],
    # XLF ~73
    'Financials': [
        'JPM','BAC','WFC','GS','MS','BLK','C','AXP','SCHW','USB',
        'PNC','TFC','COF','CB','MMC','AON','BX','APO','KKR','CBOE',
        'ARES','MA','V','PYPL','FIS','FISV','ICE','CME','NDAQ','SPGI',
        'MCO','MTB','RF','HBAN','CFG','KEY','ZION','WRB','ALL','PRU',
        'MET','AFL','AIG','HIG','LNC','GL','PFG','TROW','IVZ','BEN',
        'AMP','RJF','STT','BK','NTRS','SYF','DFS','ALLY','CMA','FHN',
        'FITB','WAL','WBS','IBKR','LPLA','SF','HLNE','EVR','LAZ','MC',
        'COIN','FNF','FAF',
    ],
    # XLV ~63
    'Health Care': [
        'UNH','LLY','JNJ','ABBV','MRK','TMO','ABT','DHR','AMGN','BMY',
        'PFE','GILD','CVS','CI','HUM','MDT','BSX','SYK','EW','ISRG',
        'VRTX','REGN','ZBH','BAX','BDX','IQV','CNC','MOH','HCA','DVA',
        'RMD','HOLX','IDXX','MTD','A','WAT','TFX','ALGN','HSIC','TECH',
        'PODD','INSP','ITGR','MMSI','AMED','ACAD','ALNY','BMRN','EXAS',
        'FATE','IONS','NBIX','PCVX','RXRX','SGEN','SRPT','RARE','IMVT',
        'KRYS','LEGN','ROIV','TGTX','UTHR','XNCR','ZLAB',
    ],
    # XLY ~51
    'Consumer Disc.': [
        'AMZN','TSLA','HD','MCD','NKE','SBUX','LOW','TJX','BKNG','GM',
        'F','ORLY','AZO','ROST','YUM','HLT','MAR','DHI','LEN','PHM',
        'NVR','TOL','POOL','RH','WSM','BBY','ETSY','EBAY','W','CHWY',
        'DKNG','MGM','LVS','WYNN','CZR','HAS','MAT','CPRI','TPR','PVH',
        'RL','VFC','LULU','UAA','GPS','ANF','URBN','BOOT','CROX','DECK',
        'SKX',
    ],
    # XLP ~37
    'Cons. Staples': [
        'WMT','PG','KO','PEP','COST','PM','MO','CL','MDLZ','GIS',
        'KHC','HSY','SJM','MKC','CHD','CLX','KMB','EL','STZ','TSN',
        'HRL','CAG','CPB','K','TAP','BG','INGR','THS','COTY','REYN',
        'CENT','CENTA','LANC','JBSS','FRPT','VITL','ENIC',
    ],
    # XLI ~79
    'Industrials': [
        'CAT','HON','UPS','BA','GE','RTX','DE','LMT','MMM','NOC',
        'GD','ITW','EMR','PH','ROK','ETN','DOV','IR','CARR','OTIS',
        'CTAS','RSG','WM','XYL','EXPD','CHRW','FDX','CSX','NSC','UNP',
        'DAL','UAL','AAL','LUV','ALK','JBLU','SKYW','SAVE','GNRC','AXON',
        'TDG','HEI','SPR','HII','TXT','LDOS','SAIC','BAH','CACI','MANT',
        'J','ACM','PWR','MTZ','MYR','WESCO','GWW','MSC','AIT','FAST',
        'SNA','SWK','PNR','ALLE','RXO','ODFL','HUBG','TFII','DXPE','MRC',
        'MIDD','RBC','TREX','IBP','APOG',
    ],
    # XLE ~23
    'Energy': [
        'XOM','CVX','COP','EOG','SLB','MPC','VLO','PSX','OXY','DVN',
        'HAL','BKR','FANG','HES','MRO','APA','CTRA','PR','MGY','MTDR',
        'VTLE','SM','CLR',
    ],
    # XLC ~26
    'Comm. Services': [
        'GOOGL','GOOG','META','NFLX','DIS','CMCSA','T','VZ','CHTR','TMUS',
        'EA','TTWO','MTCH','FOXA','FOX','OMC','IPG','WBD','LYV','PARA',
        'NWSA','NWS','LBRDK','LBRDA','IAC','ZM',
    ],
    # XLB ~28
    'Materials': [
        'LIN','APD','SHW','FCX','NEM','DD','ECL','PPG','ALB','CF',
        'MOS','VMC','MLM','BLL','PKG','IP','SEE','IFF','EMN','CE',
        'OLN','AXTA','RPM','FMC','AVY','CCK','ATR','SON',
    ],
    # XLRE ~31
    'Real Estate': [
        'AMT','PLD','EQIX','CCI','PSA','O','SPG','WELL','DLR','AVB',
        'EQR','ESS','MAA','UDR','EXR','INVH','VTR','ARE','BXP','KIM',
        'REG','FRT','SLG','VICI','GLPI','MPW','IIPR','COLD','STAG','REXR',
        'FR',
    ],
    # XLU ~31
    'Utilities': [
        'NEE','DUK','SO','D','AEP','EXC','XEL','SRE','ES','ED',
        'WEC','ETR','FE','CMS','NI','AES','PPL','AWK','CNP','EVRG',
        'LNT','OGE','PNW','POR','AVA','IDA','NWE','UTL','YORW','MSEX',
        'CWCO',
    ],
}

# ETF label → sector name mapping
_ETF_TO_SECTOR = {
    'XLK': 'Technology', 'XLF': 'Financials', 'XLV': 'Health Care',
    'XLY': 'Consumer Disc.', 'XLP': 'Cons. Staples', 'XLI': 'Industrials',
    'XLE': 'Energy', 'XLC': 'Comm. Services', 'XLB': 'Materials',
    'XLRE': 'Real Estate', 'XLU': 'Utilities',
}

_ETF_NAMES = {
    'XLK': 'Technology Select Sector SPDR® ETF',
    'XLF': 'Financial Select Sector SPDR® ETF',
    'XLV': 'Health Care Select Sector SPDR® ETF',
    'XLY': 'Consumer Discretionary Select Sector SPDR® ETF',
    'XLP': 'Consumer Staples Select Sector SPDR® ETF',
    'XLI': 'Industrial Select Sector SPDR® ETF',
    'XLE': 'Energy Select Sector SPDR® ETF',
    'XLC': 'Communication Services Select Sector SPDR® ETF',
    'XLB': 'Materials Select Sector SPDR® ETF',
    'XLRE': 'Real Estate Select Sector SPDR® ETF',
    'XLU': 'Utilities Select Sector SPDR® ETF',
}
_heatmap_cache: dict = {'ts': 0, 'data': None}
_HEATMAP_TTL = 60


def _fetch_heatmap_stock(args):
    symbol, sector = args
    try:
        url = f"https://financialmodelingprep.com/stable/quote?symbol={symbol}&apikey={FMP_KEY}"
        d = _req.get(url, timeout=8).json()
        q = d[0] if d else {}
        return {
            'symbol':    symbol,
            'sector':    sector,
            'name':      q.get('name', symbol),
            'price':     q.get('price'),
            'change':    round(q.get('changePercentage') or 0, 2),
            'marketCap': q.get('marketCap') or 0,
        }
    except Exception:
        return {'symbol': symbol, 'sector': sector, 'name': symbol, 'price': None, 'change': 0, 'marketCap': 0}


@router.get("/sectors/heatmap")
def get_sectors_heatmap():
    now = time.time()
    if now - _heatmap_cache['ts'] < _HEATMAP_TTL and _heatmap_cache['data']:
        return _heatmap_cache['data']

    tasks = [(sym, sec) for sec, syms in _HEATMAP_STOCKS.items() for sym in syms]
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
        stocks = list(ex.map(_fetch_heatmap_stock, tasks))

    # Group by sector preserving original order
    grouped = {}
    for sec in _HEATMAP_STOCKS:
        grouped[sec] = [s for s in stocks if s['sector'] == sec and s['marketCap'] > 0]

    result = [{'name': sec, 'stocks': grouped[sec]} for sec in _HEATMAP_STOCKS if grouped.get(sec)]
    _heatmap_cache.update({'ts': now, 'data': result})
    return result


_holdings_cache: dict = {}
_HOLDINGS_TTL = 60


def _fetch_holding_quote(symbol: str) -> dict:
    try:
        url = f"https://financialmodelingprep.com/stable/quote?symbol={symbol}&apikey={FMP_KEY}"
        for attempt in range(3):
            resp = _req.get(url, timeout=10)
            if resp.status_code == 429:
                time.sleep(1 + attempt)
                continue
            d = resp.json()
            break
        else:
            d = []
        q = d[0] if isinstance(d, list) and d else {}
        price      = q.get("price")
        chg_dollar = q.get("change") or 0
        chg_pct    = round(q.get("changePercentage") or 0, 2)
        prev       = round(price - chg_dollar, 2) if price is not None else None
        return {
            "symbol":       symbol,
            "name":         q.get("name", symbol),
            "price":        price,
            "prevClose":    prev,
            "change":       chg_pct,
            "changeDollar": round(chg_dollar, 2),
            "marketCap":    q.get("marketCap") or 0,
        }
    except Exception:
        return {"symbol": symbol, "name": symbol, "price": None, "prevClose": None,
                "change": 0, "changeDollar": 0, "marketCap": 0}


@router.get("/sectors/{etf}/holdings")
def get_sector_holdings(etf: str):
    etf = etf.upper()
    sector = _ETF_TO_SECTOR.get(etf)
    if not sector:
        return []
    now = time.time()
    cached = _holdings_cache.get(etf)
    if cached and now - cached["ts"] < _HOLDINGS_TTL:
        return cached["data"]

    syms = _HEATMAP_STOCKS.get(sector, [])
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
        stocks = list(ex.map(_fetch_holding_quote, syms))

    # Compute weight as % of sector total market cap
    total_mc = sum(s["marketCap"] for s in stocks if s["marketCap"])
    for s in stocks:
        s["weight"] = round(s["marketCap"] / total_mc * 100, 2) if total_mc else 0

    stocks = [s for s in stocks if s["price"] is not None]
    stocks.sort(key=lambda s: s["change"], reverse=True)

    result = {
        "etf":      etf,
        "name":     _ETF_NAMES.get(etf, etf),
        "holdings": len(stocks),
        "stocks":   stocks,
    }
    _holdings_cache[etf] = {"ts": now, "data": result}
    return result


# ─── Sector Heatmap ───────────────────────────────────────────────────────────
_SECTOR_ETFS = [
    ("XLK",  "Technology"),
    ("XLF",  "Financials"),
    ("XLV",  "Health Care"),
    ("XLY",  "Consumer Disc."),
    ("XLP",  "Consumer Staples"),
    ("XLI",  "Industrials"),
    ("XLE",  "Energy"),
    ("XLC",  "Comm. Services"),
    ("XLB",  "Materials"),
    ("XLRE", "Real Estate"),
    ("XLU",  "Utilities"),
]
_sector_cache: dict = {"ts": 0, "data": []}
_SECTOR_TTL = 60


_ETF_HOLDINGS = {etf: len(_HEATMAP_STOCKS[sec]) for etf, sec in {
    'XLK': 'Technology', 'XLF': 'Financials', 'XLV': 'Health Care',
    'XLY': 'Consumer Disc.', 'XLP': 'Cons. Staples', 'XLI': 'Industrials',
    'XLE': 'Energy', 'XLC': 'Comm. Services', 'XLB': 'Materials',
    'XLRE': 'Real Estate', 'XLU': 'Utilities',
}.items()}


def _fmt_date(ts) -> str:
    """Format a unix timestamp or date string to 'MMM DD YYYY'."""
    from datetime import datetime, timezone
    try:
        if isinstance(ts, (int, float)):
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(ts))
        return dt.strftime("%b %d %Y")
    except Exception:
        return ""


def _fetch_sector(sym: str, label: str) -> dict:
    try:
        # EOD historical: get last 2 official closes + exact dates
        eod_url   = f"https://financialmodelingprep.com/stable/historical-price-eod/full?symbol={sym}&limit=3&apikey={FMP_KEY}"
        quote_url = f"https://financialmodelingprep.com/stable/quote?symbol={sym}&apikey={FMP_KEY}"
        eod_resp   = _req.get(eod_url,   timeout=8).json()
        quote_resp = _req.get(quote_url, timeout=8).json()
        rows = eod_resp if isinstance(eod_resp, list) else []
        q    = quote_resp[0] if isinstance(quote_resp, list) and quote_resp else {}

        if len(rows) >= 3:
            # rows[0]=today, rows[1]=yesterday (last closed), rows[2]=day before
            last_price  = round(rows[1]["close"], 2)
            start_price = round(rows[2]["close"], 2)
            chg_dollar  = round(last_price - start_price, 2)
            chg_pct     = round((last_price - start_price) / start_price * 100, 2) if start_price else 0
            from datetime import datetime
            last_date   = datetime.strptime(rows[1]["date"], "%Y-%m-%d").strftime("%b %d %Y")
            start_date  = datetime.strptime(rows[2]["date"], "%Y-%m-%d").strftime("%b %d %Y")
        else:
            last_price  = q.get("previousClose")
            start_price = None
            chg_dollar  = round(q.get("change", 0), 2)
            chg_pct     = round(q.get("changePercentage", 0), 2)
            last_date   = start_date = ""

        return {
            "etf":          sym,
            "sector":       label,
            "price":        last_price,
            "prevClose":    start_price,
            "change":       chg_pct,
            "changeDollar": chg_dollar,
            "volume":       q.get("volume"),
            "high52":       q.get("yearHigh"),
            "low52":        q.get("yearLow"),
            "holdings":     _ETF_HOLDINGS.get(sym, 0),
            "lastDate":     last_date,
            "startDate":    start_date,
        }
    except Exception:
        return {"etf": sym, "sector": label, "price": None, "change": 0, "holdings": 0,
                "lastDate": "", "startDate": ""}


@router.get("/sectors")
def get_sectors():
    now = time.time()
    if now - _sector_cache["ts"] < _SECTOR_TTL and _sector_cache["data"]:
        return _sector_cache["data"]

    with concurrent.futures.ThreadPoolExecutor(max_workers=11) as ex:
        results = list(ex.map(lambda p: _fetch_sector(*p), _SECTOR_ETFS))

    _sector_cache.update({"ts": now, "data": results})
    return results


_PERIOD_DAYS = {
    "5d":  5,
    "1mo": 31,
    "3mo": 92,
    "6mo": 183,
    "ytd": None,   # special: Jan 1 of current year
    "1y":  365,
    "5y":  1826,
}

_hist_cache: dict = {}
_HIST_TTL = 300  # 5 min


def _prev_trading_day(dt):
    """Return dt if it's a weekday, else step back to the previous Friday."""
    from datetime import timedelta
    while dt.weekday() >= 5:
        dt -= timedelta(days=1)
    return dt


def _fetch_eod_range(sym: str, from_str: str, to_str: str) -> list:
    """Fetch EOD closes from FMP for a date range. Returns newest-first list."""
    url = (f"https://financialmodelingprep.com/stable/historical-price-eod/full"
           f"?symbol={sym}&from={from_str}&to={to_str}&apikey={FMP_KEY}")
    r = _req.get(url, timeout=10)
    return r.json() if isinstance(r.json(), list) else []


@router.get("/sectors/history")
def get_sectors_history(period: str = "5d"):
    from datetime import date, timedelta, datetime
    if period not in _PERIOD_DAYS:
        return []
    now = time.time()
    cached = _hist_cache.get(period)
    if cached and now - cached["ts"] < _HIST_TTL:
        return cached["data"]

    # Anchor end to last official close from sector cache
    live_data = _sector_cache.get("data") or []
    last_date_str = live_data[0]["lastDate"] if live_data else ""
    try:
        end_dt = datetime.strptime(last_date_str, "%b %d %Y").date()
    except Exception:
        end_dt = _prev_trading_day(date.today() - timedelta(days=1))

    if period == "ytd":
        start_dt = _prev_trading_day(date(end_dt.year, 1, 1))
    else:
        start_dt = _prev_trading_day(end_dt - timedelta(days=_PERIOD_DAYS[period]))

    from_str = start_dt.strftime("%Y-%m-%d")
    to_str   = end_dt.strftime("%Y-%m-%d")
    live     = {r["etf"]: r for r in live_data}

    def _fetch_sym(args):
        sym, label = args
        try:
            rows = _fetch_eod_range(sym, from_str, to_str)
            # FMP returns newest-first; last item = start of period
            end_row   = rows[0]
            start_row = rows[-1]
            end_price   = round(end_row["close"], 2)
            start_price = round(start_row["close"], 2)
            chg_dollar  = round(end_price - start_price, 2)
            chg_pct     = round((end_price - start_price) / start_price * 100, 2) if start_price else 0.0
            last_date_out  = datetime.strptime(end_row["date"],   "%Y-%m-%d").strftime("%b %d %Y")
            start_date_out = datetime.strptime(start_row["date"], "%Y-%m-%d").strftime("%b %d %Y")
            return {
                "etf":          sym,
                "sector":       label,
                "price":        end_price,
                "prevClose":    start_price,
                "change":       chg_pct,
                "changeDollar": chg_dollar,
                "volume":       live.get(sym, {}).get("volume"),
                "lastDate":     last_date_out,
                "startDate":    start_date_out,
            }
        except Exception:
            return {"etf": sym, "sector": label, "price": None, "change": 0,
                    "changeDollar": None, "lastDate": "", "startDate": ""}

    with concurrent.futures.ThreadPoolExecutor(max_workers=11) as ex:
        results = list(ex.map(_fetch_sym, _SECTOR_ETFS))

    _hist_cache[period] = {"ts": now, "data": results}
    return results


# ─── World Indices ────────────────────────────────────────────────────────────
_WORLD_INDICES_LIST = [
    # Americas
    {"symbol": "^GSPC",     "label": "US500",    "flag": "🇺🇸", "group": "Americas"},
    {"symbol": "^DJI",      "label": "US30",     "flag": "🇺🇸", "group": "Americas"},
    {"symbol": "^NDX",      "label": "US100",    "flag": "🇺🇸", "group": "Americas"},
    {"symbol": "^GSPTSE",   "label": "TSX",      "flag": "🇨🇦", "group": "Americas"},
    {"symbol": "^BVSP",     "label": "IBOVESPA", "flag": "🇧🇷", "group": "Americas"},
    {"symbol": "^MXX",      "label": "IPC",      "flag": "🇲🇽", "group": "Americas"},
    {"symbol": "^MERV",     "label": "MERVAL",   "flag": "🇦🇷", "group": "Americas"},
    # Europe
    {"symbol": "^FTSE",      "label": "GB100",   "flag": "🇬🇧", "group": "Europe"},
    {"symbol": "^GDAXI",     "label": "DE40",    "flag": "🇩🇪", "group": "Europe"},
    {"symbol": "^FCHI",      "label": "FR40",    "flag": "🇫🇷", "group": "Europe"},
    {"symbol": "^IBEX",      "label": "ES35",    "flag": "🇪🇸", "group": "Europe"},
    {"symbol": "FTSEMIB.MI", "label": "IT40",    "flag": "🇮🇹", "group": "Europe"},
    {"symbol": "^STOXX50E",  "label": "EU50",    "flag": "🇪🇺", "group": "Europe"},
    {"symbol": "^AEX",       "label": "NL25",    "flag": "🇳🇱", "group": "Europe"},
    {"symbol": "^SSMI",      "label": "CH20",    "flag": "🇨🇭", "group": "Europe"},
    {"symbol": "^OMX",       "label": "OMX",     "flag": "🇸🇪", "group": "Europe"},
    {"symbol": "^OMXC25",    "label": "OMXC25",  "flag": "🇩🇰", "group": "Europe"},
    {"symbol": "^ATX",       "label": "ATX",     "flag": "🇦🇹", "group": "Europe"},
    {"symbol": "^BFX",       "label": "BEL 20",  "flag": "🇧🇪", "group": "Europe"},
    {"symbol": "XU100.IS",   "label": "BIST 100","flag": "🇹🇷", "group": "Europe"},
    # Asia / Pacific
    {"symbol": "^N225",     "label": "JP225",    "flag": "🇯🇵", "group": "Asia"},
    {"symbol": "^HSI",      "label": "HK50",     "flag": "🇭🇰", "group": "Asia"},
    {"symbol": "000001.SS", "label": "SHANGHAI", "flag": "🇨🇳", "group": "Asia"},
    {"symbol": "^BSESN",    "label": "SENSEX",   "flag": "🇮🇳", "group": "Asia"},
    {"symbol": "^AXJO",     "label": "ASX200",   "flag": "🇦🇺", "group": "Asia"},
    {"symbol": "^NZ50",     "label": "NZX 50",   "flag": "🇳🇿", "group": "Asia"},
    {"symbol": "^KS11",     "label": "KOSPI",    "flag": "🇰🇷", "group": "Asia"},
    {"symbol": "^TWII",     "label": "TAIEX",    "flag": "🇹🇼", "group": "Asia"},
    {"symbol": "^STI",      "label": "STI",      "flag": "🇸🇬", "group": "Asia"},
    {"symbol": "^KLSE",     "label": "KLCI",     "flag": "🇲🇾", "group": "Asia"},
    {"symbol": "^JKSE",     "label": "IDX",      "flag": "🇮🇩", "group": "Asia"},
    {"symbol": "^SET.BK",   "label": "SET",      "flag": "🇹🇭", "group": "Asia"},
    # Middle East / Africa
    {"symbol": "^TA125.TA", "label": "TA-125",   "flag": "🇮🇱", "group": "Middle East"},
    {"symbol": "^TASI.SR",  "label": "TASI",     "flag": "🇸🇦", "group": "Middle East"},
]
_world_indices_cache: dict = {"ts": 0, "data": []}
_WORLD_IDX_TTL = 60


@router.get("/world-indices")
def get_world_indices():
    import yfinance as yf
    import pandas as pd

    now = time.time()
    if now - _world_indices_cache["ts"] < _WORLD_IDX_TTL and _world_indices_cache["data"]:
        return _world_indices_cache["data"]

    syms = [m["symbol"] for m in _WORLD_INDICES_LIST]
    try:
        data = yf.download(" ".join(syms), period="1y", auto_adjust=True,
                           progress=False, threads=True)
        closes = data["Close"]
    except Exception as e:
        return _world_indices_cache.get("data", [])

    today_year = pd.Timestamp.now().year

    results = []
    for meta in _WORLD_INDICES_LIST:
        sym = meta["symbol"]
        try:
            col = closes[sym].dropna() if sym in closes.columns else pd.Series(dtype=float)
            if col.empty:
                continue

            current  = float(col.iloc[-1])
            prev_cl  = float(col.iloc[-2]) if len(col) >= 2 else current
            day_chg  = round(current - prev_cl, 2)
            day_pct  = round(day_chg / prev_cl * 100, 2) if prev_cl else None

            def pct_n(n):
                if len(col) > n:
                    old = float(col.iloc[-(n + 1)])
                    return round((current - old) / old * 100, 2) if old else None
                return None

            ytd_col   = col[col.index.year == today_year]
            ytd_price = float(ytd_col.iloc[0]) if len(ytd_col) > 0 else None
            ytd       = round((current - ytd_price) / ytd_price * 100, 2) if ytd_price else None
            yoy       = round((current - float(col.iloc[0])) / float(col.iloc[0]) * 100, 2)

            last_dt  = col.index[-1]
            ld       = last_dt.date() if hasattr(last_dt, 'date') else last_dt
            today_dt = pd.Timestamp.now().date()
            date_str = "Today" if ld == today_dt else ld.strftime("%b/%-d")

            results.append({
                "label":     meta["label"],
                "flag":      meta["flag"],
                "group":     meta["group"],
                "price":     round(current, 2),
                "change":    day_chg,
                "changePct": day_pct,
                "weekly":    pct_n(5),
                "monthly":   pct_n(21),
                "ytd":       ytd,
                "yoy":       yoy,
                "high52":    round(float(col.max()), 2),
                "low52":     round(float(col.min()), 2),
                "date":      date_str,
            })
        except Exception:
            continue

    if results:
        _world_indices_cache.update({"ts": now, "data": results})
    return results


# ─── Stripe / Billing ─────────────────────────────────────────────────────────

import json as _json

STRIPE_SECRET_KEY      = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET  = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
PRICE_MONTHLY          = os.environ.get("STRIPE_PRICE_MONTHLY", "")
PRICE_ANNUAL           = os.environ.get("STRIPE_PRICE_ANNUAL", "")
APP_URL                = os.environ.get("APP_URL", "http://localhost:5181")

PAYPAL_CLIENT_ID       = os.environ.get("PAYPAL_CLIENT_ID", "")
PAYPAL_CLIENT_SECRET   = os.environ.get("PAYPAL_CLIENT_SECRET", "")
PAYPAL_PLAN_MONTHLY    = os.environ.get("PAYPAL_PLAN_MONTHLY", "")
PAYPAL_PLAN_ANNUAL     = os.environ.get("PAYPAL_PLAN_ANNUAL", "")
PAYPAL_API_BASE        = "https://api-m.paypal.com"

# Firebase Admin SDK (needed only for webhook to write Firestore server-side)
_firebase_admin_ready = False
try:
    import firebase_admin
    from firebase_admin import credentials as _fb_creds, firestore as _fb_fs

    _sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    if _sa_json and not firebase_admin._apps:
        _sa_dict = _json.loads(_sa_json)
        # Fix escaped newlines in private key if stored as literal \n
        if "private_key" in _sa_dict:
            _sa_dict["private_key"] = _sa_dict["private_key"].replace("\\n", "\n")
        firebase_admin.initialize_app(_fb_creds.Certificate(_sa_dict))
        _firebase_admin_ready = True
except Exception as _e:
    print(f"[stripe] Firebase Admin not configured: {_e}")

def _fs_client():
    if not _firebase_admin_ready:
        return None
    return _fb_fs.client()

def _update_user_subscription(customer_id: str, status: str, plan_id: Optional[str] = None):
    """Write subscription status to Firestore users/{uid} by stripeCustomerId lookup."""
    fs = _fs_client()
    if not fs:
        return
    try:
        users = fs.collection("users").where("stripeCustomerId", "==", customer_id).limit(1).stream()
        for user_doc in users:
            user_doc.reference.update({
                "subscriptionStatus": status,
                **({"planId": plan_id} if plan_id is not None else {}),
            })
    except Exception as e:
        print(f"[stripe] Firestore update failed: {e}")


from fastapi import Request, Header
from fastapi.responses import JSONResponse

@router.post("/billing/create-checkout-session")
async def create_checkout_session(request: Request):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY

    body = await request.json()
    uid        = body.get("uid")
    email      = body.get("email")
    price_id   = body.get("priceId")
    customer_id = body.get("customerId")   # pass if we already created one

    if not uid or not price_id:
        raise HTTPException(400, "uid and priceId required")

    try:
        # Reuse or create Stripe customer so we can look them up later
        if not customer_id:
            customer = stripe.Customer.create(email=email, metadata={"firebaseUid": uid})
            customer_id = customer.id

        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            mode="subscription",
            success_url=f"{APP_URL}/#billing-success",
            cancel_url=f"{APP_URL}/#billing-cancel",
            subscription_data={"metadata": {"firebaseUid": uid}},
            metadata={"firebaseUid": uid},
        )
        return {"url": session.url, "customerId": customer_id}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/billing/customer-portal")
async def customer_portal(request: Request):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY

    body = await request.json()
    customer_id = body.get("customerId")
    if not customer_id:
        raise HTTPException(400, "customerId required")
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{APP_URL}/",
        )
        return {"url": session.url}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/billing/webhook")
async def stripe_webhook(request: Request, stripe_signature: str = Header(None)):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY

    payload = await request.body()
    try:
        stripe.Webhook.construct_event(payload, stripe_signature, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        raise HTTPException(400, str(e))

    import json as _json
    event_dict = _json.loads(payload)
    etype = event_dict["type"]
    data  = event_dict["data"]["object"]

    if etype == "checkout.session.completed":
        metadata    = data.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = dict(metadata)
        uid         = metadata.get("firebaseUid")
        customer_id = data.get("customer")
        fs = _fs_client()
        if fs and uid:
            fs.collection("users").document(uid).set(
                {"stripeCustomerId": customer_id, "subscriptionStatus": "active"},
                merge=True,
            )

    elif etype in ("customer.subscription.updated", "customer.subscription.created"):
        customer_id = data.get("customer")
        status      = data.get("status")
        try:
            items_obj = data.get("items") or {}
            items_data = dict(items_obj) if not isinstance(items_obj, dict) else items_obj
            first_item = (items_data.get("data") or [{}])[0]
            first_item = dict(first_item) if not isinstance(first_item, dict) else first_item
            price_obj = first_item.get("price") or {}
            price_obj = dict(price_obj) if not isinstance(price_obj, dict) else price_obj
            plan_id = price_obj.get("id")
        except Exception:
            plan_id = None
        mapped = "active" if status in ("active", "trialing") else "past_due" if status == "past_due" else "cancelled"
        _update_user_subscription(customer_id, mapped, plan_id)

    elif etype == "customer.subscription.deleted":
        customer_id = data.get("customer")
        _update_user_subscription(customer_id, "cancelled")

    return JSONResponse({"received": True})


# ── PayPal helpers ────────────────────────────────────────────────────────────

def _paypal_token() -> str:
    import base64
    creds = base64.b64encode(f"{PAYPAL_CLIENT_ID}:{PAYPAL_CLIENT_SECRET}".encode()).decode()
    r = requests.post(
        f"{PAYPAL_API_BASE}/v1/oauth2/token",
        headers={"Authorization": f"Basic {creds}", "Content-Type": "application/x-www-form-urlencoded"},
        data="grant_type=client_credentials",
    )
    r.raise_for_status()
    return r.json()["access_token"]


# ── PayPal endpoints ──────────────────────────────────────────────────────────

class PayPalSubscriptionBody(BaseModel):
    uid:    str
    email:  Optional[str] = None
    planId: str           # "monthly" or "annual"

@router.post("/billing/paypal/create-subscription")
async def paypal_create_subscription(body: PayPalSubscriptionBody):
    if not PAYPAL_CLIENT_ID:
        raise HTTPException(503, "PayPal not configured")
    plan_id = PAYPAL_PLAN_MONTHLY if body.planId == "monthly" else PAYPAL_PLAN_ANNUAL
    if not plan_id:
        raise HTTPException(503, "PayPal plan not configured")
    try:
        token = _paypal_token()
        r = requests.post(
            f"{PAYPAL_API_BASE}/v1/billing/subscriptions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "plan_id": plan_id,
                "custom_id": body.uid,
                "subscriber": {"email_address": body.email} if body.email else {},
                "application_context": {
                    "return_url": f"{APP_URL}/#billing-success",
                    "cancel_url": f"{APP_URL}/#billing-cancel",
                    "shipping_preference": "NO_SHIPPING",
                    "user_action": "SUBSCRIBE_NOW",
                },
            },
        )
        r.raise_for_status()
        return {"subscriptionId": r.json()["id"]}
    except Exception as e:
        raise HTTPException(500, str(e))


class PayPalActivateBody(BaseModel):
    subscriptionId: str
    uid:            str

@router.post("/billing/paypal/activate")
async def paypal_activate(body: PayPalActivateBody):
    """Called from frontend onApprove for immediate Pro unlock."""
    if not PAYPAL_CLIENT_ID:
        raise HTTPException(503, "PayPal not configured")
    try:
        token = _paypal_token()
        r = requests.get(
            f"{PAYPAL_API_BASE}/v1/billing/subscriptions/{body.subscriptionId}",
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        status = r.json().get("status", "")
        if status in ("ACTIVE", "APPROVED"):
            fs = _fs_client()
            if fs and body.uid:
                fs.collection("users").document(body.uid).set(
                    {"subscriptionStatus": "active", "paypalSubscriptionId": body.subscriptionId},
                    merge=True,
                )
        return {"status": status}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/billing/paypal/webhook")
async def paypal_webhook(request: Request):
    import json as _json
    body = await request.body()
    try:
        event = _json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    event_type = event.get("event_type", "")
    resource   = event.get("resource", {})
    uid        = resource.get("custom_id") or resource.get("subscriber", {}).get("payer_id")

    fs = _fs_client()
    if fs and uid:
        if event_type in ("BILLING.SUBSCRIPTION.ACTIVATED", "BILLING.SUBSCRIPTION.RENEWED"):
            fs.collection("users").document(uid).set(
                {"subscriptionStatus": "active", "paypalSubscriptionId": resource.get("id")},
                merge=True,
            )
        elif event_type in ("BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.EXPIRED",
                            "BILLING.SUBSCRIPTION.SUSPENDED"):
            fs.collection("users").document(uid).set(
                {"subscriptionStatus": "cancelled"},
                merge=True,
            )

    return JSONResponse({"received": True})


# Register all routes under /api
app.include_router(router)

# Vercel serverless entry point (mangum not needed locally)
try:
    from mangum import Mangum
    handler = Mangum(app, lifespan="off")
except ImportError:
    pass
