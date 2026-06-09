# CHANGELOG

## 0.1.39 — 2026-06-10

Refactor D: broke up the 382-line `init()` in `js/analytics.js`
into four single-purpose helpers + a thin orchestrator.

### What changed

- `_renderCashFlowTiles(cf, div)` — top of the analytics page:
  deposits / refunds / removals / withdrawals tiles, lifetime
  P/L tile, forward-12mo dividend forecast, buys/sells totals,
  monthly average.
- `_renderAllocationChart(allocation)` — doughnut chart for the
  asset-category breakdown.
- `_renderGeoChart(root)` — best-effort geographic allocation
  bar chart (re-fetches `portfolio.json` for ISIN[:2] derivation).
- `_wireHistoryChart(data)` — net-worth chart with the
  1W/1M/3M/6M/1Y/All range selector and benchmark alignment.
  Owns its own range-button click handlers.
- `ISIN_COUNTRIES` constant lifted to module scope (was hidden
  inside the 382-line init body).

`init()` itself is now ~30 lines: load data → call the four
helpers in sequence. Reads top-down. Behavior unchanged.

Verified: `node --check`, verify_dom_ids, verify_wiring, all 9
unit tests green.

## 0.1.38 — 2026-06-10

Refactor B: extracted `BaseOwnCloudService` parent class.

`TrService` and the sister `GbmService` (gbm-owncloud) carried
~100 lines of byte-identical code each — DI constructor, lazy
`userId()` resolution, the EXIT_* constants, and the proc_open
`runProcess()` body. That duplication drifted independently
twice in the past, and any future bug fix would have had to be
remembered in both files.

### What changed

- New abstract class `BaseOwnCloudService` (171 lines) holds the
  shared plumbing:
  - DI-friendly constructor (IUserSession + IConfig + ICrypto)
  - Lazy `userId()` — security boundary against cross-user access
  - `userDir()` per-user data dir under `{datadir}/<uid>/<app>/`
    (subclass provides `<app>` via abstract `appDirName()`)
  - `runProcess()` — proc_open wrapper with timeout + fetch.log
  - `EXIT_OK` / `EXIT_MFA_REQUIRED` / `EXIT_MFA_INVALID` /
    `EXIT_AUTH_FAILED` / `EXIT_API_ERROR` / `EXIT_RATE_LIMITED` /
    `EXIT_CONFIG_ERROR`
- `TrService` extends it, drops the 100 duplicated lines, and now
  only carries TR-specific logic (credentials, profile dir, docs
  download, scanDocsFolder).
- `TrService.php`: 505 → 397 lines (−21%).
- The class is intentionally VENDORED-DUPLICATED with
  `gbm-owncloud/lib/Service/BaseOwnCloudService.php` (same content,
  different namespace) — two ownCloud apps can't share a class via
  composer without an extra package.

Verified: `php -l` clean, verify_dom_ids, verify_wiring, all 9
unit tests green.

## 0.1.35 — 2026-06-05

CI + automated test harness. Mirror of gbm-owncloud@v0.14.13.

### Added

- `scripts/verify_wiring.py` — JS-callable-reference verifier
  companion to `verify_dom_ids.py`.
- `tests/test_fetch_wrapper_smoke.py` — 5 stdlib-unittest tests
  on `python/fetch_wrapper.py` (file exists, no crash on `--help`,
  argparse-required args, `--full` accepted, exit codes in sync
  with `TrService.php`).
- `tests/test_verify_scripts.py` — 5 regression tests for both
  verifiers (planted-bug detection + comment/string false-positive
  prevention).
- `.github/workflows/ci.yml` — runs both verifiers + unittest on
  every push/PR. Pure stdlib Python, no `pip install`, ~2 s.
- `scripts/deploy.sh` step 0 now runs `verify_wiring.py` and
  `python3 -m unittest discover -s tests` as mandatory gates.

### Tests

```
$ python3 -m unittest discover -s tests -v
... 9 tests ...
----------------------------------------------------------------------
Ran 9 tests in 0.354s

OK
```

## 0.1.34 — 2026-06-05

Companion release to gbm-owncloud@v0.14.12 — same structural
clean-up applied to TR. The verifier from v0.1.33 surfaced three
stranded DOM references; this release cleans them up and gets
the codebase to ✅ on `verify_dom_ids.py`.

### Removed

- `cf-last-deposit` / `cf-last-deposit-date` references in
  `js/analytics.js` (last-deposit tile dropped in the
  2026-05-28 refactor; was guarded by a null-check but the
  template element was never coming back. Also removed the
  identical dead block from upstream
  `Trade-Republic-Dashboard/app/analytics.html` so the two stay
  aligned).

### Changed

- `js/dashboard.js::showStatus()` rewritten: instead of writing
  to the no-longer-existing `#update-status` span, it routes
  through `#toast` / `#toast-title` / `#toast-stage` — the same
  toast the update flow already uses. 15+ call-sites that were
  silently no-op'ing now show feedback again. The old
  `updateStatus()` helper is gone (it only existed to grab the
  removed element).
- `scripts/deploy.sh` now runs `scripts/verify_dom_ids.py` as a
  mandatory pre-deploy step (`--skip-verify` flag exists but
  exists only for debugging the verifier itself).
- `INSTALL.md` got new sections **6.5 Updating the app** (the
  deploy.sh flow) and **6.6 Parity guarantees with upstream**
  (link to `TR-GBM-Project/OWNCLOUD-PATCHES.md`, the 9-patch
  catalog of permitted dashboard→ownCloud transformations).

## 0.1.33 — 2026-06-05

Add `scripts/verify_dom_ids.py` — a pre-deploy check that catches
stranded JS references to DOM IDs that no template defines. The
2026-06-05 `settings-btn` debacle in gbm-owncloud showed how one
of these can throw at runtime, abort the rest of the wire-up, and
silently break unrelated features (the GBM TOTP submit button).

First run on this repo surfaced 3 latent issues (kept guarded by
null-checks today but worth cleaning up):

- `update-status` — 15+ `showStatus()` calls in `dashboard.js`
  silently no-op because the ID was dropped from the template
  during the toast refactor.
- `cf-last-deposit` / `cf-last-deposit-date` — `analytics.js`
  expects a "last deposit" tile that exists upstream in
  `Trade-Republic-Dashboard/app/analytics.html:436` but was never
  ported into `templates/analytics.php`.

Run with `python3 scripts/verify_dom_ids.py` from the repo root.

## 0.1.32 — 2026-06-03

Capture order lifecycle events (cancelled, expired, rejected,
pending) in the CSV with proper Type labels. Carlos has ~370 of
these in his account — previously they were lumped as Type="Unknown"
since they were unmapped in EVENT_TYPE_MAP.

### Added to EVENT_TYPE_MAP

- `ORDER_CANCELED`, `TRADING_ORDER_CANCELLED` → **Cancelled**
- `ORDER_EXPIRED`, `TRADING_ORDER_EXPIRED` → **Expired**
- `TRADING_ORDER_REJECTED` → **Rejected**
- `TRADING_ORDER_CREATED` → **Pending** (limit orders waiting to fill)

After Full Reload these events will show up in the Ledger with the
right Category badge. A dedicated "Histórico" page (matching GBM's
orders_all.html) was considered but deferred — the existing Ledger
filter can already surface them by Type.

## 0.1.31 — 2026-06-03

Same backdrop-blur policy cleanup as gbm-owncloud@0.13.6. Remove
`backdrop-filter: blur(…)` from `.modal-backdrop` and
`.progress-overlay` scrims. Top-bar header keeps its blur.

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
