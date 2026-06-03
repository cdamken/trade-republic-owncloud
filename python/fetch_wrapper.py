#!/usr/bin/env python3
"""Per-user Trade Republic fetch wrapper, invoked by OCA\\TradeRepublic\\Service\\TrService.

Diffs vs. Trade-Republic-Dashboard/app/tr_fetch.py:

  * Profile dir is supplied via --profile-dir (per ownCloud user) instead of
    the global ``~/.tr-api/``. We do this by re-pointing HOME to that dir, so
    tr-api's ``~/.tr-api/profiles/<phone>/`` lands inside it.
  * Output dir is supplied via --data-dir (per-user data dir under ownCloud's
    datadirectory).
  * Credentials come from env (TR_PHONE / TR_PIN) injected by the PHP layer
    after decrypting the per-user prefs — there's no ~/.pytr/credentials file.
  * Analytics is computed inline (no subprocess) so this script is the single
    point of entry from PHP.

Exit codes (kept identical to TR-Dashboard's so the PHP layer's mapping is
the same as in server.py):

  0   success
  10  session expired AND no --mfa-code provided     → browser shows MFA modal
  11  --mfa-code rejected by TR (or PIN_INVALID)
  12  Bad credentials in env (TR_PHONE / TR_PIN)
  20  Network / TR API error (transient)
  21  Rate-limited by Trade Republic
  30  Local processing / configuration error
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import traceback
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timedelta, timezone, date as _date_t
from pathlib import Path
from typing import Any

# EventType / EventSubType: raw TR strings captured for debugging.
# Mirrors gbm-dashboard tr_fetch.py — see comment there.
CSV_COLUMNS = ["Date", "Type", "Value", "Note", "ISIN", "Shares",
               "Fees", "Taxes", "ISIN2", "Shares2",
               "EventType", "EventSubType"]


# ============================================================================
# Portfolio analytics helpers (XIRR, forward dividends, yield on cost,
# top contributors, benchmark fetch). Mirror of Dashboard's analyze_analytics.
# Added 2026-06-01.
# ============================================================================

def _xirr_npv(rate, days, amounts):
    return sum(a / (1 + rate) ** (d / 365.0) for a, d in zip(amounts, days))


def xirr(cash_flows, tol=1e-7):
    """Annualized money-weighted return (Newton + bisection fallback). %."""
    if not cash_flows or len(cash_flows) < 2:
        return None
    cash_flows = sorted(cash_flows, key=lambda x: x[0])
    t0 = cash_flows[0][0]
    days = [(d - t0).days for d, _ in cash_flows]
    amounts = [float(a) for _, a in cash_flows]
    if all(a >= 0 for a in amounts) or all(a <= 0 for a in amounts):
        return None
    for guess in (0.10, 0.0, -0.10, 0.30, -0.30, 0.50):
        rate = guess
        for _ in range(80):
            try:
                npv  = _xirr_npv(rate, days, amounts)
                dnpv = sum(-d / 365.0 * a / (1 + rate) ** (d / 365.0 + 1)
                           for a, d in zip(amounts, days))
            except (OverflowError, ZeroDivisionError):
                break
            if abs(dnpv) < 1e-12:
                break
            new_rate = rate - npv / dnpv
            if new_rate <= -0.999:
                new_rate = -0.99
            if abs(new_rate - rate) < tol:
                return round(new_rate * 100, 2)
            rate = new_rate
    lo, hi = -0.95, 10.0
    try:
        f_lo = _xirr_npv(lo, days, amounts)
        f_hi = _xirr_npv(hi, days, amounts)
    except (OverflowError, ZeroDivisionError):
        return None
    if f_lo * f_hi > 0:
        return None
    for _ in range(120):
        mid = (lo + hi) / 2
        try:
            f_mid = _xirr_npv(mid, days, amounts)
        except (OverflowError, ZeroDivisionError):
            return None
        if abs(f_mid) < tol or abs(hi - lo) < tol:
            return round(mid * 100, 2)
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return round(((lo + hi) / 2) * 100, 2)


def forward_dividend_income(div_payments, today):
    """Scale last-N-days Dividend rows up to a full year. Returns (eur, days, n)."""
    if not div_payments or not today:
        return None, 0, 0
    cutoff = (today - timedelta(days=365)).isoformat()
    relevant = [p for p in div_payments
                if p.get('date', '') >= cutoff and p.get('type') == 'Dividend']
    if not relevant:
        return None, 0, 0
    dates = sorted(p['date'] for p in relevant)
    try:
        d_first = datetime.fromisoformat(dates[0]).date()
        d_last  = datetime.fromisoformat(dates[-1]).date()
    except ValueError:
        return None, 0, 0
    span_days = max(1, (d_last - d_first).days)
    if span_days < 90:
        return None, span_days, len(relevant)
    total = sum(float(p.get('amount', 0) or 0) for p in relevant)
    scaled = total * (365.0 / span_days) if span_days < 365 else total
    return round(scaled, 2), span_days, len(relevant)


def fetch_benchmark_monthly(symbol, start_date, end_date, cache_path=None):
    """Yahoo Finance monthly closes. Cached 24h. Returns [] on any failure."""
    if cache_path and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text())
            fetched_at = datetime.fromisoformat(cached.get('fetched_at', '1970-01-01T00:00:00'))
            if (datetime.now() - fetched_at).total_seconds() < 86400:
                if cached.get('symbol') == symbol and cached.get('history'):
                    return cached['history']
        except (json.JSONDecodeError, ValueError, KeyError):
            pass
    try:
        p1 = int(datetime.combine(start_date, datetime.min.time()).timestamp())
        p2 = int(datetime.combine(end_date,   datetime.min.time()).timestamp())
        url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
               f"?period1={p1}&period2={p2}&interval=1mo&events=history")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            payload = json.loads(r.read())
        result = payload.get('chart', {}).get('result', [{}])[0]
        ts = result.get('timestamp', []) or []
        closes = result.get('indicators', {}).get('quote', [{}])[0].get('close', []) or []
        history = []
        for t, c in zip(ts, closes):
            if c is None:
                continue
            d = datetime.utcfromtimestamp(t).date().isoformat()
            history.append({"date": d, "close": round(float(c), 4)})
        if cache_path and history:
            cache_path.write_text(json.dumps({
                "symbol":     symbol,
                "fetched_at": datetime.now().isoformat(timespec='seconds'),
                "history":    history,
            }, indent=2))
        return history
    except (urllib.error.URLError, urllib.error.HTTPError,
            ValueError, KeyError, TimeoutError) as e:
        sys.stderr.write(f"[benchmark] {symbol} fetch failed: {e}\n")
        return []


def replay_against_benchmark(monthly_flows, bench_history):
    """Simulate buying the benchmark with the user's net monthly cash flows."""
    if not monthly_flows or not bench_history:
        return []
    bench_by_month = {h['date'][:7]: h['close'] for h in bench_history}
    units = 0.0
    out = []
    for f in monthly_flows:
        m = f['month']
        close = bench_by_month.get(m)
        if close is None or close <= 0:
            if out:
                out.append({"date": m + "-01", "value": out[-1]['value']})
            continue
        net = float(f.get('net_flow', 0) or 0)
        if net != 0:
            units += net / close
        out.append({"date": m + "-01", "value": round(units * close, 2)})
    if bench_history and units > 0:
        last = bench_history[-1]
        out.append({"date": last['date'], "value": round(units * last['close'], 2)})
    return out

