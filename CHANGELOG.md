# CHANGELOG

## 0.1.30 — 2026-06-03

UX fix: same as gbm-owncloud@0.13.4 — tighten the top spacing so
the cockpit doesn't sit a long way below the ownCloud red nav bar.

### Fixed

- `css/dashboard.css`: drop the 24px top padding on `#tr-app`.
  ownCloud's `#app-content` already pads the container; we were
  double-padding. The top-bar's `margin: 0 -24px` already had no
  negative-top, so no further adjustment needed here.

## 0.1.29 — 2026-06-03

Fix benchmark replay granularity for the analytics page (MSCI World,
S&P 500, Nasdaq 100 overlays). Same root cause as the GBM port:
Yahoo was being asked for `interval=1mo` and the JS was aggregating
by month, producing step-shaped lines.

### Fixed

- `python/fetch_wrapper.py`: Yahoo URL uses `interval=1d`.
- `js/analytics.js`: benchmark alignment iterates by day instead of
  by month-key. Carries forward the last known close on
  weekends/holidays.

### Notes

- Run a Full Reload after deploy so analytics.json is rebuilt with
  daily benchmark data (the old monthly data won't auto-refresh).

## 0.1.28 — 2026-06-03

The big eventType catch-up. Found by diff'ing pytr's `all_events.json`
(15,051 events) vs our CSV (14,294 events). Our `EVENT_TYPE_MAP` was
silently dropping **8 distinct cash-bearing eventTypes**, including the
bond coupons Carlos noticed (Aug 2040 US Treasury, etc.).

### Fixed

The original code had:
```
# SSP_CORPORATE_ACTION_CASH_NON_DIVIDEND — spinoff cash with no
#   matching position credit; revisit if a user wants it surfaced.
```
That was wrong. TR also uses this eventType for **bond coupons**
(subtitle="Zinszahlung") and **bond maturities**
(subtitle="Endgültige Fälligkeit"). 11 events in Carlos's data were
being dropped including the entire Aug 2040 coupon stream.

### Added to EVENT_TYPE_MAP

- `SSP_CORPORATE_ACTION_CASH_NON_DIVIDEND` → **Dividend** (then
  `_classify_corporate_action` routes bond coupons → Interest, bond
  maturities → Bond redemption).
- `SAVINGS_PLAN_EXECUTED` → **Buy** (legacy variant of
  TRADING_SAVINGSPLAN_EXECUTED).
- `CRYPTO_TRANSACTION_INCOMING` → **Deposit**.
- `CRYPTO_TRANSACTION_OUTGOING` → **Withdrawal**.
- `PAYMENT_INBOUND_CREDIT_CARD` → **Deposit**.
- `GIFTER_TRANSACTION` → **Deposit** (gift received from another TR user).
- `STOCK_PERK_REFUNDED` → **Deposit** (TR promo cash-back).
- `SSP_SECURITIES_TRANSFER_OUTGOING` → **Withdrawal** (transfer-out
  to another broker).

### Expected after Full Reload

- CSV row count rises from ~14.3k → ~15k+ events.
- Aug 2040 US Treasury coupon (Feb 17 2026, €17.18) appears as Type=Interest.
- Other bond coupons / Stock perks / Crypto-account flows all visible.
- Lifetime P/L numbers stabilize on real data instead of misclassified rows.

## 0.1.27 — 2026-06-03

Fix the position-row + position-modal external research links —
Yahoo Finance and Stock Analysis URLs were silently broken because
neither supports ISIN-based lookup (Yahoo killed the lookup
endpoint years ago; Stock Analysis only handles tickers). The
Trade Republic URL was also missing the `/profile/` segment.

### Changed

- TR URL: `app.traderepublic.com/instrument/<ISIN>` →
  `app.traderepublic.com/profile/instrument/<ISIN>` (the correct
  web-app pattern; works when logged in).
- Yahoo Finance link → **Boerse Frankfurt**
  (`boerse-frankfurt.de/equity/<ISIN>` — supports any ISIN
  natively, covers stocks, ETFs, bonds).
- Stock Analysis link → **Google search by ISIN** in the row,
  + **JustETF** in the modal (best for ETF fundamentals).
- Row chips: `TR / Y! / SA` → `TR / BF / G`.

### Notes

- All four modal links are now public + ISIN-friendly.
- JustETF only renders useful info for actual ETFs; for stocks the
  page is mostly empty — that's expected.

## 0.1.26 — 2026-06-03

Fix the SSP_CORPORATE_ACTION_CASH overload + stop silently dropping
unknown eventTypes. Triggered by Carlos finding bond redemptions
(€476.19 + €489.42 in Feb 2025) being counted as "Dividend", which
inflated investment_income by €965 and understated lifetime_pl. Also
found a US Treasury Aug 2040 coupon completely missing from the CSV
because the fetcher silently dropped it.

### Fixed

- `_row_from_tr_event()` **never returns None**. Unrecognized
  eventTypes now become Type="Unknown" rows so they're visible in
  the CSV and can be debugged. Previously such events disappeared.
- `SSP_CORPORATE_ACTION_CASH` is now classified by title + subtitle:
  - Contains "Endfälligkeit" / "Fälligkeit" / "maturity" / "redemption"
    / "Ausbuchung" → **Bond redemption** (neutral, NOT income)
  - Contains "Zinszahlung" / "coupon" / "interest payment" /
    "Zinsgutschrift" → **Interest**
  - Otherwise → **Dividend** (stock dividend, default)
- Better ISIN extraction: tries `instrumentId`, `details.isin`,
  `details.instrumentId`, `action.isin`, etc., not just the icon URL.
  Bond events with placeholder icons should now surface their real
  ISIN (XS0213101073, US912810SQ22, etc.).
- Better Note: when title is generic ("Feb 2025") and subtitle is
  populated, surface the subtitle ("Zinszahlung", "Endfälligkeit") so
  the row is identifiable at a glance.
- EventSubType column now also falls back to `subtitle` from the
  event payload, preserving the bond-document descriptor even when
  TR doesn't expose `eventSubType` explicitly.

### Behavior

- After Full Reload: bond redemptions show Type="Bond redemption"
  in the Ledger. They don't show up under "Dividends" anymore →
  the Dividends total drops by the bond-principal amount. The
  lifetime_pl computation no longer subtracts those as fake income,
  so the metric goes UP.
- Any new TR eventType we haven't mapped becomes Type="Unknown"
  with the raw EventType visible in column 11. Grep for those to
  discover what TR added: `awk -F';' '$2=="Unknown"'`.

### Requires Full Reload

Existing rows in the CSV keep their old classification (Dividend).
Click ⟳ Update Now → ↻ Full Reload to re-fetch and re-classify.

## 0.1.25 — 2026-06-03

Refine the Dividends Payment ledger cap (rolling back the over-eager
0.1.24 fix which removed it entirely). 1150 rows on screen was
overkill — the user only needs a glanceable view of the latest
events plus filters to drill down.

### Changed

- `js/dividends.js`: cap visible rows at 50 (was: all 1150 in 0.1.24,
  silently capped at 1000 with misleading label before that).
- Label adapts to context:
  - default (date desc): "showing newest 50 of 1150 — refine with filters above"
  - sorted date asc: "showing oldest 50 of 1150 — refine with filters above"
  - other sort: "showing top 50 of 1150 — refine with filters above"
  - with filters: "…of 80 matching the filters — refine further"
  - rows ≤ 50: no truncation label
  - 0 rows: "No payments match the current filters"

### Notes

- Also applied to `Trade-Republic-Dashboard/app/dividends.html`
  upstream — both apps now show the same cap and the same label
  (unification policy).

## 0.1.24 — 2026-06-03

Fix: Dividends "Payment ledger" was silently hiding older payments.
The table sorts by date desc (newest first) and then sliced to 1000
rows, with the misleading label "showing first 1000 — refine filters".
Reported by Carlos: he had 1150 dividends; the oldest 150 were not
visible and no warning hinted that re-sorting by date asc would
also hide the newest ones.

### Fixed

- `js/dividends.js`: remove the `rows.slice(0, 1000)` cap. Matches
  upstream `Trade-Republic-Dashboard/app/dividends.html` which has
  always rendered all rows. Browsers handle 1500+ rows fine.

## 0.1.23 — 2026-06-03

Debug: capture raw TR eventType + eventSubType in
`account_transactions.csv`. Several TR types collapse into one CSV
"Type" via `EVENT_TYPE_MAP` (e.g. `CREDIT` and
`SSP_CORPORATE_ACTION_CASH` both become "Dividend"), making it
impossible to discriminate promotional bonuses from real dividends
once the data lands in the CSV.

### Added

- CSV columns `EventType` and `EventSubType` at the end of each
  row. Backwards-compatible: `analyze_analytics.py` reads by name,
  older consumers can ignore the new columns.
- `_row_from_tr_event()`: extracts `eventType` + `eventSubType` (or
  `subEventType` / `details.subType` as fallbacks) and writes them
  into the row dict.

### Notes

- New columns only populate after **the next Full Reload** — the
  incremental merge keeps existing rows as-is. To debug the Feb 2025
  anomaly, do a Full Reload and grep the CSV for the affected dates.

## 0.1.22 — 2026-06-03

Bug fix: timeline pagination was capping at ~6000 events (≈9 months
of active account history) because `_paginate_topic_on_ws` had a
`max_pages=200` safety limit and TR returns ~30 items/page.
Anyone with more than ~9 months of activity was silently losing
older transactions — they never reached the CSV, never showed up in
Ledger, and XIRR's reconciliation window was artificially shortened.

### Fixed

- `python/fetch_wrapper.py::_paginate_topic_on_ws`: `max_pages` bumped
  200 → 2000. Now handles up to ~60k events, enough for 5+ years
  even on power-user accounts (savings plans + dividends + interest
  + buys/sells).

### To apply on existing installs

- After deploying, click **⟳ Actualizar** with the **"↻ Full Reload"**
  checkbox ticked. That re-pulls the full timeline from scratch.
  Incremental fetches won't backfill the missing history because
  they only pull forward from `last_update`.

## 0.1.21 — 2026-06-03

Ledger page now shows **all events by default** instead of
truncating to 500 rows. Users with 6k+ events were seeing "500 of
5,982 (truncated)" without realizing the page-size dropdown
existed.

### Changed

- `templates/ledger.php` page-size dropdown: default changes from
  `500` to `999999` (All rows). Other options reordered to:
  All / 200 / 500 / 1000 / 2000. The "(slow)" label removed —
  modern browsers render 6k rows fine.

## 0.1.20 — 2026-06-03

Surface XIRR (annualized return) in the cockpit, matching gbm-owncloud's
5-KPI layout. The metric was already computed in `analyze_analytics.py`
upstream but never displayed — closes part of the GBM/TR visual
unification gap.

### Added

- 5th cockpit KPI card: **XIRR (annualized)** between Total P/L and
  Available Cash. Reads `cash_flow.xirr` from `analytics.json`
  (already produced by upstream's `analyze_analytics.py`).
- `dashboard.js::load()` now also fetches `analytics` via the existing
  `/data/{type}` endpoint, with a soft-fail (analytics is optional —
  first-run users won't have it yet).
- Tooltip on the card explains money-weighted vs simple P/L %.

### Changed

- Cockpit grid: `2fr 1fr 1fr 1fr` → `2fr 1fr 1fr 1fr 1fr`.

### Notes

- When XIRR can't converge (only one cash-flow sign, or all flows
  outside the tr-api window): the card shows "—" with a sub-label
  explaining the state. Same UX as GBM.
- TR has unlimited timeline history (no GBM-style 365d API window),
  so XIRR is genuinely useful here — most users should see a real
  annualized number rather than "—".

## 0.1.0 — 2026-05-26

First release.

### Features

- ownCloud 10 app (`apps/trade_republic/`) with namespace
  `OCA\TradeRepublic` and app id `trade_republic`.
- Entry in the navigation bar ("Trade Republic") with `app.svg` icon.
- Two pages:
  - `/` — portfolio dashboard (summary, top movers, searchable table
    with filters by value range and by P/L).
  - `/analytics` — monthly cash flow, dividends, allocation by category,
    net-worth history.
- JSON endpoints `/data/{type}` for `portfolio`, `analytics`,
  `net_worth_history`, `last_update`.
- Per-user configuration (`⚙ Account`): E.164 phone + PIN. PIN encrypted
  with `ICrypto`.
- Trade Republic two-step login flow:
  - POST `/api/update` with no code → `initiate_login` → TR pushes a
    4-digit code → exit 10 / `mfa_required`.
  - POST `/api/update` with `mfa_code` → `complete_login` → cookies
    saved → fetch + analytics.
- "Erase account" button that wipes phone, PIN, cookies and downloaded
  data (`delete`-style confirmation).
- "Full reload" checkbox in the MFA modal: forces a full re-download of
  the transaction history (vs. the default incremental mode).
- Per-user isolation guaranteed by `TrService::userId()` (lazy from
  `IUserSession`) + file whitelist + `HOME` redirect so `tr-api` writes
  its cookies inside the per-user dir.
- Server config: `trade_republic.python_bin` (default `python3`),
  `trade_republic.playwright_browsers_path` (default
  `/var/cache/tr-playwright`).

### Repo layout

```
appinfo/{info.xml, app.php, routes.php}
lib/Application.php
lib/Controller/{Page,Api}Controller.php
lib/Service/TrService.php
python/fetch_wrapper.py
templates/{main,analytics}.php
js/{dashboard,analytics}.js
css/dashboard.css
img/app.svg
```

### Notes

- Structurally parallel to `gbm-owncloud@0.4.0`. Same exit codes, same
  isolation model, same approach of injecting credentials via env vars
  into the Python wrapper.
- Backend lib: [`tr-api`](https://github.com/cdamken/tr-api) with the
  `[browser]` extras (Playwright + Chromium) to resolve the Cloudflare
  WAF in front of TR's auth.
