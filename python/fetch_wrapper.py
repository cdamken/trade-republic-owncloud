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
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CSV_COLUMNS = ["Date", "Type", "Value", "Note", "ISIN", "Shares",
               "Fees", "Taxes", "ISIN2", "Shares2"]

# TR's eventType → dashboard CSV "Type" column. Verified against live TR
# responses (May 2026). Kept in sync with TR-Dashboard's tr_fetch.py.
EVENT_TYPE_MAP: dict[str, str] = {
    # Cash in
    "INCOMING_TRANSFER":            "Deposit",
    "INCOMING_TRANSFER_DELEGATION": "Deposit",
    "PAYMENT_INBOUND":              "Deposit",
    "PAYMENT_INBOUND_SEPA_DIRECT_DEBIT": "Deposit",
    "card_refund":                  "Deposit",
    "CARD_REFUND":                  "Deposit",
    # Cash out / card spending
    "CARD_TRANSACTION":             "Removal",
    "card_successful_transaction":  "Removal",
    "OUTGOING_TRANSFER":            "Removal",
    "OUTGOING_TRANSFER_DELEGATION": "Removal",
    "PAYMENT_OUTBOUND":             "Removal",
    # Tax flows
    "ssp_tax_correction_invoice":   "Tax Refund",
    "TAX_REFUND":                   "Tax Refund",
    # Trading (Buy vs Sell decided by _classify_trade — looks at amount sign)
    "TRADE_INVOICE":                "Trade",
    "ORDER_EXECUTED":               "Trade",
    # Income
    "CREDIT":                       "Dividend",
    "DIVIDEND":                     "Dividend",
    "ssp_corporate_action_invoice_cash": "Dividend",
    "INTEREST_PAYOUT":              "Interest",
    "INTEREST_PAYOUT_CREATED":      "Interest",
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

    shaped = _shape_portfolio(snap)
    _append_net_worth_history(data_dir, shaped["summary"])
    return shaped


def _shape_portfolio(snap: dict[str, Any]) -> dict[str, Any]:
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

    return {
        "summary": {
            "depot_buycost": round(depot_buycost, 2),
            "depot_netvalue": round(depot_netvalue, 2),
            "depot_pl_eur": depot_pl_eur,
            "depot_pl_pct": depot_pl_pct,
            "cash_eur": round(cash_eur, 2),
            "total_buycost": round(depot_buycost, 2),
            "total_netvalue": round(depot_netvalue + cash_eur, 2),
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
def fetch_transactions(tr, client, data_dir: Path, force_full: bool) -> None:
    tx_csv = data_dir / "account_transactions.csv"
    last_update_file = data_dir / "last_update.date"

    if force_full or not tx_csv.exists() or not last_update_file.exists():
        items = _safe_call(tr, lambda: tr["transactions"].fetch_all(client))
    else:
        try:
            last_str = last_update_file.read_text(encoding="utf-8").strip().split()[0]
            last = datetime.strptime(last_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            items = _safe_call(tr, lambda: tr["transactions"].fetch_all(client))
        else:
            cutoff = last - timedelta(days=3)  # overlap window catches late settlements
            items = _safe_call(tr, lambda: tr["transactions"].fetch_since(client, cutoff))
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


def _row_from_tr_event(ev: dict[str, Any]) -> dict[str, Any] | None:
    ev_type = ev.get("eventType") or ""
    csv_type = EVENT_TYPE_MAP.get(ev_type)
    if csv_type is None:
        return None

    if csv_type == "Trade":
        csv_type = _classify_trade(ev)
        if csv_type is None:
            return None

    timestamp = ev.get("timestamp") or ev.get("eventTime") or ""
    amount = ev.get("amount") or {}
    value = amount.get("value") if isinstance(amount, dict) else amount
    note = (ev.get("title") or ev.get("subtitle") or "").strip()

    # ISIN is best-effort: TR's icon URL contains it (logos/<ISIN>/v2).
    isin = ""
    icon = ev.get("icon") or ""
    if "logos/" in icon:
        for piece in icon.split("/"):
            if len(piece) == 12 and piece[:2].isalpha() and piece[2:].isalnum():
                isin = piece
                break

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

    analytics: dict[str, Any] = {
        "cash_flow": {
            "deposits":    {"count": 0, "total": 0.0},
            "removals":    {"count": 0, "total": 0.0},
            "tax_refunds": {"count": 0, "total": 0.0},
            "buys":        {"count": 0, "total": 0.0},
            "sells":       {"count": 0, "total": 0.0},
            "net_capital_in":  0.0,
            "net_traded":      0.0,
            "current_value":   0.0,
            "lifetime_pl":     0.0,
            "lifetime_pl_pct": 0.0,
            "monthly": [],
        },
        "dividends": {"monthly": {}, "total_received": 0, "recent": []},
        "allocation": {"categories": {"Stocks": 0, "ETFs": 0, "Crypto": 0, "Cash": 0}, "total": 0},
        "history": [],
    }

    monthly_flow: dict[str, dict[str, float]] = defaultdict(
        lambda: {"deposits": 0.0, "removals": 0.0, "tax_refunds": 0.0}
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
                elif t_type == "Tax Refund":
                    cf["tax_refunds"]["count"] += 1
                    cf["tax_refunds"]["total"] += abs_val
                    if month: monthly_flow[month]["tax_refunds"] += abs_val
                elif t_type == "Buy":
                    cf["buys"]["count"] += 1
                    cf["buys"]["total"] += abs_val
                elif t_type == "Sell":
                    cf["sells"]["count"] += 1
                    cf["sells"]["total"] += abs_val

                if t_type in ("Dividend", "Interest"):
                    analytics["dividends"]["monthly"][month] = \
                        analytics["dividends"]["monthly"].get(month, 0) + abs_val
                    analytics["dividends"]["total_received"] += abs_val
                    analytics["dividends"]["recent"].append({
                        "date": date_str,
                        "name": row.get("Note", "Unknown"),
                        "amount": abs_val,
                    })

        analytics["dividends"]["recent"].sort(key=lambda x: x["date"], reverse=True)
        analytics["dividends"]["recent"] = analytics["dividends"]["recent"][:10]

    cf = analytics["cash_flow"]
    cf["net_capital_in"] = cf["deposits"]["total"] + cf["tax_refunds"]["total"] - cf["removals"]["total"]
    cf["net_traded"] = cf["buys"]["total"] - cf["sells"]["total"]
    for m in sorted(monthly_flow.keys()):
        d = monthly_flow[m]
        cf["monthly"].append({
            "month": m,
            "deposits": round(d["deposits"], 2),
            "removals": round(d["removals"], 2),
            "tax_refunds": round(d["tax_refunds"], 2),
            "net_flow": round(d["deposits"] + d["tax_refunds"] - d["removals"], 2),
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

        cf["current_value"] = total_netvalue
        if cf["net_capital_in"] > 0:
            cf["lifetime_pl"] = total_netvalue - cf["net_capital_in"]
            cf["lifetime_pl_pct"] = cf["lifetime_pl"] / cf["net_capital_in"] * 100

    if history_file.exists():
        try:
            analytics["history"] = json.loads(history_file.read_text(encoding="utf-8")) or []
        except Exception:
            analytics["history"] = []

    (data_dir / "analytics.json").write_text(
        json.dumps(analytics, indent=2, ensure_ascii=False), encoding="utf-8"
    )
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
