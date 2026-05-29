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

The app talks to ownCloud, but it ALSO depends on a Python venv that lives
outside the app dir. Both have to stay in lockstep — the deploy script does
both. Three moving parts:

```
                  ┌─────────────────────────────────────────────────┐
                  │  1. THE APP — PHP/JS/CSS/templates              │
                  │                                                 │
~/damkencloud/Claude/Trade-Republic-owncloud/    ← source repo (this; with .git)
                  │                                                 │
                  │  rsync -a --exclude='.git/'                     │
                  ▼                                                 │
~/damkencloud/oc_Apps/trade_republic/            ← local "deploy copy"
                  │                                                 │
                  │  rsync over SSH (sudo on the server side)       │
                  ▼                                                 │
cloud.damken.com:/var/www/owncloud/apps/trade_republic/   ← live   │
                  └─────────────────────────────────────────────────┘

                  ┌─────────────────────────────────────────────────┐
                  │  2. THE LIB — Python tr-api package             │
                  │                                                 │
~/damkencloud/Claude/tr-api/                     ← separate repo    │
                  │                                                 │
                  │  rsync over SSH                                 │
                  ▼                                                 │
cloud.damken.com:/opt/tr-api-src/                ← staging dir      │
                  │                                                 │
                  │  pip install --upgrade --force-reinstall        │
                  ▼                                                 │
/opt/tr-venv/lib/python3.11/site-packages/tr_api/   ← actually used│
                  └─────────────────────────────────────────────────┘

                  ┌─────────────────────────────────────────────────┐
                  │  3. THE CACHE — ownCloud's ?v=<hash> on assets  │
                  │                                                 │
appinfo/info.xml <version>           ─derives→  /apps/.../dashboard.js?v=H
                  │
                  │  occ app:enable trade_republic  (regenerates H)
                  ▼
Browsers see new URL, drop cached JS, fetch the new one
                  └─────────────────────────────────────────────────┘
```

**Use `scripts/deploy.sh` for all three.** Manual rsync is fine for one-off
debugging but skipping any of these pillars causes silent breakage:

| You forget                | What breaks                                                                 |
|---------------------------|------------------------------------------------------------------------------|
| The app                   | Server runs old PHP, new feature flag never reaches users                    |
| The lib                   | `fetch_wrapper.py` crashes with `ImportError` on any new tr-api module       |
| The cache (version bump)  | Browser keeps cached JS forever, your JS fix doesn't reach users             |
| `chown www-data`          | Apache 500, PHP can't read the file                                          |

```bash
# Normal deploy (app + lib + chown, no version bump)
./scripts/deploy.sh

# JS or CSS changed → bump so browsers fetch new files
./scripts/deploy.sh --bump patch

# Pure tr-api hot-fix (no PHP/JS changes)
./scripts/deploy.sh --lib --no-app

# Pure PHP/template fix, lib unchanged
./scripts/deploy.sh --no-lib
```

Script ends with a smoke-test that imports every tr-api module
`fetch_wrapper.py` depends on. If any are missing it exits non-zero
(so your shell prompt / CI can flag it).

**Why two repos and a venv?** The local Dashboard repo has tr-api as
`pip install -e ../tr-api` (editable), so it always sees the latest changes
to tr-api with no reinstall. The server can't do that — `/opt/tr-venv/` is
a STATIC install. Skip step 2 and you ship an app that imports a module
that doesn't exist on the server. We hit exactly this on 2026-05-29 with
`from tr_api import accounts`; `accounts.py` had been added upstream but
the server's venv was a snapshot from before. `deploy.sh` exists to make
that class of bug impossible.

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

- **2026-05-28**: 'Documents' button + `POST /api/download_docs` route.
  `TrService::runDocsDownload()` shells out to `tr-api docs download
  --out {datadir}/<uid>/trade_republic/documents/` with HOME redirected
  to the per-user profile dir. PDFs appear in the user's Files app
  automatically under `trade_republic/documents/<YYYY>/<kind>/`.
  Verbatim port from upstream commit `efd2d71`.
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
