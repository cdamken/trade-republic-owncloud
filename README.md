# trade-republic-owncloud

App for **ownCloud 10** that gives each user their own **Trade Republic**
dashboard. Phone, PIN and downloaded data live isolated per user inside
ownCloud itself.

> ⚠️ **Unofficial.** Not affiliated with, endorsed by, or sponsored by
> Trade Republic Bank GmbH. Built by reverse-engineering their internal
> WebSocket (via [`tr-api`](https://github.com/cdamken/tr-api)). The
> endpoints can change without notice. Use at your own risk.

---

## What it does

- Shows up as another app in ownCloud's nav bar, next to Files, Calendar,
  etc.
- Each user:
  - Configures their TR **phone (E.164)** + **PIN** once from inside the
    app (modal **⚙ Account**). The PIN is encrypted before being stored.
  - Confirms the **4-digit code** TR pushes to their mobile app the first
    time (after that the session is reused while cookies live).
  - Downloads their portfolio (every position with current price, average
    cost, P/L), EUR cash, transactions (deposits, removals, buys, sells,
    dividends, interest) and analytics (monthly cash flow, lifetime P/L,
    rough allocation by category, net-worth history).
  - Renders a dark dashboard with summary, top movers, a searchable
    sortable positions table, and an analytics page with cash flow,
    dividends, allocation and history.
- **Per-user isolation guaranteed by construction** — see
  [ARCHITECTURE.md](ARCHITECTURE.md).

## Difference vs `Trade-Republic-Dashboard`

|                       | [Trade-Republic-Dashboard](https://github.com/cdamken/trade-republic-dashboard) | **trade-republic-owncloud (this repo)** |
|-----------------------|--------------------------------------------------------------------------|-----------------------------------------|
| Form                  | Local Python script + browser on localhost                               | Multi-user ownCloud app                 |
| Who runs it           | You on your Mac                                                          | Your ownCloud instance                  |
| Per-user data         | N/A (single user)                                                        | Yes, isolated in `{datadir}/<uid>/trade_republic/` |
| Credentials           | `~/.pytr/credentials` with `0600` in your home                           | ownCloud DB, PIN encrypted with `ICrypto` |
| Remote access         | No (localhost only)                                                      | Yes (via your ownCloud URL, with its login) |
| Auto-update           | Manual with `./dashboard.sh`                                             | ⟳ Update Now button in the header       |

If you only want it for yourself on your machine, use
`Trade-Republic-Dashboard`. If you want several ownCloud users to have it,
this is the repo.

> **The two installations are independent** — they don't share credentials,
> data or session. `Trade-Republic-Dashboard` is upstream/base; this port
> documents every divergence in [UPSTREAM.md](UPSTREAM.md).

## Difference vs `gbm-owncloud`

This app is the Trade Republic equivalent of
[`gbm-owncloud`](https://github.com/cdamken/gbm-owncloud) (GBM Mexico).
Same architecture (PageController + ApiController + Service + Python
wrapper), same exit codes mapped to HTTP, same per-user isolation
guarantees. What changes:

- **Credentials**: phone + PIN, not email + password.
- **2FA**: **4-digit push** TR sends to your mobile app, not 6-digit TOTP.
- **Backend lib**: [`tr-api`](https://github.com/cdamken/tr-api), not
  [`gbm-mx-api`](https://github.com/cdamken/gbm-mx-api).
- **Data**: portfolio + transactions + analytics, not positions per
  account + orders.

## Dependencies

- **ownCloud 10.x**.
- **Python 3.10+** on the server.
- **[`tr-api`](https://github.com/cdamken/tr-api)** installed in that
  Python (a dedicated venv works great). Needs the `[browser]` extra for
  Playwright (TR puts a Cloudflare WAF in front of the initial login).

See [INSTALL.md](INSTALL.md) for the exact steps.

## Short install

```bash
# 1. Venv with the Python lib
sudo python3 -m venv /opt/tr-venv
sudo /opt/tr-venv/bin/pip install "tr-api[browser] @ git+https://github.com/cdamken/tr-api.git"
sudo PLAYWRIGHT_BROWSERS_PATH=/var/cache/tr-playwright /opt/tr-venv/bin/playwright install chromium
sudo /opt/tr-venv/bin/playwright install-deps chromium

# 2. Clone the app into ownCloud's apps directory
cd /var/www/owncloud/apps
sudo -u www-data git clone https://github.com/cdamken/trade-republic-owncloud.git trade_republic

# 3. Enable and point at the venv
sudo -u www-data php /var/www/owncloud/occ app:enable trade_republic
sudo -u www-data php /var/www/owncloud/occ config:system:set trade_republic.python_bin --value=/opt/tr-venv/bin/python
```

Done — each user opens `https://your-owncloud/index.php/apps/trade_republic/`,
puts their phone + PIN in the modal, enters the 4-digit code TR pushes to
their phone, and they're in.

## Usage

1. **First time** — opening the app shows the **⚙ Account** modal asking
   for phone (format `+491701234567`) and PIN.
2. **On save** — triggers a sync. With no cookies yet, TR pushes a
   **4-digit code** to your phone and the **🔐 Trade Republic Security
   Code** modal opens.
3. **Type the code** — login completes, cookies are stored, portfolio is
   downloaded, transactions fetched and analytics computed. The dashboard
   appears.
4. **Update** — the **⟳ Update Now** button refreshes the data. If cookies
   are still alive it doesn't ask for a code; if TR invalidated them, the
   MFA modal opens again.
5. **Change credentials** — the **⚙ Account** button reopens the modal.
6. **Erase account** — inside the **⚙ Account** modal there's an **Erase
   account** button (type `delete` to confirm). It wipes phone, PIN,
   cookies and every downloaded file.

## Configuration

System config values (`occ config:system:set ...`):

| Key                                          | Default                 | What it does |
|----------------------------------------------|-------------------------|--------------|
| `trade_republic.python_bin`                  | `python3`               | Path to the Python that has `tr-api` installed. |
| `trade_republic.playwright_browsers_path`    | `/var/cache/tr-playwright` | Shared Playwright/Chromium cache. Avoids each user re-downloading ~150 MB. |

```bash
sudo -u www-data php occ config:system:set trade_republic.python_bin --value=/opt/tr-venv/bin/python
```

## Where each thing lives

| Datum | Location |
|---|---|
| Phone (per user) | ownCloud DB (`oc_preferences`) |
| PIN (per user, **encrypted**) | ownCloud DB (`oc_preferences`), encrypted with `ICrypto` |
| TR session cookies | Filesystem: `{datadir}/<uid>/trade_republic/profile/.tr-api/...` (`0700`) |
| Portfolio / transactions / analytics | Filesystem: `{datadir}/<uid>/trade_republic/*.{json,csv}` |
| Pending login (between push & submit) | Filesystem: `{datadir}/<uid>/trade_republic/.pending_login.json` (`0600`, TTL 5 min) |
| `fetch.log` of last run | Filesystem: `{datadir}/<uid>/trade_republic/fetch.log` |
| `trade_republic.python_bin` | ownCloud's `config.php` |

Full detail and rationale in [ARCHITECTURE.md](ARCHITECTURE.md).

## Uninstall (clean)

```bash
sudo -u www-data php occ app:disable trade_republic
# for each user that used it:
sudo -u www-data php occ user:setting <uid> trade_republic --delete
sudo rm -rf {datadir}/<uid>/trade_republic/
```

## Status

Alpha. Structurally parallel to `gbm-owncloud` (which has been running in
my home-lab production). If you try it and something breaks, open an
[issue](https://github.com/cdamken/trade-republic-owncloud/issues).

## License

[Business Source License 1.1](LICENSE) — aligned with `tr-api` and
`Trade-Republic-Dashboard`. Converts to Apache 2.0 after 4 years. If you
want to use it in commercial production before then, ping me.

## Credits

- Trade Republic API → [`tr-api`](https://github.com/cdamken/tr-api).
- Original dashboard (local version) → [`Trade-Republic-Dashboard`](https://github.com/cdamken/trade-republic-dashboard).
- ownCloud app (this repo) → Carlos Damken.
- Structural inspiration → [`gbm-owncloud`](https://github.com/cdamken/gbm-owncloud) and ownCloud's `pong` / `drawio` apps.
