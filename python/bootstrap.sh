#!/usr/bin/env bash
#
# bootstrap.sh — build this app's self-contained Python runtime, in place.
#
# The app carries everything it needs inside its own folder:
#   python/lib-src/          vendored source of tr-api (not on PyPI)
#   python/requirements.lock pinned PyPI deps (incl. playwright)
#   python/.venv/            the runtime (BUILD ARTIFACT — never copied)
#   python/.playwright/      Chromium for the login WAF challenge
#                            (BUILD ARTIFACT — fetched per host, never copied)
#
# Migrate or copy the app = copy the folder, then run this on the target
# host with a compatible python3 (>=3.10). Nothing is installed in /opt and
# nothing is left in /var/cache; Chromium lands inside the app folder.
#
# Idempotent: rebuilds .venv + .playwright from scratch each run.
#
# Usage:
#   python/bootstrap.sh            # uses python3 from PATH
#   PYTHON=python3.14 python/bootstrap.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PYTHON="${PYTHON:-python3}"

echo "▸ building .venv with $("$PYTHON" --version 2>&1)"
rm -rf .venv
"$PYTHON" -m venv .venv
.venv/bin/pip install -q --upgrade pip

echo "▸ installing pinned deps (requirements.lock, incl. playwright)"
.venv/bin/pip install -q -r requirements.lock

echo "▸ installing vendored lib (lib-src, no deps)"
.venv/bin/pip install -q --no-deps ./lib-src

echo "▸ installing Chromium into app-folder .playwright (this downloads ~600M)"
rm -rf .playwright
export PLAYWRIGHT_BROWSERS_PATH="$HERE/.playwright"
.venv/bin/playwright install chromium
# HOST PREREQUISITE (needs root, not run here): Chromium needs ~25 system
# libraries (Mesa/Vulkan/ALSA/fonts/xcb). Install them once per host with:
#   sudo .venv/bin/playwright install-deps chromium
# Like the Python interpreter, these are platform packages, not vendored
# per-app. Without them the browser binary exists but exits 127 on launch.

echo "▸ smoke test"
PLAYWRIGHT_BROWSERS_PATH="$HERE/.playwright" .venv/bin/python -c "import tr_api, playwright, requests, websockets; from importlib.metadata import version; print('bootstrap OK — tr_api', getattr(tr_api, '__version__', version('tr-api')), '· playwright', version('playwright'))"