# TR's eventType → dashboard CSV "Type" column.
# Kept in sync with Trade-Republic-Dashboard/app/tr_fetch.py — see commit
# 4997e85 there for the full rationale and the 2026-05-28 live distribution.
# Short version: TR renamed almost every eventType during 2026. Without
# the new names the CSV drops ~95% of returned events. Old names kept
# under "# legacy" so pytr-era CSV rows don't downgrade on re-processing.
EVENT_TYPE_MAP: dict[str, str] = {
    # Cash in
    "BANK_TRANSACTION_INCOMING":           "Deposit",
    "CARD_REFUND":                         "Deposit",
    # legacy
    "INCOMING_TRANSFER":                   "Deposit",
    "INCOMING_TRANSFER_DELEGATION":        "Deposit",
    "PAYMENT_INBOUND":                     "Deposit",
    "PAYMENT_INBOUND_SEPA_DIRECT_DEBIT":   "Deposit",
    "card_refund":                         "Deposit",

    # Cash out: card spending (consumption). Mirrors upstream — see
    # Trade-Republic-Dashboard@b831205 for the split rationale.
    "CARD_TRANSACTION":                    "Removal",
    "CRYPTO_TRANSFER_NETWORK_FEE":         "Removal",
    # legacy
    "card_successful_transaction":         "Removal",

    # Cash out: withdrawals from TR back to a non-TR bank account.
    # Still the user's money — tracked separately so analytics shows
    # "money committed to TR" net of withdrawals without conflating it
    # with day-to-day card consumption.
    "BANK_TRANSACTION_OUTGOING":           "Withdrawal",
    "BANK_TRANSACTION_OUTGOING_DIRECT_DEBIT": "Withdrawal",
    "BANK_TRANSACTION_OUTGOING_SCHEDULED": "Withdrawal",
    # legacy
    "OUTGOING_TRANSFER":                   "Withdrawal",
    "OUTGOING_TRANSFER_DELEGATION":        "Withdrawal",
    "PAYMENT_OUTBOUND":                    "Withdrawal",

    # Tax flows
    "SSP_TAX_CORRECTION":                  "Tax Refund",
    # legacy
    "ssp_tax_correction_invoice":          "Tax Refund",
    "TAX_REFUND":                          "Tax Refund",

    # Trading — SAVINGSPLAN / SPARE_CHANGE / SAVEBACK are always buys,
    # so straight-map to Buy. Manual trades go through _classify_trade
    # (amount-sign based).
    "TRADING_SAVINGSPLAN_EXECUTED":        "Buy",
    "SPARE_CHANGE_AGGREGATE":              "Buy",
    "SAVEBACK_AGGREGATE":                  "Buy",
    "TRADING_TRADE_EXECUTED":              "Trade",
    "PRIVATE_MARKET_FUND_TRADE_EXECUTED":  "Trade",
    # legacy
    "TRADE_INVOICE":                       "Trade",
    "ORDER_EXECUTED":                      "Trade",

    # Income
    "SSP_CORPORATE_ACTION_CASH":           "Dividend",
    "INTEREST_PAYOUT":                     "Interest",
    "INTEREST_PAYOUT_CREATED":             "Interest",
    # legacy
    "CREDIT":                              "Dividend",
    "DIVIDEND":                            "Dividend",
    "ssp_corporate_action_invoice_cash":   "Dividend",
}

PENDING_LOGIN_TTL_SECONDS = 5 * 60


# ---------------------------------------------------------------------------
# tr-api imports (deferred so a missing install gives a clean exit 30)
# ---------------------------------------------------------------------------
def _import_tr_api():
    try:
        from tr_api import (
            Profile,
            TrClient,
            account,
            auth,
            portfolio as tr_portfolio,
            profiles,
            transactions as tr_transactions,
        )
        from tr_api.exceptions import (
            ApiError,
            MissingSessionCookies,
            ProfileNotFound,
            SessionExpired,
            TrApiError,
        )
        from tr_api.auth import InvalidCredentials, LoginError, RateLimited
        from tr_api import cookies as tr_cookies
    except ImportError as e:
        sys.stderr.write(
            f"ERROR: tr-api is not installed in this Python ({sys.executable}).\n"
            f"  {e}\n"
            f"Install it in the venv pointed at by trade_republic.python_bin:\n"
            f"  pip install tr-api[browser]\n"
        )
        sys.exit(30)
    return {
        "Profile": Profile, "TrClient": TrClient,
        "account": account, "auth": auth,
        "portfolio": tr_portfolio, "profiles": profiles,
        "transactions": tr_transactions,
        "ApiError": ApiError, "MissingSessionCookies": MissingSessionCookies,
        "ProfileNotFound": ProfileNotFound, "SessionExpired": SessionExpired,
        "TrApiError": TrApiError,
        "InvalidCredentials": InvalidCredentials, "LoginError": LoginError,
        "RateLimited": RateLimited,
        "cookies": tr_cookies,
    }


# ---------------------------------------------------------------------------
# Two-step login state (persisted between /update requests for the same user)
# ---------------------------------------------------------------------------
def _save_pending(data_dir: Path, phone: str, process_id: str) -> None:
    payload = {"phone": phone, "process_id": process_id, "issued_at": int(time.time())}
    path = data_dir / ".pending_login.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _load_pending(data_dir: Path, phone: str) -> str | None:
    path = data_dir / ".pending_login.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if data.get("phone") != phone:
        return None
    issued = int(data.get("issued_at") or 0)
    if int(time.time()) - issued > PENDING_LOGIN_TTL_SECONDS:
        return None
    pid = data.get("process_id")
    return pid if isinstance(pid, str) and pid else None


