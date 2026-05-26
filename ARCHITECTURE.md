# ARCHITECTURE — trade-republic-owncloud

How the app is built, where each thing lives, and why.

Structurally parallel to
[`gbm-owncloud`](https://github.com/cdamken/gbm-owncloud). If you know
that repo, this one is five minutes to get up to speed — the only real
difference is the login flow (TR uses **2-step push** instead of TOTP).

## High-level diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│  User's browser (logged into ownCloud, own session + cookie)           │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ownCloud 10  (Apache + PHP-FPM)                                       │
│                                                                        │
│  Router → OCA\TradeRepublic\Controller\PageController   (GET  /)       │
│        → OCA\TradeRepublic\Controller\ApiController     (GET/POST /api)│
│                                                                        │
│  CSRF middleware active on POSTs (setConfig, update, reset)            │
│                                                                        │
│  Controllers get TrService via DI auto-wiring.                         │
│  TrService resolves userId LAZILY from IUserSession per request.       │
│                                                                        │
│  TrService.runFetch($mfaCode, $full)                                   │
│    └─ proc_open([                                                      │
│           trade_republic.python_bin,                                   │
│           apps/trade_republic/python/fetch_wrapper.py,                 │
│           --profile-dir {datadir}/<uid>/trade_republic/profile,        │
│           --data-dir    {datadir}/<uid>/trade_republic,                │
│           --mfa-code    (if the browser sent one)                      │
│           --full        (if the user ticked "Full reload")             │
│       ], env=TR_PHONE, TR_PIN (decrypted via ICrypto), ...)            │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ subprocess
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│  fetch_wrapper.py  (Python 3.10+, venv with tr-api[browser])           │
│                                                                        │
│   set HOME = --profile-dir   (redirects ~/.tr-api/ to per-user)        │
│                                                                        │
│   ┌── Step 1 (no --mfa-code, cookies dead) ────────────────────────┐   │
│   │   auth.initiate_login(phone, pin)                               │   │
│   │     → TR pushes 4-digit code to the mobile app                 │   │
│   │     → store processId in {data-dir}/.pending_login.json        │   │
│   │     → exit 10 (mfa_required)                                   │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ┌── Step 2 (--mfa-code supplied) ─────────────────────────────────┐  │
│   │   process_id = read({data-dir}/.pending_login.json)             │  │
│   │   auth.complete_login(process_id, code)                         │  │
│   │     → cookies persisted to {profile-dir}/.tr-api/.../cookies    │  │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ► portfolio.snapshot_full(client)  → portfolio.json + raw           │
│   ► transactions.fetch_since / fetch_all → account_transactions.csv   │
│   ► compute_analytics() inline → analytics.json + net_worth_history   │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTPS WebSocket
                               ▼
                       Trade Republic API
                  (auth + WS api.traderepublic.com)
```

## On-disk layout (per user)

```
{datadirectory}/<uid>/trade_republic/
├── profile/                           ← tr-api profile dir (0700)
│   └── .tr-api/profiles/<phone>/
│       ├── cookies.json               ← persisted by tr-api
│       └── profile.json
├── .pending_login.json                ← in-flight processId (0600, TTL 5 min)
├── portfolio.json                     ← consumed by the dashboard
├── portfolio_raw.json                 ← raw TR WS payload (debug)
├── account_transactions.csv           ← timeline in pytr-compatible CSV
├── analytics.json                     ← cash flow, dividends, allocation
├── net_worth_history.json             ← daily snapshot rows
├── last_update.date                   ← "YYYY-MM-DD HH:MM:SS"
└── fetch.log                          ← stdout/stderr of the last run
```

`{datadirectory}` comes from `occ config:system:get datadirectory`. Every
directory is `0700` and every file is `0600`.

## Per-user isolation — the model

User `alice` cannot see `bob`'s data. Guaranteed by:

1. **Identity bound at construction.** `TrService::userId()` is resolved
   lazily from `IUserSession->getUser()->getUID()`. There is no setter.
   There is no way to construct `TrService` with an arbitrary userId.

2. **Paths derived from userId.** Every file path inside the service is
   built as `$this->dataDirRoot . '/' . $this->userId() . '/trade_republic/...'`.

3. **Whitelist in `dataPath()`.** The method that maps a filename to a
   path filters against an explicit whitelist (`portfolio.json`,
   `analytics.json`, `net_worth_history.json`, `last_update.date`). Path
   traversal does not work.

4. **CSRF active on mutation endpoints.** `setConfig`, `update` and
   `reset` validate the ownCloud token. Another tab/domain can't trigger
   them without the user's session cookie.

5. **`@NoAdminRequired` doesn't mean "public".** The ownCloud auth
   middleware still requires login. Without login there's no user →
   `userId()` throws `RuntimeException` and the request dies.

6. **HOME redirected per user.** The Python wrapper does
   `os.environ["HOME"] = profile_dir`, so `tr-api` writes its cookies and
   `processId` inside the per-user dir. Even if two users used the same
   phone (rare), their profile dirs are different.

## Credentials — where and how

| Field | Form | Table / Path | Encrypted |
|---|---|---|---|
| Phone | E.164 string | DB `oc_preferences` (`<uid>`, `trade_republic`, `phone`) | No (not a secret) |
| PIN | 4-6 digits string | DB `oc_preferences` (`<uid>`, `trade_republic`, `pin_enc`) | **Yes**, `ICrypto::encrypt` |
| TR cookies | JSON | Filesystem `{datadir}/<uid>/trade_republic/profile/.tr-api/...` (0700) | No (short-lived) |
| In-flight processId | JSON | Filesystem `{datadir}/<uid>/trade_republic/.pending_login.json` (0600) | No (TTL 5 min) |

ownCloud's `ICrypto::encrypt` uses AES-256-CBC with the `secret` defined
in `config.php`. Without access to the server's `config.php`, encrypted
PINs in `oc_preferences` can't be recovered.

## Why a two-step login (vs. gbm-owncloud's TOTP)

TR doesn't use TOTP — it uses a **push challenge**:

1. Call `auth.initiate_login(phone, pin)`. TR responds with a `processId`
   and pushes a 4-digit code to the user's mobile app.
2. Receive the code from the user and call
   `auth.complete_login(processId, code)`. TR responds with session
   cookies.

This forces two HTTP roundtrips between browser and server: the first
POST `/api/update` fires `initiate_login` and stores the `processId` on
disk; the second POST `/api/update` (with `mfa_code`) reads that
`processId` and completes the login.

The `.pending_login.json` file is the bridge between the two. It has a
5-minute TTL: if the user opens the modal and then gets distracted,
coming back lets them press "Update" without a code and start a fresh
push (the TTL has passed and `_load_pending` returns None); if they come
back within the TTL, the push is NOT restarted (the previous code is
still valid).

Compared to gbm-owncloud (TOTP):
- In GBM, the code is generated by the user's authenticator app, and the
  fetch is stateless: a single POST with `totp_code` does the whole
  thing.
- In TR, the code is issued by TR in response to `initiate_login`. The
  server MUST remember the `processId` between the push and the user's
  submission.

## Why data lives in an `appdata`-like dir, not in `files/`

Three reasons:

1. **We don't want it showing up in the user's File explorer.** Putting
   it under `{datadir}/<uid>/files/TR/` would expose it in the web UI and
   sync it to the desktop client.
2. **Relative privacy.** Any mechanism that exposes `files/` (shares,
   public links) could expose the JSON. Outside `files/`, there's no way
   to list it without filesystem access.
3. **Explicit cleanup.** When a user leaves or hits reset, deleting the
   `trade_republic/` dir is enough — no need to chase scattered files
   inside `files/`.

## Why a Python bridge instead of a PHP port

`tr-api` is the source of truth for TR's actual WebSocket endpoints. When
TR changes something, `tr-api` ships a fix and this app gets it for free
with a `pip install -U tr-api`. Porting the WebSocket + WAF/Playwright to
PHP would be enormous investment for zero benefit.

If `tr-api` ever exposes its WS over HTTP (microservice), we could talk
to that endpoint from PHP and stop `proc_open`-ing — the `TrService`
interface wouldn't change and the controllers wouldn't notice.

## Error model

`fetch_wrapper.py` uses exit codes that `TrService` maps to JSON statuses
the JS interprets:

| Exit | JSON status     | HTTP | Meaning |
|------|-----------------|------|---------|
| 0    | `ok`            | 200  | All good |
| 10   | `mfa_required`  | 401  | Cookies dead / no code → browser shows the 4-digit modal |
| 11   | `mfa_invalid`   | 401  | Wrong or expired code |
| 12   | `auth_failed`   | 401  | Phone/PIN rejected |
| 20   | `api_error`     | 502  | TR failed or `tr-api` crashed |
| 21   | `rate_limited`  | 429  | TR rate-limited the login |
| 30   | `config_error`  | 500  | Wrapper not found, lib missing, env empty |

The browser JS has an explicit branch for each (opens the MFA modal,
opens the config modal, shows a rate-limit alert, etc.).

## Differences vs. the `Trade-Republic-Dashboard` architecture

`Trade-Republic-Dashboard` runs a small Python HTTP server on localhost
and serves static HTML + `/update` and `/config` endpoints. Here:

- The HTTP server **is ownCloud** — the app doesn't start its own.
- `/update`, `/config` and `/reset` become ownCloud routes, with real
  auth + CSRF + per-user scope.
- HTML pages become templates rendered by ownCloud (with its layout,
  navigation, etc.).
- `tr_fetch.py` + `analyze_analytics.py` are merged into
  `fetch_wrapper.py` so PHP only has to `proc_open` once.
- Credentials come from the ownCloud DB (PIN encrypted) instead of
  `~/.pytr/credentials`.

## Extension point: add a new view

To add, e.g., an "alerts" page:

1. Add a route in `appinfo/routes.php`:
   `['name' => 'page#alerts', 'url' => '/alerts', 'verb' => 'GET']`
2. Add an `alerts()` method to `PageController` returning a
   `TemplateResponse` (with `@NoCSRFRequired`).
3. Create `templates/alerts.php` and `js/alerts.js`.
4. The data URLs keep coming from the `routes` array the template
   injects into `#tr-app` data-attributes.

No API controller or service changes needed.

## Extension point: sync a new dataset

Typical case: also store pending orders (not just executed).

1. Modify `python/fetch_wrapper.py` to add the new fetch and write, e.g.,
   `orders_pending.json`.
2. Add `'orders_pending.json'` to the whitelist in `TrService::dataPath()`.
3. Add `'orders_pending' => 'orders_pending.json'` in
   `ApiController::data()`.
4. Any new view that wants it requests it via
   `dataUrl('orders_pending')`.

`fetch_wrapper.py` is the only place that decides what gets downloaded
and how it's structured — everything else is presentation.
