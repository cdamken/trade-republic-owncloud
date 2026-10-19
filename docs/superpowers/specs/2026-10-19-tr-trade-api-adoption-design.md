# Adopting tr-trade-api in Trade-Republic-owncloud

**Date:** 2026-10-19
**Status:** design — awaiting Carlos's go. Nothing built yet.
**Source lib:** git@github.com:cdamken/tr-trade-api.git, main @ 32a623c
(no semver tags). Facts below verified by the tr-trade-api execution session
(Yakko) against code + real keepalive logs, not from memory.

## Intent / why

Replace tr-api with tr-trade-api in this app to gain three things:

1. **~24h sessions instead of frequent re-auth.** Measured across 4 real
   login cycles on snoopy5 (04.09, 21.09, 22.09, 08.10): each session lived
   22h12 to 23h56 before needing a new phone push. Carlos only re-approves
   roughly once a day instead of often.
2. **Savings + buy/sell capability** from the ownCloud page (savings
   change/cancel is battle-tested; see safety scope below).
3. **Drops Playwright/Chromium entirely.** tr-trade-api bundles its own WS
   transport and logs in with requests + cookies (web_login_v2 push), no
   browser. Adopting it removes the 681M Chromium and the host
   `playwright install-deps` prerequisite from the s6 TR restructure.

## How the 24h actually works (so the design is grounded)

- `tr_session` (the JWT that authenticates each request) lives **5 minutes**,
  fixed by TR's backend.
- `tr_refresh` (a separate, longer cookie) lives **~24h**, also set by TR's
  backend. It rotates a fresh `tr_session` without a new push.
- Reaching the full 24h needs a **keepalive daemon** calling
  `refresh_session()` every ~4 min (`scripts/session_keepalive.py`, 240s) so
  `tr_session` never lapses between requests. tr-trade-api ships this daemon;
  tr-api has the `refresh_session()` function but no daemon, which is why the
  app re-authenticates often today.
- Silent refresh (no push) runs every 4 min against
  `/api/v1/auth/web/session`. The phone push returns only when `tr_refresh`
  itself expires (~23h).

## Scope / goals

- Adopt tr-trade-api as the app's Python lib (read features + savings).
- Run the keepalive daemon on the server so the app inherits the 24h behavior.
- **Live trading (real-money buy/sell) stays OFF** in the app until Carlos
  authorizes each operation. Default is dry-run behind the safety gate.

## Non-goals / anti-goals

- Not enabling unattended real-money orders. buy/sell (`simpleCreateOrder`)
  has **never fired live**, only dry-run (verified by Yakko); only savings
  change/cancel has a real execution history.
- Not shipping without a function-by-function compatibility check vs what
  this app consumes. tr-trade-api is a superset of tr-api (it absorbed the
  read modules and dropped the tr-api dependency), but drop-in is **not
  verified** yet.
- Failure = any flow that works today (login v2 push, snapshot_full,
  timeline/transactions, revoke, docs) breaks, or a real order fires without
  explicit per-operation authorization.

## Work required

1. **Compatibility check.** Diff the public surface tr-trade-api exposes
   against every call `python/fetch_wrapper.py` + `TrService` make today
   (login v2, snapshot_full, both timeline topics on one WS, revoke, docs
   download). Confirm signatures/return shapes or write a thin adapter.
2. **Cookie profile migration.** tr-trade-api stores cookies under
   `~/.tr-trade-api/profiles/<phone>/`, not `~/.tr-api/`. The app
   HOME-redirects to a per-user profile dir, so either run the provided
   `tr_login.py --migrate-from-tr-api` per user or require a fresh login per
   user at cutover. Decide and script it.
3. **Keepalive daemon on the server.** Run `session_keepalive.py` (240s) so
   sessions reach 24h. In this multi-user app each user has their own
   session, so the daemon must iterate active users' profile dirs (or one
   service per configured user). Design this as a systemd service on s6. It
   is not self-healing: if it dies (a bug, a server change) a manual
   interactive login is needed, so it needs monitoring/alerting. Without the
   daemon the app behaves like today (5-min lapses).
4. **Safety gate.** tr-trade-api's `SafetyPolicy` requires env
   `TR_TRADE_LIVE=I-UNDERSTAND-REAL-MONEY`, a per-order deterministic
   `confirm_token`, and a max-order ceiling. **Resolve the discrepancy
   first:** the code default is `DEFAULT_MAX_ORDER_EUR = 50.0` but the repo's
   CLAUDE.md says 500. Pin the real number before trusting it. The app keeps
   live trading disabled regardless until per-operation sign-off.
5. **Self-contained stack update.** Swap `lib-src` from tr-api to
   tr-trade-api, regenerate `requirements.lock` (drops playwright: websockets,
   certifi, requests; pycookiecheat optional). Remove the `.playwright`
   download from `bootstrap.sh` and drop the host `install-deps` step. This
   simplifies the s6 restructure already shipped.

## Rollout order

1. Compatibility check + adapter (read path only), on s6, no trading.
2. Keepalive daemon + 24h validation on s6.
3. Savings (change/cancel) behind the gate, dry-run, then a single
   Carlos-authorized live savings change as acceptance.
4. buy/sell left dry-run only until Carlos decides to exercise it live,
   per operation.

## Left to the builder

- systemd unit shape for the keepalive daemon (per-user iteration vs
  per-user unit) — builder's call, must cover every configured user and
  alert on death.
- Adapter vs direct swap for the read surface — decided by the compat check.
