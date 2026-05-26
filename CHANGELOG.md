# CHANGELOG

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