def _clear_pending(data_dir: Path) -> None:
    try:
        (data_dir / ".pending_login.json").unlink(missing_ok=True)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Authenticated client
# ---------------------------------------------------------------------------
def get_authenticated_client(tr, phone: str, pin: str, data_dir: Path, mfa_code: str | None):
    """Return an authenticated TrClient, or exit 10/11/20/21 along the way.

    Routes:
      - mfa_code provided  → complete the pending login (step 2).
      - no mfa_code, cookies still valid → use them as-is.
      - no mfa_code, cookies stale       → initiate (push) and exit 10 (step 1).
    """
    profiles = tr["profiles"]
    TrClient = tr["TrClient"]

    try:
        prof = profiles.load(phone)
    except tr["ProfileNotFound"]:
        prof = profiles.create(phone, jurisdiction="DE", name="ownCloud")
    profiles.set_active(phone)

    if mfa_code is not None:
        return _complete_pending_or_die(tr, phone, pin, data_dir, mfa_code, prof)

    # Try existing cookies — if a recent login is still good, we're done.
    try:
        client = TrClient(prof)
        try:
            alive = tr["account"].ping(client)
        except tr["TrApiError"] as e:
            sys.stderr.write(f"Network/API error during session ping: {e}\n")
            sys.exit(20)
        if alive:
            return client
    except tr["MissingSessionCookies"]:
        pass  # fall through to "trigger push"

    # If a push has *already* been sent within the last few minutes, don't
    # re-send (the previous code is still valid for the in-flight modal).
    if _load_pending(data_dir, phone) is not None:
        sys.stderr.write(
            "A 4-digit code was already pushed to your phone within the last "
            "5 minutes. Enter it in the dashboard modal.\n"
        )
        sys.exit(10)

    # Fresh login required — trigger a push and surface mfa_required.
    _trigger_push_and_exit(tr, phone, pin, data_dir)
    return None  # unreachable; satisfies the type checker


def _trigger_push_and_exit(tr, phone: str, pin: str, data_dir: Path) -> None:
    auth = tr["auth"]
    try:
        init = auth.initiate_login(phone, pin)
    except tr["RateLimited"] as e:
        sys.stderr.write(
            f"Rate-limited by Trade Republic. "
            f"Retry at {getattr(e, 'next_attempt_at', '?')} "
            f"(~{(getattr(e, 'wait_seconds', 0) or 0) // 60} min).\n"
        )
        sys.exit(21)
    except tr["InvalidCredentials"] as e:
        sys.stderr.write(f"Bad credentials: {e}\n")
        sys.exit(11)
    except tr["LoginError"] as e:
        sys.stderr.write(f"Could not initiate login: {e}\n")
        sys.exit(20)

    _save_pending(data_dir, phone, init.process_id)
    sys.stderr.write(
        f"Push sent to your Trade Republic mobile app. "
        f"Enter the 4-digit code in the dashboard modal.\n"
        f"  processId: {init.process_id[:8]}...  expires in ~60s.\n"
    )
    sys.exit(10)


def _complete_pending_or_die(tr, phone: str, pin: str, data_dir: Path, mfa_code: str, prof):
    process_id = _load_pending(data_dir, phone)
    if not process_id:
        sys.stderr.write(
            "No pending login for this phone (or it expired). "
            "Submit the form without a code first to trigger a new push.\n"
        )
        sys.exit(10)

    auth = tr["auth"]
    try:
        result = auth.complete_login(process_id, mfa_code)
    except tr["InvalidCredentials"] as e:
        sys.stderr.write(f"Wrong code: {e}\n")
        sys.exit(11)
    except tr["RateLimited"] as e:
        sys.stderr.write(f"Rate-limited: {e}\n")
        sys.exit(21)
    except tr["LoginError"] as e:
        sys.stderr.write(f"Login failed: {e}\n")
        sys.exit(20)

    tr["cookies"].save_to_file(result.cookies, prof.cookies_file)
    _clear_pending(data_dir)
    return tr["TrClient"](prof)


