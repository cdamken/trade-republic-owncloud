# INSTALL — trade-republic-owncloud

Exact steps to install the app on an ownCloud 10 instance. Assumes
Ubuntu 20.04+ / Debian 11+ with Apache + PHP-FPM, but the app is
OS-agnostic; it just needs Python 3.10+ with `tr-api` installed and an
ownCloud 10.x.

## 1. Python 3.10+ with `tr-api`

`tr-api` requires Python 3.10 or higher. If your system only ships 3.8
(typical on Ubuntu 20.04), install a standalone one — a separate venv
works perfectly and doesn't touch the system.

```bash
# If you already have python3.10+ on the server:
sudo python3 -m venv /opt/tr-venv

# If not, on Ubuntu 22.04+:
sudo apt install python3.10-venv
sudo python3.10 -m venv /opt/tr-venv

# On Ubuntu 20.04 (focal), deadsnakes no longer publishes for focal. The
# fix is to install standalone Python 3.11 with uv or pyenv and create
# the venv from that binary. Detail below if it applies to you.
```

Install `tr-api` with the browser extras (for the TR WAF). `tr-api` is
not yet published on PyPI — install directly from GitHub:

```bash
sudo /opt/tr-venv/bin/pip install --upgrade pip
sudo /opt/tr-venv/bin/pip install "tr-api[browser] @ git+https://github.com/cdamken/tr-api.git"

# Verify
sudo /opt/tr-venv/bin/python -c "import tr_api; print(tr_api.__version__)"
```

### If you're on Ubuntu 20.04 (focal)

`python3.10-venv` isn't published for focal. Options:

```bash
# Option A: pyenv
curl https://pyenv.run | bash
pyenv install 3.11.9
sudo $(pyenv which python) -m venv /opt/tr-venv

# Option B: uv (simpler)
curl -LsSf https://astral.sh/uv/install.sh | sh
sudo uv venv --python 3.11 /opt/tr-venv
```

Then continue with `pip install "tr-api[browser] @ git+..."` as above.

## 2. Chromium (Playwright) in a shared cache

`tr-api` uses Playwright to resolve the Cloudflare WAF in front of TR's
login. If we let each user install Chromium in their HOME, that's ~150 MB
downloaded per user on first login. Better to install once in a shared
cache and let the app consume it:

```bash
# 1. Download Chromium straight into the shared cache
#    (PLAYWRIGHT_BROWSERS_PATH tells `playwright install` where to put
#    the binaries).
sudo PLAYWRIGHT_BROWSERS_PATH=/var/cache/tr-playwright \
  /opt/tr-venv/bin/playwright install chromium

# 2. Install the system libraries Chromium needs (libatk-bridge,
#    libgtk-3, libnss, etc.). Without these, Chromium fails with
#    "error while loading shared libraries".
sudo /opt/tr-venv/bin/playwright install-deps chromium

# 3. Permissions: venv and cache readable by www-data, not writable.
sudo chown -R root:www-data /opt/tr-venv /var/cache/tr-playwright
sudo chmod -R g+rX        /opt/tr-venv /var/cache/tr-playwright

# 4. Verify www-data can run Chromium.
sudo -u www-data /var/cache/tr-playwright/chromium-*/chrome-linux64/chrome --version
```

The app passes `PLAYWRIGHT_BROWSERS_PATH=/var/cache/tr-playwright` to the
Python wrapper automatically (see `TrService::runFetch`). If you need a
different path:

```bash
sudo -u www-data php occ config:system:set trade_republic.playwright_browsers_path \
    --value=/some/other/playwright
```

## 3. Clone and enable the app

```bash
cd /var/www/owncloud/apps
sudo -u www-data git clone https://github.com/cdamken/trade-republic-owncloud.git trade_republic

# Verify permissions (should be www-data:www-data)
ls -la /var/www/owncloud/apps/trade_republic

# Enable
sudo -u www-data php /var/www/owncloud/occ app:enable trade_republic

# Point at the venv
sudo -u www-data php /var/www/owncloud/occ config:system:set trade_republic.python_bin --value=/opt/tr-venv/bin/python
```

## 4. Smoke test

```bash
# Make the wrapper complain loudly if anything is wrong:
sudo -u www-data /opt/tr-venv/bin/python /var/www/owncloud/apps/trade_republic/python/fetch_wrapper.py --help
```

