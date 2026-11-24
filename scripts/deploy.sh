#!/usr/bin/env bash
# =============================================================================
# deploy.sh — sync Trade-Republic-owncloud + tr-api to cloud.damken.com (s6)
#
# Self-contained Python stack (s6 reality, confirmed 2026-11-24):
#   - NO /opt/tr-venv and NO /opt/tr-api-src anymore. The runtime venv lives
#     INSIDE the app: apps/trade_republic/python/.venv (built by
#     python/bootstrap.sh). Chromium lands in python/.playwright/.
#   - tr-api (not on PyPI) is vendored into apps/.../python/lib-src and
#     installed into that venv with `pip install --no-deps ./lib-src`.
#
# Three moving parts that must stay in lockstep:
#
#   1. THE APP   →  /var/www/owncloud/apps/trade_republic/
#                   (PHP controllers, JS, CSS, templates, python/ wrapper)
#                   The server rsync is INTENTIONALLY without --delete so it
#                   never wipes the server-built python/.venv + python/.playwright
#                   + python/lib-src.
#
#   2. THE LIB   →  apps/.../python/lib-src  +  reinstall into python/.venv
#                   tr-api source is rsynced into lib-src (scoped --delete, so
#                   stale/sensitive trees are removed) EXCLUDING discovery/,
#                   .github/, build/, dist/, tests/, docs/, examples/, *.har,
#                   *.md — none are needed to `pip install` the package.
#
#   3. CACHE     →  ownCloud appends ?v=<hash> to asset URLs, derived from
#                   <version> in appinfo/info.xml. Bump + occ app:enable to
#                   drop stale cached JS/CSS. The .htaccess forces no-cache too.
#
# Pre-deploy gates (verify_dom_ids.py + verify_wiring.py + unittest) are
# mandatory; bypass only to debug the verifier itself (--skip-verify).
#
# Usage:
#   ./scripts/deploy.sh                       # app + lib, no version bump
#   ./scripts/deploy.sh --bump patch          # also bump 0.1.x → 0.1.(x+1)
#   ./scripts/deploy.sh --no-lib              # app-only (PHP/JS/CSS/template)
#   ./scripts/deploy.sh --lib --no-app        # tr-api hot-fix only
#   ./scripts/deploy.sh --skip-verify         # skip pre-deploy gates (DON'T)
# =============================================================================

set -euo pipefail

# ---------- paths / hosts (edit if the deploy topology moves) ----------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="trade_republic"
TR_API_REPO="${TR_API_REPO:-${HOME}/damkencloud/Claude/tr-api}"
LOCAL_OC_APPS="${LOCAL_OC_APPS:-${HOME}/damkencloud/oc_Apps/${APP_ID}}"

# s6 = cloud.damken.com:2222 (the live server since 2026-11-13). snoopy5 is
# FROZEN — never deploy there. See Trade-Republic-owncloud/CLAUDE.md.
SERVER_HOST="${SERVER_HOST:-carlos@cloud.damken.com}"
SERVER_PORT="${SERVER_PORT:-2222}"
SERVER_KEY="${SERVER_KEY:-${HOME}/.ssh/id_ed25519}"

SERVER_APP_DIR="/var/www/owncloud/apps/${APP_ID}"
SERVER_PY_DIR="${SERVER_APP_DIR}/python"
SERVER_LIB_SRC="${SERVER_PY_DIR}/lib-src"
SERVER_VENV="${SERVER_PY_DIR}/.venv"
SERVER_OCC="/var/www/owncloud/occ"
SERVER_PYTHON="${SERVER_PYTHON:-python3.14}"

SSH_OPTS=(-A -i "${SERVER_KEY}" -p "${SERVER_PORT}")
RSYNC_SSH="ssh -A -i ${SERVER_KEY} -p ${SERVER_PORT}"

# ---------- flags ----------
DO_APP=1
DO_LIB=1
DO_BUMP=""
SKIP_VERIFY=0

usage() {
  cat <<EOF
Usage: ${0##*/} [options]

Sync Trade-Republic-owncloud + tr-api to cloud.damken.com (s6).

Options:
  --app / --no-app         Deploy the app (default: yes)
  --lib / --no-lib         Vendor tr-api into python/lib-src + reinstall into
                           the app-internal venv (default: yes)
  --bump LEVEL             Bump <version> in appinfo/info.xml (patch|minor|major)
  --skip-verify            Skip the pre-deploy gates (debugging only)
  -h, --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)         DO_APP=1; shift ;;
    --no-app)      DO_APP=0; shift ;;
    --lib)         DO_LIB=1; shift ;;
    --no-lib)      DO_LIB=0; shift ;;
    --bump)        DO_BUMP="${2:-}"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             echo "Unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ---------- pretty output ----------
say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m! %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- pre-flight ----------
[[ -d "$REPO_ROOT/.git" ]] || die "REPO_ROOT does not look like a git repo: $REPO_ROOT"
[[ -f "$REPO_ROOT/appinfo/info.xml" ]] || die "appinfo/info.xml not found"
[[ -f "$SERVER_KEY" ]] || die "SSH key not found at $SERVER_KEY"
if [[ $DO_LIB -eq 1 ]] && [[ ! -d "$TR_API_REPO" ]]; then
  die "tr-api repo not found at $TR_API_REPO (set TR_API_REPO env or use --no-lib)"
