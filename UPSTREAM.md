# Relationship with upstream

This repo has **two upstreams**, both authored by Carlos Damken:

- [`tr-api`](https://github.com/cdamken/tr-api) — the Python library that
  reverse-engineers Trade Republic's WebSocket. Source of truth for
  everything that touches the TR servers (login, portfolio,
  transactions). Installed from GitHub into the server's venv.
- [`Trade-Republic-Dashboard`](https://github.com/cdamken/trade-republic-dashboard) —
  the local single-user dashboard running on `localhost`. Source of
  truth for the UI/UX (HTML, CSS, Chart.js graphs) and the data-shaping
  logic (`tr_fetch.py`, `analyze_analytics.py`).

**This repo is a port** for multi-user ownCloud 10. The installations
are **independent**: they don't share credentials, data or session
state. One runs on your Mac, the other on your ownCloud server.

## Workflow rule (read this first)

New features land in `tr-api` or `Trade-Republic-Dashboard` **first**.
The ownCloud port follows. Never the reverse, never in parallel.

When porting:

1. **Copy verbatim.** HTML, CSS, JS, Python — line-for-line copies of
   the upstream files, into the matching ownCloud locations.
2. **Patch only what ownCloud forces.** The exhaustive list is in
   "Structural divergences" below. Anything else is a bug.
3. **Document anything else.** If a UX divergence is genuinely
   justified by the multi-user context, add it under "Intentional
   divergences" with a reason. Drift without an entry here = bug.

If you find yourself rebuilding UI from scratch or using a sibling
project (e.g. `gbm-owncloud`) as a template, **stop**. That's how the
port grew Spanish strings and lost the Chart.js graphs in earlier
attempts.

This doc enumerates, one by one, the divergences from upstream and why
they exist. If you're coming from either upstream repo, this is your
roadmap.

> When upstream moves, this port should align unless the divergence is
> structural (marked with 🔒). Any other divergence should converge.

---

## File map

| Upstream (TR-Dashboard) | Port (this repo) | Change |
|---|---|---|
| `app/tr_fetch.py` (717 lines) | `python/fetch_wrapper.py` (746) | Merged with `analyze_analytics.py` |
| `app/analyze_analytics.py` (190) | `python/fetch_wrapper.py::compute_analytics` | Inline (no subprocess) |
| `app/server.py` | `lib/Controller/ApiController.php` | PHP instead of a Python HTTP server |
| `app/index.html` | `templates/main.php` + `js/dashboard.js` + `css/dashboard.css` | ownCloud template, CSP-friendly |
| `app/analytics.html` | `templates/analytics.php` + `js/analytics.js` | Same |
| `dashboard.sh` | n/a — the app is enabled by `occ app:enable` | No script |
| `~/.pytr/credentials` (plain text) | DB `oc_preferences` (PIN encrypted) | Per-user, encrypted |
| `~/.tr-api/profiles/<phone>/` | `{datadir}/<uid>/trade_republic/profile/.tr-api/profiles/<phone>/` | Per-user, via `HOME` override |
| `DATA/` (repo root) | `{datadir}/<uid>/trade_republic/` | Per-user, outside `files/` |

---

## Structural divergences 🔒 (don't converge)

Forced by the ownCloud context. Upstream will never have these, and this
port will never drop them.

### 1. Credentials in `oc_preferences`, not in `~/.pytr/credentials`

- **Upstream**: reads `~/.pytr/credentials` (line 1 phone, line 2 PIN,
  plain text, `0600`).
- **Port**: reads `TR_PHONE` and `TR_PIN` from env vars.
  `TrService::runFetch()` injects them after decrypting the PIN with
  `ICrypto`.
- **Why**: multi-user. There's no single home; `www-data` can't separate
  credentials per session.

### 2. Per-user profile dir via `HOME` redirect

- **Upstream**: `tr-api` writes to `~/.tr-api/profiles/<phone>/`.
- **Port**: `fetch_wrapper.py` sets `os.environ["HOME"] = profile_dir`
  before importing `tr-api`, so its internal paths land inside
  `{datadir}/<uid>/trade_republic/profile/.tr-api/...`.
- **Why**: isolate each ownCloud user's TR cookies.

### 3. Per-user pending login state

- **Upstream**: `.pending_login.json` in `PROJECT_DIR/DATA/`.
- **Port**: `.pending_login.json` in `{datadir}/<uid>/trade_republic/`.
- **Why**: same as #2.

### 4. Per-user data dir

- **Upstream**: `PROJECT_DIR/DATA/` (discovered via
  `Path(__file__).resolve().parent.parent / "DATA"`).
- **Port**: `--data-dir` passed by CLI from PHP. Whitelist in
  `TrService::dataPath()` prevents path traversal.
- **Why**: PHP must control the path to guarantee isolation.

### 5. MFA login: no more TTY

- **Upstream**: `tr_fetch.py` can read the MFA code from stdin when
  interactive (`--non-interactive` skips that).
- **Port**: **always** non-interactive. `--mfa-code` is the only way to
  pass the code. PHP can't talk to stdin after `proc_open`.
- **Why**: the browser delivers the code via POST `/api/update`; PHP
  starts a fresh subprocess with the code in `argv`.

### 6. Analytics computed inline

- **Upstream**: `tr_fetch.py` runs `subprocess.run([sys.executable,
  "analyze_analytics.py"])` at the end.
- **Port**: `fetch_wrapper.py::compute_analytics()` does it in the same
  process.
- **Why**: one subprocess from PHP → one timeout, one exit code, one
  log. Fewer moving parts.

### 7. Update + MFA flow lives in PHP/JS, not in a Python HTTP server

- **Upstream**: `app/server.py` runs on `localhost:8085`, serves
  `index.html` statically and endpoints `/update`, `/config`, `/reset`.
- **Port**: real ownCloud routes:
  - `GET /apps/trade_republic/` → `PageController::index`
  - `POST /apps/trade_republic/api/update` → `ApiController::update`
  - etc.
- **Why**: ownCloud already has auth, CSRF, sessions, navigation.
  Spinning up a Python HTTP server would be redundant and insecure
  (open port, no CSRF, no login).

### 8. Shared Chromium cache for Playwright

- **Upstream**: each user installs Playwright/Chromium locally
  (`pipx install pytr` + `playwright install chromium`) in their home.
- **Port**: install once in `/var/cache/tr-playwright/`, passed to the
  subprocess via `PLAYWRIGHT_BROWSERS_PATH`. Configurable with
  `occ config:system:set trade_republic.playwright_browsers_path`.
- **Why**: the app redirects `HOME` per user → without the shared cache,
  every user would re-download ~150 MB on their first login.

### 9. `--full` exists in the MFA modal too

- **Upstream**: `--full` is CLI-only (`./dashboard.sh full`).
- **Port**: the MFA modal has a "Full reload" checkbox that sends
  `{full: true}` in the `POST /api/update`.
- **Why**: the user has no shell access on the server; they need a
  browser-side option.

### 10. "Erase account" button (not in upstream)

- **Upstream**: manual delete via `./dashboard.sh reset` (CLI).
- **Port**: red button in the **⚙ Account** modal with a `delete`-style
  confirmation. Calls `POST /api/reset` → `TrService::reset()` which
  wipes prefs and `rm -rf {datadir}/<uid>/trade_republic/`.
- **Why**: same as #9.

---

## Intentional divergences (non-structural, but justified)

Design decisions that improve the port's UX and wouldn't apply to the
local script. Documented so a future merge from upstream doesn't
accidentally overwrite them.

### 11. `last_update.date` includes time

- **Upstream**: `datetime.now().strftime("%Y-%m-%d")` → `"2026-05-23"`.
- **Port**: `datetime.now().strftime("%Y-%m-%d %H:%M:%S")` →
  `"2026-05-23 14:32:01"`.
- **Why**: the port's header shows "Last update: May 23, 2026, 2:32 PM";
  the local one shows "2026-05-23". More useful when several users
  refresh at different times of day.
- **Compatibility**: the incremental logic uses `.strip().split()[0]` on
  both sides, so the date stays extractable in either format.

### 12. `net_worth_history.json` stores detailed values

- **Upstream**: `analyze_analytics.py` overwrites the file with
  `[{date, value}]` (just two fields). Trims to 180 days.
- **Port**: `_append_net_worth_history` writes
  `{date, value, net_value, depot, cash, pl_eur}` and `compute_analytics`
  leaves it as is. Trims to 180 days (aligned with upstream as of
  `bb92d81+1`).
- **Why**: the port's analytics page has columns for Depot and Cash on
  top of total value. The upstream JS only reads `value`, so it's still
  compatible if someone migrates from local to the port (the `value`
  field is present).

### 13a. CSV served through the api#data route (`transactions_csv`)

- **Upstream**: `orders.html` / `ledger.html` fetch the raw CSV via
  `fetch('../DATA/account_transactions.csv')` — same static-file
  pattern as `portfolio.json`.
- **Port**: the JS reads `routes.data.replace('__TYPE__','transactions_csv')`
  and `ApiController::data` whitelists the file with content-type
  `text/csv; charset=utf-8`. `TrService::dataPath()` adds
  `account_transactions.csv` to its allow-list.
- **Why**: the same reason `portfolio.json` doesn't sit in a public
  directory — per-user isolation. The route handler resolves the path
  from the authenticated session.

### 13b. `_shared.js` loaded via `Util::addScript`, not inline `<script src>`

- **Upstream**: `orders.html` and `ledger.html` include
  `<script src="_shared.js"></script>` directly before their inline
  page script.
- **Port**: ownCloud's CSP forbids inline `<script>` blocks, so the
  page logic lives in `js/orders.js` / `js/ledger.js`. PageController
  loads `js/_shared.js` first (only for the `orders` and `ledger`
  templates) via `Util::addScript('_shared')`. Same execution order,
  same globals exposed (`fmtEUR`, `fmtSignedEUR`, `fmtDate`, `monthKey`,
  `monthLabel`, `parseCsv`).
- **Why**: CSP. Identical to how `vendor/chart.umd.min.js` is loaded
  for Analytics + Dividends.

### 13. Cookies / pending login schema

- **Upstream**: `_pending_login.json` with `{phone, process_id, issued_at}`,
  TTL 5 min.
- **Port**: identical. **No divergence** — listed here to avoid confusion.

---

## Expected convergence (intentionally aligned with upstream)

Areas where we explicitly want behavior identical to local. If you find
drift here, **it's a bug** worth fixing.

| Area | Expected behavior |
|---|---|
| `EVENT_TYPE_MAP` (TR eventType → CSV Type) | Identical, character for character |
| `_shape_portfolio` (TR JSON → portfolio.json mapping) | Same field names, same fallback rules, same 25-char name truncation |
| `account_transactions.csv` schema | Same columns, same `;` separator, same merge dedupe key `Date|Type|Value|Note` |
| `portfolio.json` schema | Same structure (`summary`, `top_25`, `winners_50plus`, `losers_25minus`, `all_positions`, `zero_value_positions`) |
| `analytics.json` schema | Same sub-keys (`cash_flow`, `dividends`, `allocation`, `history`) |
| Exit codes 0/10/11/12/20/21/30 | Same meanings |
| Incremental transactions window (3-day overlap) | Identical |
| Heuristic allocation categories (ETFs / Crypto / Stocks / Cash) | Identical |
| `net_worth_history` truncation to 180 days | Identical |

---

## How to verify there's no accidental drift

The single source of divergence is the wrapper:

```bash
# From the app repo root:
diff -u <(sed -n '/^EVENT_TYPE_MAP/,/^}/p' python/fetch_wrapper.py) \
        <(sed -n '/^EVENT_TYPE_MAP/,/^}/p' ../Trade-Republic-Dashboard/app/tr_fetch.py)
```

Any output there means the type map drifted — investigate.