Should print the `argparse` help with `--profile-dir`, `--data-dir`,
`--mfa-code` and `--full`. If it says "tr-api is not installed", check
the venv path and the `config:system:set` command.

## 5. First login from the browser

Open `https://your-owncloud/index.php/apps/trade_republic/`:

1. The **⚙ Account** modal appears. Put your phone (`+491701234567`) and
   PIN.
2. On save, it fires a `/update`. With no cookies, TR pushes a 4-digit
   code to your TR mobile app.
3. The **🔐 Trade Republic Security Code** modal opens. Type the code
   and press Update.
4. The backend downloads your portfolio, transactions and computes
   analytics. Takes 30 s – 2 min depending on the size of your history.

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Modal error "tr-api is not installed" | `trade_republic.python_bin` doesn't point at the right venv. Verify with `occ config:system:get trade_republic.python_bin`. |
| `playwright._impl._api_types.Error: Executable doesn't exist` | Missing `playwright install chromium`, or the cache isn't readable by `www-data`. See section 2. |
| `error while loading shared libraries: libatk-bridge-2.0.so.0` (or similar) | Missing `playwright install-deps chromium` (system libs). See section 2 step 2. |
| MFA modal reopens with "Wrong code" several times | The code expires in ~60 s. If it arrives late, wait for the next push (press Update again). |
| `rate_limited` | TR rate-limits login attempts. Wait 5–15 min. This app caches the latest `processId` for 5 min and reuses it, precisely to avoid burning attempts. |
| `auth_failed` | Wrong phone or PIN. Open **⚙ Account** and save them again. |
| Fetch takes > 2 min and times out | The PHP service timeout is 240 s. If your history is huge, use the "Full reload" checkbox in the MFA modal only when needed — incremental mode normally takes 5–15 s. |

## 6.5. Updating the app

From your laptop (**don't** `git pull` on the server — it skips the
three pillars deploy.sh manages):

```bash
cd ~/damkencloud/Claude/Trade-Republic-owncloud
./scripts/deploy.sh --bump patch
```

The script:
1. Runs `scripts/verify_dom_ids.py` (mandatory pre-deploy check —
   catches the class of bug where JS references a DOM id that no
   template defines, which throws `null.addEventListener` at runtime
   and aborts entire wire-up callbacks).
2. Bumps `<version>` in `appinfo/info.xml`.
3. rsyncs the app to `/var/www/owncloud/apps/trade_republic/`.
4. `chown www-data` + `occ upgrade` + `maintenance:mode --off`.
5. Reinstalls `tr-api` in `/opt/tr-venv`.
6. `occ app:enable trade_republic` regenerates the asset cache buster.

Flag variants:

```bash
./scripts/deploy.sh                # app + lib, no version bump
./scripts/deploy.sh --no-lib       # JS-only change, skip pip
./scripts/deploy.sh --lib --no-app # tr-api hot-fix only
```

## 6.6. Parity guarantees with upstream

This app is a **verbatim port of `Trade-Republic-Dashboard`**, with only
the divergences listed in
[`TR-GBM-Project/OWNCLOUD-PATCHES.md`](https://github.com/cdamken/TR-GBM-Project/blob/main/OWNCLOUD-PATCHES.md)
(9 documented transformations: data-route attrs, CSRF helper,
addEventListener via null-safe `on()`, ICrypto credentials, per-user
data dir, scoped CSS, .htaccess cache override, IIFE, tabs/spaces).
Any divergence outside that catalog is a bug.

`scripts/verify_dom_ids.py` protects against the most common class:
stale DOM-id references in JS after a template element was removed.
Run it manually any time:

```bash
python3 scripts/verify_dom_ids.py
```

## 7. Per-user data

After the first fetch, you'll see on disk:

```
{datadirectory}/<uid>/trade_republic/
├── profile/                         ← tr-api cookies + profile (0700)
│   └── .tr-api/profiles/<phone>/
├── portfolio.json                   ← consumed by the dashboard
├── portfolio_raw.json               ← raw TR payload (debug)
├── account_transactions.csv         ← timeline in CSV format
├── analytics.json                   ← cash flow / dividends / allocation
├── net_worth_history.json           ← daily snapshot
├── last_update.date
└── fetch.log                        ← stdout/stderr of the last run
```