fi

# ---------- step 0: pre-deploy gates ----------
if [[ $DO_APP -eq 1 ]] && [[ $SKIP_VERIFY -eq 0 ]]; then
  say "Pre-deploy: verify DOM-ID sync (scripts/verify_dom_ids.py)"
  python3 "${REPO_ROOT}/scripts/verify_dom_ids.py" || die "DOM-ID check failed."
  say "Pre-deploy: verify JS wiring (scripts/verify_wiring.py)"
  python3 "${REPO_ROOT}/scripts/verify_wiring.py" || die "JS wiring check failed."
  if [[ -d "${REPO_ROOT}/tests" ]]; then
    say "Pre-deploy: unit tests (python3 -m unittest)"
    (cd "${REPO_ROOT}" && python3 -m unittest discover -s tests >/dev/null 2>&1) \
      || die "Tests failed. Run 'python3 -m unittest discover -s tests -v'."
  fi
  ok "All pre-deploy checks green"
fi

# ---------- step 1: optional version bump ----------
if [[ -n "$DO_BUMP" ]]; then
  case "$DO_BUMP" in patch|minor|major) ;; *)
    die "--bump must be one of: patch, minor, major (got: $DO_BUMP)" ;;
  esac
  say "Bumping app version ($DO_BUMP) in appinfo/info.xml"
  cur=$(grep -oE '<version>[^<]+</version>' "$REPO_ROOT/appinfo/info.xml" | head -1 | sed 's/<[^>]*>//g')
  [[ -n "$cur" ]] || die "Could not read current version from appinfo/info.xml"
  IFS=. read -r maj min pat <<< "$cur"
  case "$DO_BUMP" in
    patch) pat=$((pat + 1)) ;;
    minor) min=$((min + 1)); pat=0 ;;
    major) maj=$((maj + 1)); min=0; pat=0 ;;
  esac
  new="${maj}.${min}.${pat}"
  tmp=$(mktemp)
  sed "s|<version>${cur}</version>|<version>${new}</version>|" "$REPO_ROOT/appinfo/info.xml" > "$tmp"
  mv "$tmp" "$REPO_ROOT/appinfo/info.xml"
  ok "Version: $cur → $new"
  warn "Don't forget to commit this version bump in git."
fi

# ---------- step 2: sync app → local oc_Apps + server ----------
# The server rsync has NO --delete and EXCLUDES python/.venv + python/.playwright
# + python/lib-src, so it never clobbers the server-built runtime. The lib-src
# tree is managed exclusively by step 3.
if [[ $DO_APP -eq 1 ]]; then
  say "Syncing app source → local oc_Apps copy ($LOCAL_OC_APPS)"
  mkdir -p "$LOCAL_OC_APPS"
  rsync -a --delete \
        --exclude='.git/' --exclude='.gitignore' --exclude='.DS_Store' \
        --exclude='__pycache__/' --exclude='*.pyc' \
        --exclude='node_modules/' --exclude='/vendor/' \
        --exclude='.scrapped/' \
        --exclude='python/.venv/' --exclude='python/.playwright/' --exclude='python/lib-src/' \
        "$REPO_ROOT/" "$LOCAL_OC_APPS/"
  ok "Local copy in sync"

  say "Syncing app → server (${SERVER_APP_DIR}) [no --delete]"
  # openrsync (macOS) supports neither --chown nor GNU-style --chmod (D/F
  # prefixes), so on that sender we pass no perm flags and let sudo rsync write
  # as root; the server-side chown -R below fixes ownership before occ upgrade.
  CHOWN_FLAGS=()
  if ! rsync --version 2>&1 | grep -qi 'openrsync'; then
    CHOWN_FLAGS=(--chown=www-data:www-data --chmod=D750,F640)
  fi
  rsync -a -e "$RSYNC_SSH" --rsync-path="sudo rsync" \
        ${CHOWN_FLAGS[@]+"${CHOWN_FLAGS[@]}"} \
        --exclude='.git/' --exclude='__pycache__/' --exclude='*.pyc' \
        --exclude='python/.venv/' --exclude='python/.playwright/' --exclude='python/lib-src/' \
        "$LOCAL_OC_APPS/" "${SERVER_HOST}:${SERVER_APP_DIR}/"
  ok "Server app in sync"

  say "Fix owner + occ upgrade + maintenance:mode --off (together; bumping <version> locks the server)"
  # chown first (idempotent when --chown already ran; essential on the openrsync
  # path where sudo rsync wrote files as root). Then upgrade. chown -R changes
  # ownership only, never mode bits, so Playwright's node +x survives it.
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    sudo chown -R www-data:www-data ${SERVER_APP_DIR}
    sudo -u www-data php ${SERVER_OCC} upgrade 2>&1 | tail -3 || true
    sudo -u www-data php ${SERVER_OCC} maintenance:mode --off 2>&1 | tail -1 || true
  "
  ok "ownCloud upgrade done"