# ---------------------------------------------------------------------------
# Portfolio: tr-api snapshot → dashboard portfolio.json schema
# ---------------------------------------------------------------------------
def fetch_portfolio(tr, client, data_dir: Path) -> dict[str, Any]:
    try:
        snap = tr["portfolio"].snapshot_full(client)
        # Also pull the by-category view so we can tag each position with
        # the TR bucket it belongs to (stocksAndETFs / cryptos / bonds /
        # privateMarkets / others). This is what TR's mobile "Wealth"
        # screen uses to break down the depot into separate tiles.
        from tr_api import accounts as tr_accounts
        pairs = tr_accounts.account_pairs(client)
        default_pair = pairs.default_pair()
        cat_snap: dict[str, Any] = {}
        if default_pair is not None:
            cat_snap = tr["portfolio"].compact_portfolio_by_type(
                client, sec_acc_no=default_pair.securities_account_number
            )
    except tr["SessionExpired"]:
        sys.stderr.write("Session expired during portfolio fetch.\n")
        sys.exit(10)
    except tr["RateLimited"] as e:
        sys.stderr.write(f"Rate-limited: {e}\n")
        sys.exit(21)
    except tr["TrApiError"] as e:
        sys.stderr.write(f"Portfolio fetch failed: {e}\n")
        sys.exit(20)

    # Save raw for debugging the field-name mapping on first runs.
    try:
        (data_dir / "portfolio_raw.json").write_text(
            json.dumps(snap, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
    except Exception:
        pass

    # Build {isin -> TR category} from the by-type snapshot.
    isin_to_category: dict[str, str] = {}
    for cat in (cat_snap.get("categories") or []):
        cat_type = str(cat.get("categoryType") or "others")
        for pos in (cat.get("positions") or []):
            isin = str(pos.get("isin") or "")
            if isin:
                isin_to_category[isin] = cat_type

    shaped = _shape_portfolio(snap, isin_to_category)
    _append_net_worth_history(data_dir, shaped["summary"])
    return shaped


def _shape_portfolio(
    snap: dict[str, Any],
    isin_to_category: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Map tr-api's raw TR JSON into the schema the dashboard frontend expects."""
    p = (snap.get("portfolio") or {}) if isinstance(snap, dict) else {}
    cash_data = snap.get("cash") if isinstance(snap, dict) else None

    positions: list[dict[str, Any]] = []
    zero_positions: list[dict[str, Any]] = []

    for raw in (p.get("positions") or []):
        qty = _as_float(raw.get("netSize") or raw.get("virtualSize") or raw.get("quantity"))
        avg_cost = _as_float(raw.get("averageBuyIn") or raw.get("avgPrice"))

        cp = raw.get("currentPrice")
        if isinstance(cp, dict):
            current_price = _as_float(cp.get("value") or cp.get("price"))
        else:
            current_price = _as_float(cp)

        net_value = _as_float(raw.get("netValue") or raw.get("currentValue"))
        if net_value <= 0 and current_price > 0 and qty > 0:
            net_value = current_price * qty
        if current_price <= 0 and qty > 0 and net_value > 0:
            current_price = net_value / qty

        instrument_id = str(raw.get("instrumentId") or raw.get("isin") or "")
        isin = str(raw.get("isin") or instrument_id.split(".", 1)[0])
        name = (raw.get("name") or raw.get("instrumentName") or "").strip() or isin

        buy_cost = avg_cost * qty
        pl_eur = net_value - buy_cost if net_value > 0 else 0.0
        pl_pct = (pl_eur / buy_cost * 100.0) if (buy_cost and net_value > 0) else 0.0

        item = {
            "name": name[:25],
            "isin": isin,
            "category": (isin_to_category or {}).get(isin, "others"),
            "avg_cost": round(avg_cost, 4),
            "quantity": round(qty, 6),
            "buy_cost_eur": round(buy_cost, 2),
            "net_value_eur": round(net_value, 2),
            "current_price": round(current_price, 4),
            "pl_eur": round(pl_eur, 2),
            "pl_pct": round(pl_pct, 2),
        }
        if net_value > 0:
            positions.append(item)
        else:
            zero_positions.append({"name": name, "isin": isin})

    positions.sort(key=lambda x: x["net_value_eur"], reverse=True)
    winners = sorted((x for x in positions if x["pl_pct"] >= 50.0), key=lambda x: -x["pl_pct"])
    losers = sorted((x for x in positions if x["pl_pct"] <= -25.0), key=lambda x: x["pl_pct"])

    cash_eur = _extract_eur_cash(cash_data)

    depot_buycost = sum(x["buy_cost_eur"] for x in positions)
    depot_netvalue = sum(x["net_value_eur"] for x in positions)
    depot_pl_eur = round(depot_netvalue - depot_buycost, 2)
    depot_pl_pct = round((depot_pl_eur / depot_buycost * 100.0) if depot_buycost else 0.0, 2)

    # Per-bucket totals — mirrors what TR's mobile "Wealth" screen shows
    # as separate tiles (Brokerage / Bonds / Private Equity / etc.). The
    # category labels come straight from compactPortfolioByType.
    by_category: dict[str, dict[str, Any]] = {}
    for pos in positions:
        cat = pos.get("category") or "others"
        bucket = by_category.setdefault(cat, {
            "count": 0,
            "buy_cost_eur": 0.0,
            "net_value_eur": 0.0,
        })
        bucket["count"] += 1
        bucket["buy_cost_eur"] += pos["buy_cost_eur"]
        bucket["net_value_eur"] += pos["net_value_eur"]
    for cat, b in by_category.items():
        b["buy_cost_eur"] = round(b["buy_cost_eur"], 2)
        b["net_value_eur"] = round(b["net_value_eur"], 2)
        b["pl_eur"] = round(b["net_value_eur"] - b["buy_cost_eur"], 2)
        b["pl_pct"] = round(
            (b["pl_eur"] / b["buy_cost_eur"] * 100.0) if b["buy_cost_eur"] else 0.0, 2
        )

    return {
        "summary": {
            "depot_buycost": round(depot_buycost, 2),
            "depot_netvalue": round(depot_netvalue, 2),
            "depot_pl_eur": depot_pl_eur,
            "depot_pl_pct": depot_pl_pct,
            "cash_eur": round(cash_eur, 2),
            "total_buycost": round(depot_buycost, 2),
            "total_netvalue": round(depot_netvalue + cash_eur, 2),
            "by_category": by_category,
        },
        "total_positions": len(positions) + len(zero_positions),
        "positions_with_value": len(positions),
        "zero_value_positions": zero_positions,
        "top_25": positions[:25],
        "winners_50plus": winners,
        "losers_25minus": losers,
        "all_positions": positions,
    }


def _as_float(x: Any) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def _extract_eur_cash(cash_data: Any) -> float:
    if not cash_data:
        return 0.0
    if isinstance(cash_data, dict):
        return _as_float(cash_data.get("amount"))
    if isinstance(cash_data, list):
        for entry in cash_data:
            if not isinstance(entry, dict):
                continue
            if entry.get("currencyId") in ("EUR", "EUR_CASH", None):
                return _as_float(entry.get("amount"))
        first = cash_data[0] if cash_data else None
        if isinstance(first, dict):
            return _as_float(first.get("amount"))
    return 0.0


def _append_net_worth_history(data_dir: Path, summary: dict[str, Any]) -> None:
    history_file = data_dir / "net_worth_history.json"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows: list[dict[str, Any]] = []
    if history_file.exists():
        try:
            rows = json.loads(history_file.read_text(encoding="utf-8")) or []
        except Exception:
            rows = []
    rows = [r for r in rows if r.get("date") != today]
    rows.append({
        "date": today,
        "value": summary["total_netvalue"],
        "net_value": summary["total_netvalue"],
        "depot": summary["depot_netvalue"],
        "cash": summary["cash_eur"],
        "pl_eur": summary["depot_pl_eur"],
    })
    rows.sort(key=lambda r: r["date"])
    rows = rows[-180:]  # match TR-Dashboard's truncation (analyze_analytics.py)
    history_file.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Transactions: timeline → CSV in the schema analyze_analytics expects
# ---------------------------------------------------------------------------
async def _paginate_topic_on_ws(ws, topic: str, *, cutoff=None, max_pages: int = 2000):
    """Paginate a single TR timeline topic on an EXISTING WS connection.

    max_pages is a safety cap against infinite loops — natural
    termination is `cursor is None`. 200 (the old value) was too low:
    TR returns ~30 items/page, so 200 pages capped fetch at ~6000
    events (about 9 months on an active account). 2000 handles
    ~60,000 events, enough for 5+ years on any normal account.

    Mirrors Trade-Republic-Dashboard/app/tr_fetch.py::_paginate_topic_on_ws.
    Done locally (not via tr_api's per-topic fetch_all) so we can share
    one WS across both timelineTransactions and timelineActivityLog —
    which is what pytr does and what makes activityLog actually return
    items for this account.
    """
    items: list = []
    cursor = None
    for _ in range(max_pages):
        payload = {"type": topic}
        if cursor is not None:
            payload["after"] = cursor
        page = await ws.fetch_one(payload)
        page_items = page.get("items") or []
        if cutoff is not None:
            for it in page_items:
                ts_raw = it.get("timestamp") or it.get("eventTime") or ""
                if isinstance(ts_raw, str) and ts_raw.endswith("Z"):
                    ts_raw = ts_raw[:-1] + "+00:00"
                try:
                    ts = datetime.fromisoformat(ts_raw)
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if ts < cutoff:
                        return items
                except (ValueError, TypeError):
                    pass
                items.append(it)
        else:
            items.extend(page_items)
        cursor = (page.get("cursors") or {}).get("after")
        if cursor is None:
            return items
    return items


def fetch_transactions(tr, client, data_dir: Path, force_full: bool) -> None:
    """Fetch BOTH timelineTransactions and timelineActivityLog on a SINGLE
    WebSocket connection (the pytr pattern).

    Two separate fetch_all calls (one per topic) cause the second WS to
    see an empty timelineActivityLog for at least Carlos's account.
    Doing both on one WS recovers the trade/dividend history. See the
    matching commit in Trade-Republic-Dashboard@3d93be5.
    """
    import asyncio
    TrWebSocket = tr["protocol"].TrWebSocket if "protocol" in tr else None
    if TrWebSocket is None:
        # tr dict was assembled in _import_tr_api(); fall back to direct import
        from tr_api.protocol import TrWebSocket  # type: ignore

    tx_csv = data_dir / "account_transactions.csv"
    last_update_file = data_dir / "last_update.date"

    if not (force_full or not tx_csv.exists() or not last_update_file.exists()):
        try:
            last_str = last_update_file.read_text(encoding="utf-8").strip().split()[0]
            cutoff = datetime.strptime(last_str, "%Y-%m-%d").replace(tzinfo=timezone.utc) - timedelta(days=3)
        except Exception:
            cutoff = None
    else:
        cutoff = None

    async def _go():
        async with TrWebSocket(client.session.cookies) as ws:
            tx_items = await _paginate_topic_on_ws(ws, "timelineTransactions", cutoff=cutoff)
            print(
                f"  timelineTransactions: {len(tx_items)} items"
                + (f" (since {cutoff:%Y-%m-%d})" if cutoff else ""),
                flush=True,
            )
            act_items = await _paginate_topic_on_ws(ws, "timelineActivityLog", cutoff=cutoff)
            print(
                f"  timelineActivityLog:  {len(act_items)} items"
                + (f" (since {cutoff:%Y-%m-%d})" if cutoff else ""),
                flush=True,
            )
            return tx_items, act_items

    try:
        tx_items, act_items = asyncio.run(_go())
    except tr["SessionExpired"]:
        sys.stderr.write("Session expired during transactions fetch.\n")
        sys.exit(10)
    except tr["TrApiError"] as e:
        sys.stderr.write(f"Transactions fetch failed: {e}\n")
        sys.exit(20)

    items = tx_items + act_items

    if cutoff is not None:
        _merge_into_csv(tx_csv, items)
        return

    rows = [_row_from_tr_event(e) for e in items]
    rows = [r for r in rows if r]
    rows.sort(key=lambda r: r["Date"], reverse=True)
    _write_csv(tx_csv, rows)


def _safe_call(tr, fn):
    try:
        return fn()
    except tr["SessionExpired"]:
        sys.stderr.write("Session expired during transactions fetch.\n")
        sys.exit(10)
    except tr["TrApiError"] as e:
        sys.stderr.write(f"Transactions fetch failed: {e}\n")
        sys.exit(20)


def _merge_into_csv(tx_csv: Path, new_items: list[dict[str, Any]]) -> None:
    existing_rows: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    if tx_csv.exists():
        with tx_csv.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f, delimiter=";"):
                k = f"{row.get('Date','')}|{row.get('Type','')}|{row.get('Value','')}|{row.get('Note','')}"
                if k in seen_keys:
                    continue
                seen_keys.add(k)
                existing_rows.append(row)

    for ev in new_items:
        r = _row_from_tr_event(ev)
        if not r:
            continue
        k = f"{r['Date']}|{r['Type']}|{r['Value']}|{r['Note']}"
        if k in seen_keys:
            continue
        seen_keys.add(k)
        existing_rows.append(r)

    existing_rows.sort(key=lambda r: r.get("Date", ""), reverse=True)
    _write_csv(tx_csv, existing_rows)


def _classify_corporate_action(title: str, subtitle: str) -> str:
    """Decide whether SSP_CORPORATE_ACTION_CASH is a Dividend, Interest
    (bond coupon) or Bond redemption (principal return at maturity).
    Defaults to Dividend (stock dividend, the most common case).
    """
    blob = (title + " " + subtitle).lower()
    if any(kw in blob for kw in ("endfälligkeit", "endgültige fälligkeit",
                                  "fälligkeit", "maturity", "redemption",
                                  "principal return", "ausbuchung")):
        return "Bond redemption"
    if any(kw in blob for kw in ("zinszahlung", "coupon", "interest payment",
                                  "zinsgutschrift", "kuponzahlung")):
        return "Interest"
    return "Dividend"


def _extract_isin(ev: dict[str, Any]) -> str:
    """Best-effort ISIN extraction from a TR timeline event.
    ISIN format: 2-letter ISO country prefix + 9 alphanum + 1 check = 12 chars.
    """
    def _looks_like_isin(s: str) -> bool:
        return len(s) == 12 and s[:2].isalpha() and s[2:].isalnum()

    icon = ev.get("icon") or ""
    if "logos/" in icon:
        for piece in icon.split("/"):
            if _looks_like_isin(piece):
                return piece

    for key in ("instrumentId", "isin", "ISIN"):
        v = ev.get(key)
        if isinstance(v, str) and _looks_like_isin(v):
            return v

    for parent_key in ("details", "action", "instrument"):
        parent = ev.get(parent_key)
        if isinstance(parent, dict):
            for k in ("isin", "ISIN", "instrumentId", "subtitleText", "id"):
                v = parent.get(k)
                if isinstance(v, str) and _looks_like_isin(v):
                    return v

    return ""


def _row_from_tr_event(ev: dict[str, Any]) -> dict[str, Any]:
    """Map one TR timeline event to a CSV row.

    NEVER returns None — unrecognized eventTypes become Type="Unknown"
    so the raw EventType stays visible in the CSV. Mirrors
    Trade-Republic-Dashboard/app/tr_fetch.py.
    """
    ev_type = ev.get("eventType") or ""
    title = (ev.get("title") or "").strip()
    subtitle = (ev.get("subtitle") or "").strip()

    csv_type = EVENT_TYPE_MAP.get(ev_type)
    if csv_type == "Trade":
        csv_type = _classify_trade(ev) or "Unknown"
    elif csv_type == "Dividend":
        csv_type = _classify_corporate_action(title, subtitle)
    elif csv_type is None:
        csv_type = "Unknown"

    timestamp = ev.get("timestamp") or ev.get("eventTime") or ""
    amount = ev.get("amount") or {}
    value = amount.get("value") if isinstance(amount, dict) else amount

    # Bond events have title="Feb 2025" (generic month) and the real
    # descriptor in subtitle. Surface the more informative one.
    if subtitle and (not title or title.endswith(" 2025") or
                     title.endswith(" 2026") or title.endswith(" 2024") or
                     title.endswith(" 2027") or title.endswith(" 2028")):
        note = subtitle + (" — " + title if title else "")
    else:
        note = title or subtitle

    isin = _extract_isin(ev)

    ev_subtype = (
        ev.get("eventSubType")
        or ev.get("subEventType")
        or (ev.get("details") or {}).get("subType")
        or subtitle  # last resort — preserves bond-docs descriptor
        or ""
    )

    return {
        "Date":   timestamp,
        "Type":   csv_type,
        "Value":  "" if value is None else str(value),
        "Note":   note,
        "ISIN":   isin,
        "Shares": "",
        "Fees":   "",
        "Taxes":  "",
        "ISIN2":  "",
        "Shares2": "",
        "EventType":    ev_type,
        "EventSubType": ev_subtype,
    }


def _classify_trade(ev: dict[str, Any]) -> str | None:
    amount = ev.get("amount") or {}
    val = amount.get("value") if isinstance(amount, dict) else amount
    if isinstance(val, (int, float)):
        return "Buy" if val < 0 else "Sell"
    title = (ev.get("title") or "").lower()
    if "buy" in title or "kauf" in title:
        return "Buy"
    if "sell" in title or "verk" in title:
        return "Sell"
    return None


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, delimiter=";")
        w.writeheader()
        for r in rows:
            for c in CSV_COLUMNS:
                r.setdefault(c, "")
            w.writerow(r)


# ---------------------------------------------------------------------------
# Analytics (computed inline — no separate script call)
# ---------------------------------------------------------------------------
def compute_analytics(data_dir: Path) -> None:
    csv_path = data_dir / "account_transactions.csv"
    portfolio_json = data_dir / "portfolio.json"
    history_file = data_dir / "net_worth_history.json"

    # Mirrors Trade-Republic-Dashboard@b831205 — see that commit for the
    # full rationale on the Withdrawal vs Removal split.
    analytics: dict[str, Any] = {
        "cash_flow": {
            "deposits":    {"count": 0, "total": 0.0},
            "tax_refunds": {"count": 0, "total": 0.0},
            "removals":    {"count": 0, "total": 0.0},   # CARD spending only
            "withdrawals": {"count": 0, "total": 0.0},   # to user's own bank
            "buys":        {"count": 0, "total": 0.0},
            "sells":       {"count": 0, "total": 0.0},
            # Annualized money-weighted return (XIRR), %. Computed from
            # Deposit/Withdrawal flows + terminal value.
            "xirr": None,
            "net_capital_in":  0.0,  # = deposits + tax_refunds − withdrawals
            "net_traded":      0.0,
            "current_value":   0.0,
            "lifetime_pl":     0.0,  # = current_value + removals − net_capital_in − investment_income
            "lifetime_pl_pct": 0.0,
            "monthly": [],
        },
        "dividends": {
            "monthly": {}, "total_received": 0, "count": 0,
            "recent": [], "all_payments": [], "by_issuer": {},
            "forward_12mo": None,
            "forward_12mo_basis_days": 0,
            "forward_12mo_payments_used": 0,
            "yield_on_cost": None,
        },
        "allocation": {"categories": {"Stocks": 0, "ETFs": 0, "Crypto": 0, "Cash": 0}, "total": 0},
        "history": [],
        "contributors": {"top": [], "bottom": []},
        "benchmark": None,
    }

    monthly_flow: dict[str, dict[str, float]] = defaultdict(
        lambda: {"deposits": 0.0, "removals": 0.0, "withdrawals": 0.0, "tax_refunds": 0.0,
                 "buys": 0.0, "sells": 0.0}
    )

    if csv_path.exists():
        with csv_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter=";"):
                t_type = (row.get("Type") or "").strip()
                date_str = (row.get("Date") or "")[:10]
                month = date_str[:7] if date_str else None
                try:
                    val = float(row.get("Value") or "0")
                except (TypeError, ValueError):
                    continue
                abs_val = abs(val)
                cf = analytics["cash_flow"]

                if t_type == "Deposit":
                    cf["deposits"]["count"] += 1
                    cf["deposits"]["total"] += abs_val
                    if month: monthly_flow[month]["deposits"] += abs_val
                elif t_type == "Removal":
                    cf["removals"]["count"] += 1
                    cf["removals"]["total"] += abs_val
                    if month: monthly_flow[month]["removals"] += abs_val
                elif t_type == "Withdrawal":
                    cf["withdrawals"]["count"] += 1
                    cf["withdrawals"]["total"] += abs_val
                    if month: monthly_flow[month]["withdrawals"] += abs_val
                elif t_type == "Tax Refund":
                    cf["tax_refunds"]["count"] += 1
                    cf["tax_refunds"]["total"] += abs_val
                    if month: monthly_flow[month]["tax_refunds"] += abs_val
                elif t_type == "Buy":
                    cf["buys"]["count"] += 1
                    cf["buys"]["total"] += abs_val
                    if month: monthly_flow[month]["buys"] += abs_val
                elif t_type == "Sell":
                    cf["sells"]["count"] += 1
                    cf["sells"]["total"] += abs_val
                    if month: monthly_flow[month]["sells"] += abs_val

                if t_type in ("Dividend", "Interest"):
                    div = analytics["dividends"]
                    div["monthly"][month] = div["monthly"].get(month, 0) + abs_val
                    div["total_received"] += abs_val
                    div["count"] += 1
                    name = row.get("Note", "Unknown") or "Unknown"
                    isin = row.get("ISIN", "") or ""
                    div["all_payments"].append({
                        "date": date_str, "name": name, "isin": isin,
                        "amount": abs_val, "type": t_type,
                    })
                    key = name
                    bi = div["by_issuer"].setdefault(key, {
                        "name": name, "isin": isin,
                        "count": 0, "total": 0.0,
                        "first_date": date_str, "last_date": date_str,
                    })
                    bi["count"] += 1
                    bi["total"] += abs_val
                    if date_str < bi["first_date"]: bi["first_date"] = date_str
                    if date_str > bi["last_date"]:  bi["last_date"] = date_str
                    if not bi["isin"] and isin: bi["isin"] = isin

        div = analytics["dividends"]
        div["all_payments"].sort(key=lambda x: x["date"], reverse=True)
        div["recent"] = div["all_payments"][:10]
        for bi in div["by_issuer"].values():
            bi["total"] = round(bi["total"], 2)

    cf = analytics["cash_flow"]
    # New formula: net_capital_in subtracts ONLY Withdrawals (transfers
    # back to user's bank), NOT Removals (card spending). Card spending
    # is consumption funded from TR cash; it doesn't reduce the
    # "committed to TR" capital concept.
    cf["net_capital_in"] = (
        cf["deposits"]["total"]
        + cf["tax_refunds"]["total"]
        - cf["withdrawals"]["total"]
    )
    cf["net_traded"] = cf["buys"]["total"] - cf["sells"]["total"]
    for m in sorted(monthly_flow.keys()):
        d = monthly_flow[m]
        net_flow     = d["deposits"] + d["tax_refunds"] - d["removals"] - d["withdrawals"]
        net_invested = d["buys"] - d["sells"]
        cf["monthly"].append({
            "month": m,
            "deposits":      round(d["deposits"], 2),
            "removals":      round(d["removals"], 2),
            "withdrawals":   round(d["withdrawals"], 2),
            "tax_refunds":   round(d["tax_refunds"], 2),
            "buys":          round(d["buys"], 2),
            "sells":         round(d["sells"], 2),
            "net_flow":      round(net_flow, 2),
            "net_invested":  round(net_invested, 2),
        })

    if portfolio_json.exists():
        p_data = json.loads(portfolio_json.read_text(encoding="utf-8"))
        summary = p_data.get("summary", {})
        cash_eur = summary.get("cash_eur", 0)
        total_netvalue = summary.get("total_netvalue", 0)

        analytics["allocation"]["categories"]["Cash"] = cash_eur
        for pos in p_data.get("all_positions", []):
            val = pos.get("net_value_eur", 0)
            name = (pos.get("name") or "").lower()
            if "etf" in name or "msci" in name or "nasdaq" in name:
                analytics["allocation"]["categories"]["ETFs"] += val
            elif any(c in name for c in ("bitcoin", "ethereum", "crypto", "solana", "xrp")):
                analytics["allocation"]["categories"]["Crypto"] += val
            else:
                analytics["allocation"]["categories"]["Stocks"] += val
        analytics["allocation"]["total"] = sum(analytics["allocation"]["categories"].values())

        # Top / bottom 5 contributors by P/L €
        valued = [pos for pos in p_data.get("all_positions", [])
                  if (pos.get("net_value_eur") or 0) > 0]
        valued.sort(key=lambda p: (p.get("pl_eur") or 0), reverse=True)
        def _contrib(pos):
            return {
                "name":          pos.get("name", "—"),
                "isin":          pos.get("isin", ""),
                "category":      pos.get("category", ""),
                "net_value_eur": round(float(pos.get("net_value_eur") or 0), 2),
                "pl_eur":        round(float(pos.get("pl_eur") or 0), 2),
                "pl_pct":        round(float(pos.get("pl_pct") or 0), 2),
            }
        analytics["contributors"]["top"]    = [_contrib(p) for p in valued[:5]]
        analytics["contributors"]["bottom"] = [_contrib(p) for p in valued[-5:][::-1]]

        # Lifetime P/L = price appreciation on the capital committed to TR,
        # excluding lifestyle spending and dividend/interest income.
        #
        #   lifetime_pl = current_value + card_spending
        #                 − net_capital_in − investment_income
        #
        # See Trade-Republic-Dashboard@b831205 for the full derivation.
        # None when net_capital_in <= 0 (incomplete CSV).
        cf["current_value"] = total_netvalue
        investment_income = analytics["dividends"]["total_received"] or 0.0
        if cf["net_capital_in"] > 0:
            cf["lifetime_pl"] = (
                total_netvalue
                + cf["removals"]["total"]
                - cf["net_capital_in"]
                - investment_income
            )
            cf["lifetime_pl_pct"] = cf["lifetime_pl"] / cf["net_capital_in"] * 100
        else:
            cf["lifetime_pl"] = None
            cf["lifetime_pl_pct"] = None
            cf["lifetime_pl_note"] = (
                "Net capital in TR is non-positive — your transaction "
                "history is likely incomplete (TR splits trades and "
                "dividends across timelineTransactions and "
                "timelineActivityLog; if the latter returned empty, "
                "deposits and trade history can be missing). "
                "Lifetime P/L can't be computed reliably."
            )

    # Net worth history — reconstruct from CSV cash flows.
    # Same approach as Trade-Republic-Dashboard@a3d2cb5: cost-basis
    # trajectory (deposits + tax_refunds + dividends + interest − removals)
    # over time. Buys/sells skipped (they shift wealth between cash and
    # positions but don't change total). Today's market value lives in
    # its own KPI card; the chart focuses on capital injection history.
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily_wealth: dict[str, float] = {}
    running = 0.0
    if csv_path.exists():
        with csv_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter=";")
            rows = sorted(reader, key=lambda r: (r.get("Date") or ""))
            for row in rows:
                t_type = (row.get("Type") or "").strip()
                date = (row.get("Date") or "")[:10]
                if not date:
                    continue
                try:
                    val = float(row.get("Value") or "0")
                except (TypeError, ValueError):
                    continue
                # 2026-06-01: switched from external-cash-flow trajectory
                # (deposits − card spending) to net-invested trajectory
                # (buys − sells). Matches what the Analytics line + benchmark
                # replay actually compare. See analyze_analytics.py for the
                # full rationale.
                if t_type == "Buy":
                    running += abs(val)
                elif t_type == "Sell":
                    running -= abs(val)
                daily_wealth[date] = round(running, 2)

    history = [{"date": d, "value": daily_wealth[d]} for d in sorted(daily_wealth.keys())]
    if history and history[-1]["date"] != today:
        history.append({"date": today, "value": history[-1]["value"]})
    elif not history:
        history.append({"date": today, "value": 0.0})
    history = history[-365:]  # keep up to ~1 year
    history_file.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")
    analytics["history"] = history

    # ========================================================================
    # XIRR + forward dividends + yield on cost + benchmark replay
    # Added 2026-06-01 — see Trade-Republic-Dashboard@... for full rationale.
    # ========================================================================
    today_d = datetime.now().date()

    # XIRR: deliberately conservative (Deposit/Withdrawal + terminal only).
    # TR hybrid usage (card spending + investment) makes a fuller XIRR
    # mathematically unstable — see the analyze_analytics.py comment block.
    xirr_flows = []
    if csv_path.exists():
        with csv_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter=";"):
                t_type = (row.get("Type") or "").strip()
                date_str = (row.get("Date") or "")[:10]
                if not date_str:
                    continue
                try:
                    val = float(row.get("Value") or "0")
                    d   = datetime.fromisoformat(date_str).date()
                except (TypeError, ValueError):
                    continue
                amt = abs(val)
                if t_type == "Deposit":
                    xirr_flows.append((d, -amt))
                elif t_type == "Withdrawal":
                    xirr_flows.append((d, +amt))
    if cf["current_value"] > 0:
        xirr_flows.append((today_d, +cf["current_value"]))
    cf["xirr"] = xirr(xirr_flows)

    # Forward 12-month dividend income + yield on cost.
    fwd, basis_days, npayments = forward_dividend_income(
        analytics["dividends"]["all_payments"], today_d
    )
    analytics["dividends"]["forward_12mo"] = fwd
    analytics["dividends"]["forward_12mo_basis_days"] = basis_days
    analytics["dividends"]["forward_12mo_payments_used"] = npayments
    if fwd is not None and cf["buys"]["total"] > 0:
        analytics["dividends"]["yield_on_cost"] = round(
            fwd / cf["buys"]["total"] * 100, 2
        )

    # Benchmark replays (MSCI World, S&P 500, Nasdaq 100, all EUR UCITS).
    benchmarks_out = []
    if cf["monthly"]:
        first_month = cf["monthly"][0]["month"]
        try:
            start_d = datetime.fromisoformat(first_month + "-01").date()
        except ValueError:
            start_d = today_d - timedelta(days=365)
        cache_dir = data_dir / "benchmark_cache"
        cache_dir.mkdir(exist_ok=True)
        BENCHMARKS = [
            ("IWDA.AS", "MSCI World",  "#fbbf24"),
            ("VUSA.AS", "S&P 500",     "#34d399"),
            ("CNDX.AS", "Nasdaq 100",  "#c084fc"),  # iShares Nasdaq 100 UCITS
        ]
        # Replay uses net_invested (buys − sells) so the comparison is
        # apples-to-apples with the user's line.
        replay_input = [{"month": m["month"], "net_flow": m["net_invested"]} for m in cf["monthly"]]
        for sym, label, color in BENCHMARKS:
            cache_path = cache_dir / (sym.replace(".", "_") + ".json")
            bench_history = fetch_benchmark_monthly(sym, start_d, today_d, cache_path=cache_path)
            replayed = replay_against_benchmark(replay_input, bench_history) if bench_history else []
            if replayed:
                benchmarks_out.append({
                    "symbol":  sym,
                    "label":   label,
                    "color":   color,
                    "history": replayed,
                })
    analytics["benchmarks"] = benchmarks_out
    analytics["benchmark"] = benchmarks_out[0] if benchmarks_out else None

    (data_dir / "analytics.json").write_text(
        json.dumps(analytics, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    if cf.get("lifetime_pl") is None:
        print(f"  analytics: deposits=€{cf['deposits']['total']:,.2f}  "
              f"removals=€{cf['removals']['total']:,.2f}  "
              f"current=€{cf['current_value']:,.2f}  "
              f"lifetime P/L=— (incomplete data)")
    else:
        print(f"  analytics: deposits=€{cf['deposits']['total']:,.2f}  "
              f"removals=€{cf['removals']['total']:,.2f}  "
              f"current=€{cf['current_value']:,.2f}  "
              f"lifetime P/L=€{cf['lifetime_pl']:+,.2f}")


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch Trade Republic data into a per-user dir via tr-api."
    )
    parser.add_argument("--profile-dir", required=True,
                        help="Where tr-api should store its profile (cookies etc.).")
    parser.add_argument("--data-dir", required=True,
                        help="Where to write *.json / *.csv output files.")
    parser.add_argument("--mfa-code", help="4-digit code from TR app push (optional).")
    parser.add_argument("--full", action="store_true",
                        help="Force full transactions download (skip incremental).")
    args = parser.parse_args()

    profile_dir = Path(args.profile_dir).expanduser().resolve()
    data_dir = Path(args.data_dir).expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(profile_dir, 0o700)
        os.chmod(data_dir, 0o700)
    except OSError:
        pass

    # Redirect tr-api's storage (~/.tr-api/profiles/<phone>/...) into our
    # per-user profile dir by re-pointing HOME. tr-api uses Path.home() to
    # build its profile paths, so this is the simplest cross-version hook.
    os.environ["HOME"] = str(profile_dir)

    phone = (os.environ.get("TR_PHONE") or "").strip()
    pin = (os.environ.get("TR_PIN") or "").strip()
    if not phone.startswith("+") or not pin:
        sys.stderr.write("ERROR: TR_PHONE / TR_PIN missing or malformed in environment.\n")
        sys.exit(12)

    if args.mfa_code is not None:
        code = args.mfa_code.strip()
        if not (code.isdigit() and len(code) == 4):
            sys.stderr.write("ERROR: --mfa-code must be exactly 4 digits.\n")
            sys.exit(11)

    tr = _import_tr_api()
    client = get_authenticated_client(tr, phone, pin, data_dir, args.mfa_code)

    print("Fetching portfolio snapshot...", flush=True)
    shaped = fetch_portfolio(tr, client, data_dir)
    (data_dir / "portfolio.json").write_text(
        json.dumps(shaped, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"  positions: {shaped['total_positions']}  "
          f"net value: €{shaped['summary']['total_netvalue']:,.2f}")

    print("Fetching transactions...", flush=True)
    fetch_transactions(tr, client, data_dir, args.full)

    print("Computing analytics...", flush=True)
    compute_analytics(data_dir)

    (data_dir / "last_update.date").write_text(
        datetime.now().strftime("%Y-%m-%d %H:%M:%S\n"), encoding="utf-8"
    )
    print("OK Fetch complete.")
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(30)
