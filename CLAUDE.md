# CLAUDE.md — Trade-Republic-owncloud

> Context for AI assistants. Humans: see [README.md](README.md) and
> the docs/ folder.

## What this is

ownCloud 10 app that wraps the local [Trade-Republic-Dashboard](https://github.com/cdamken/trade-republic-dashboard)
for multi-user use. Each ownCloud user gets their own per-user
data directory and per-user TR cookie jar. Built on
[`tr-api`](https://github.com/cdamken/tr-api).

## Position in the trio

```
   tr-api (library)  ──┐
                       ├──► Trade-Republic-Dashboard   (upstream, local single-user)
                       │      │
                       │      ▼ verbatim port + minimal ownCloud patches
                       └──► Trade-Republic-owncloud    (this repo — downstream)
```

**This repo is DOWNSTREAM.** It does NOT originate features. Bug
fixes and UI changes land in `Trade-Republic-Dashboard` first; this
repo copies them.

The only changes that originate here are forced by the multi-user
ownCloud context — per-user paths, env-injected credentials, CSP
adaptations, etc. The full list of structural divergences lives in
[UPSTREAM.md](UPSTREAM.md). If you find yourself adding a new feature
HERE first, stop and rethink — it probably belongs upstream.

## The cardinal rule: copy verbatim, patch minimally

When porting from upstream, copy line-for-line. The only allowed
patches without UPSTREAM.md justification:

- **Fetch URLs**: read from `data-route-*` attrs on `#tr-app`
  (template injects them via PageController). Replaces hardcoded
  `/update`, `/DATA/portfolio.json`, etc.
- **CSRF**: `requesttoken: OC.requestToken` header on every POST.
- **Inline `on*=` handlers**: stripped from HTML, re-wired via
  `addEventListener` in the external JS (ownCloud CSP forbids inline
  scripts).
- **Credentials path**: `~/.pytr/credentials` → ownCloud DB
  (`oc_preferences`, PIN encrypted with `ICrypto`).
- **Data dir**: `PROJECT_DIR/DATA/` → `{datadir}/<uid>/trade_republic/`.

Anything else MUST land upstream first.

## Deployment topology

```
~/damkencloud/Claude/Trade-Republic-owncloud/    ← source repo (this; with .git)
                  │
                  │  rsync -a --exclude='.git/'
                  ▼
~/damkencloud/oc_Apps/trade_republic/            ← local "deploy copy"
                  │
                  │  rsync over SSH (sudo on the server side)
                  ▼
cloud.damken.com:/var/www/owncloud/apps/trade_republic/   ← live
```

The sync commands look like (from this repo's root):

```bash
rsync -a --delete --exclude='__pycache__/' --exclude='*.pyc' \
      --exclude='.git/' --exclude='.DS_Store' --exclude='.scrapped/' \
      ./ ~/damkencloud/oc_Apps/trade_republic/

rsync -a -e "ssh -A -i ~/.ssh/id_ed25519 -p 2222" \
      --exclude='__pycache__/' --exclude='*.pyc' --exclude='.git/' \
      --rsync-path="sudo rsync" \
      ./ carlos@cloud.damken.com:/var/www/owncloud/apps/trade_republic/

ssh -A -i ~/.ssh/id_ed25519 -p 2222 carlos@cloud.damken.com \
  'sudo chown -R www-data:www-data /var/www/owncloud/apps/trade_republic'
```

## Architecture

ownCloud app boilerplate (info.xml + Application class + routes), with
a small Service that shells out to a Python wrapper (per-user, profile
dir HOME-redirected so `tr-api` cookies land inside the per-user dir).

```
appinfo/{info.xml, app.php, routes.php}
lib/
├── Application.php
├── Controller/
│   ├── ApiController.php       /api/config, /api/update, /api/reset, /data/{type}
│   └── PageController.php      / (portfolio), /analytics
└── Service/
    └── TrService.php           per-user paths, subprocess to fetch_wrapper.py
python/
└── fetch_wrapper.py            tr-api consumer; per-user --profile-dir + --data-dir
templates/
├── main.php                    portfolio page (verbatim from Dashboard's index.html)
└── analytics.php               analytics page (verbatim from Dashboard's analytics.html)
js/
├── dashboard.js                rewired event handlers + route URLs (verbatim logic)
├── analytics.js                same — plus the polished chart helpers
└── vendor/chart.umd.min.js     Chart.js 4.x vendored (CSP forbids CDN)
css/
└── dashboard.css               every selector scoped under #tr-app (ownCloud core.css wars)
img/app.svg                     navigation entry icon
```

## Workflow rules (read before changing code)

1. **Check upstream first.** If you're about to fix a bug in
   `python/fetch_wrapper.py` or change an `EVENT_TYPE_MAP` entry,
   the same change probably belongs in
   `Trade-Republic-Dashboard/app/tr_fetch.py`. Do that first.
2. **CSP is strict.** No inline `<script>` blocks. No `on*=`
   attributes. Inline `style="..."` is OK because `PageController`
   calls `$csp->allowInlineStyle(true)`.
3. **`Util::addScript` auto-appends `.js`.** Pass `'vendor/chart.umd.min'`
   NOT `'vendor/chart.umd.min.js'`. Pre-2026-05-26 we had a bug here.
4. **CSS scoping**: every selector must be prefixed `#tr-app` (or
   `#tr-app.analytics-page` for analytics-specific overrides).
   Bare `table { ... }` rules lose to ownCloud's core.css on
   specificity and the tables look crushed.
5. **Per-user data isolation** is the security boundary. Never accept
   a userId from request input — `TrService::userId()` resolves it
   from `IUserSession`. Don't add path-traversal-friendly helpers.

## Key files for quick reference

| File | What it does |
|---|---|
| `lib/Service/TrService.php::runFetch` | Spawns the Python subprocess with per-user `--profile-dir` and `--data-dir`, env-injects `TR_PHONE` / `TR_PIN` (decrypted via `ICrypto`). Also sets `PLAYWRIGHT_BROWSERS_PATH` to the shared cache. |
| `lib/Controller/ApiController.php` | `/api/update` flow + the 2-step MFA (initiate push, then complete with code). Maps Python wrapper exit codes (0/10/11/12/20/21/30) to JSON status strings. |
| `python/fetch_wrapper.py` | The ENTIRE pipeline: WAF token → push → wait for code → fetch portfolio (snapshot_full) → fetch both timeline topics on ONE WS → write CSV → compute analytics inline → write portfolio.json + analytics.json + net_worth_history.json. |
| `templates/main.php` + `js/dashboard.js` | Portfolio table with search/filter/sort. Verbatim from upstream. |
| `templates/analytics.php` + `js/analytics.js` | Charts (Cash Flow, Allocation, Net Worth, Dividends) using vendored Chart.js. |
| `UPSTREAM.md` | The diff catalog vs upstream Dashboard. Every divergence has a justification. |

## Recently resolved

- **2026-05-28**: Chart polish (gradients, smoother lines, polished
  tooltips). Mirrors upstream commit `d6af584`.
- **2026-05-28**: Withdrawal vs Removal split — analytics now matches
  user's mental model of "net capital committed to TR".
- **2026-05-28**: `EVENT_TYPE_MAP` updated for TR's 2026 rename
  (`TRADING_SAVINGSPLAN_EXECUTED`, `BANK_TRANSACTION_*`,
  `SSP_CORPORATE_ACTION_CASH`, etc.).
- **2026-05-26**: Chart.js loading fix (`addScript` auto-appends `.js`,
  don't include the suffix in the path).
- **2026-05-26**: CSS scoping pass — every selector prefixed `#tr-app`
  to win against ownCloud's `core.css`.