fi

# ---------- step 3: vendor tr-api into lib-src + reinstall in app venv ----------
# Scoped --delete on lib-src removes any stale/sensitive tree already on the
# server. The excludes below mean only what `pip install` needs is shipped.
if [[ $DO_LIB -eq 1 ]]; then
  say "Vendoring tr-api → server ${SERVER_LIB_SRC} (scoped --delete, secrets excluded)"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "sudo mkdir -p ${SERVER_LIB_SRC}"
  LIB_CHOWN_FLAGS=()
  if ! rsync --version 2>&1 | grep -qi 'openrsync'; then
    LIB_CHOWN_FLAGS=(--chown=www-data:www-data --chmod=D750,F640)
  fi
  rsync -a --delete -e "$RSYNC_SSH" --rsync-path="sudo rsync" \
        ${LIB_CHOWN_FLAGS[@]+"${LIB_CHOWN_FLAGS[@]}"} \
        --exclude='.git/' --exclude='.gitignore' --exclude='.DS_Store' \
        --exclude='__pycache__/' --exclude='*.pyc' \
        --exclude='.venv/' --exclude='venv/' \
        --exclude='build/' --exclude='dist/' --exclude='*.egg-info/' \
        --exclude='discovery/' --exclude='.github/' \
        --exclude='tests/' --exclude='docs/' --exclude='examples/' \
        --exclude='*.har' --exclude='*.md' \
        "$TR_API_REPO/" "${SERVER_HOST}:${SERVER_LIB_SRC}/"
  ok "tr-api source vendored (no discovery/.github/*.har)"

  # Invoke pip as `python -m pip` (never .venv/bin/pip): the s6 oc_permits-script
  # strips +x from the pip script, so calling it directly fails with "Permission
  # denied (os error 13)"; python (a symlink) keeps its +x. pipefail so a real
  # pip failure is not masked by the trailing `tail`.
  say "Reinstalling tr-api into app venv (or bootstrapping if venv missing)"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    set -eo pipefail
    sudo chown -R www-data:www-data ${SERVER_PY_DIR}
    if sudo test -x ${SERVER_VENV}/bin/python || sudo test -x ${SERVER_VENV}/bin/python3; then
      sudo -u www-data ${SERVER_VENV}/bin/python -m pip install --upgrade --force-reinstall --no-deps ${SERVER_LIB_SRC} 2>&1 | tail -3
    else
      cd ${SERVER_PY_DIR} && sudo -u www-data env PYTHON=${SERVER_PYTHON} ./bootstrap.sh 2>&1 | tail -6
    fi
  "
  ok "tr-api installed in app venv"

  # Playwright's node/driver binaries must stay executable. A --no-deps reinstall
  # of tr-api does not touch them, but a full bootstrap (venv missing) re-downloads
  # Chromium, and the s6 oc_permits-script blanket-chmods 0640. Re-grant 0750 to
  # the Playwright binaries so the WAF login challenge can launch Chromium.
  say "Restoring +x on Playwright node/driver binaries"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    sudo find ${SERVER_VENV} -path '*playwright/driver/node' -exec chmod 0750 {} + 2>/dev/null || true
    sudo find ${SERVER_PY_DIR}/.playwright -type f -name 'chrome*' -exec chmod 0750 {} + 2>/dev/null || true
  "
  ok "Playwright binaries executable"

  say "Smoke-test: import every module fetch_wrapper.py depends on (app venv)"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    sudo -u www-data ${SERVER_VENV}/bin/python - <<'PY'
import tr_api
required = [
    'account', 'accounts', 'activity_log', 'alarms', 'auth',
    'client', 'cookies', 'documents', 'portfolio', 'profiles',
    'protocol', 'savings_plans', 'timeline_detail', 'transactions',
    'waf', 'watchlist',
]
missing = [m for m in required if not hasattr(tr_api, m)]
if missing:
    print('MISSING modules:', missing)
    raise SystemExit(1)
from tr_api import accounts
assert hasattr(accounts, 'account_pairs'), 'accounts.account_pairs missing'
print('OK — all', len(required), 'modules importable, account_pairs present')
PY
  "
  ok "All tr-api modules importable on server"
fi

# ---------- step 4: cache invalidation ----------
if [[ $DO_APP -eq 1 ]] || [[ -n "$DO_BUMP" ]]; then
  say "Invalidating ownCloud asset cache (occ app:enable ${APP_ID})"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" \
    "sudo -u www-data php ${SERVER_OCC} app:enable ${APP_ID}" | tail -3
  ok "App re-enabled"

  say "Reading version reported by occ"
  srv_ver=$(ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    sudo -u www-data php ${SERVER_OCC} app:list 2>/dev/null \
      | awk '/^  - ${APP_ID}:/{found=1} found && /Version:/{print \$NF; exit}'
  ")
  ok "App version on server: ${srv_ver}"
fi

echo
ok "Deploy complete."
echo "   Open: https://cloud.damken.com/index.php/apps/${APP_ID}/"
