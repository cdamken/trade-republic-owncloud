#!/usr/bin/env python3
"""Keep the ownCloud Trade Republic session warm 24/7.

Problem this solves
-------------------
The fetch wrapper (``fetch_wrapper.py``) only runs when the user clicks
"Update Now" in the app. TR's server-side session idles out after ~5 min,
so between two manual refreshes the cookies go stale. The next click then
fails, and meanwhile the JSON files sit frozen on old data with nobody
warned. (This bit us during the S5->S6 migration.)

What this daemon does
---------------------
Exactly what ``tr-api auth refresh`` does, on a loop: every
``SESSION_REFRESH_INTERVAL_SEC`` (~290s, just under TR's idle window) it
GETs ``/api/v1/auth/web/session``, which rotates the session cookies and
keeps the refresh-token chain alive. This is the pytr keepalive trick.

It uses the SAME per-ownCloud-user profile the wrapper uses: we re-point
HOME at ``--profile-dir`` so ``tr_api`` finds ``profiles/<phone>/`` inside
it (identical to fetch_wrapper.py). It does NOT touch Yakko's
``~/.tr-trade-api/`` session — different profile, different cookies.

What it does NOT do
-------------------
It does not fetch portfolio/transactions and does not write any JSON. It
only keeps the session warm so the user's next "Update Now" always works.
Auto-refreshing the data on a schedule is a separate concern (a slow
systemd timer over fetch_wrapper.py), deliberately decoupled from this
290s loop so we don't hammer TR's data endpoints 12x/hour.

Hard limit (same as any TR keepalive)
-------------------------------------
When TR eventually invalidates the refresh-token chain it returns 401.
At that point only a fresh push-approval login (from the user's phone)
can revive the session; no daemon can avoid that. On 401 we exit 75 so
systemd stops retrying in a tight loop and the state is visible.

Exit codes
----------
  0   clean shutdown (SIGTERM/SIGINT)
  12  TR_PHONE missing
  70  could not import tr_api (venv/lib-src not installed)
  75  refresh-token chain dead (401) -> user must re-login from the app
"""
from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from pathlib import Path

EXIT_OK = 0
EXIT_NO_PHONE = 12
EXIT_NO_LIB = 70
EXIT_RELOGIN_NEEDED = 75

_stop = False


def _handle_stop(signum, _frame):
    global _stop
    _stop = True
    sys.stderr.write(f"keepalive: received signal {signum}, stopping.\n")
    sys.stderr.flush()


def _log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    sys.stderr.write(f"{ts} keepalive: {msg}\n")
    sys.stderr.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--profile-dir", required=True,
        help="Per-ownCloud-user profile dir (same value the wrapper gets).",
    )
    parser.add_argument(
        "--phone",
        help="TR phone (+49...). Falls back to the TR_PHONE env var.",
    )
    parser.add_argument(
        "--interval", type=int, default=0,
        help="Override the refresh interval in seconds (default: tr-api's "
             "SESSION_REFRESH_INTERVAL_SEC, ~290).",
    )
    args = parser.parse_args()

    phone = (args.phone or os.environ.get("TR_PHONE") or "").strip()
    if not phone or phone[0] != "+":
        sys.stderr.write("ERROR: phone missing/invalid (--phone or TR_PHONE).\n")
        return EXIT_NO_PHONE

    # Same trick as fetch_wrapper.py: re-point HOME so tr_api's
    # profiles/<phone>/ resolves inside the per-user profile dir.
    profile_dir = Path(args.profile_dir).expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(profile_dir, 0o700)
    except OSError:
        pass
    os.environ["HOME"] = str(profile_dir)

    try:
        from tr_api import auth, profiles
        from tr_api.auth import refresh_session, SESSION_REFRESH_INTERVAL_SEC
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"ERROR: cannot import tr_api ({e}). Is the venv built?\n")
        return EXIT_NO_LIB

    interval = args.interval if args.interval > 0 else SESSION_REFRESH_INTERVAL_SEC

    try:
        prof = profiles.load(phone)
    except Exception as e:  # noqa: BLE001  (ProfileNotFound etc.)
        sys.stderr.write(
            f"ERROR: no profile for {phone} ({e}). Do one 'Update Now' with "
            "push-approval first to seed the session.\n"
        )
        return EXIT_RELOGIN_NEEDED

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    _log(f"started for {phone}; interval={interval}s; HOME={profile_dir}")

    while not _stop:
        try:
            res = refresh_session(prof)
        except Exception as e:  # noqa: BLE001  (transient network/WAF)
            _log(f"transient error during refresh: {e}; will retry next cycle.")
            res = None

        if res is not None:
            if res.ok:
                changed = ",".join(res.cookies_changed) or "none"
                _log(f"ok (status={res.status_code}, rotated={changed})")
            elif res.status_code == 401:
                _log(
                    "401: refresh-token chain is dead. The session cannot be "
                    "revived without a fresh push-approval login from the TR "
                    "app. Stopping so this is visible."
                )
                return EXIT_RELOGIN_NEEDED
            else:
                _log(
                    f"refresh not ok (status={res.status_code}, "
                    f"error={res.error}); will retry next cycle."
                )

        # Sleep in short slices so SIGTERM is honored promptly.
        slept = 0
        while slept < interval and not _stop:
            step = min(5, interval - slept)
            time.sleep(step)
            slept += step

    _log("stopped cleanly.")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
