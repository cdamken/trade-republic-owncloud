#!/usr/bin/env bash
# =============================================================================
# deploy.sh — sync Trade-Republic-owncloud + tr-api to cloud.damken.com
#
# Three moving parts that must stay in lockstep:
#
#   1. THE APP   →  /var/www/owncloud/apps/trade_republic/
#                   (PHP controllers, JS, CSS, templates, python wrapper)
#
#   2. THE LIB   →  /opt/tr-venv/   (Python venv with tr-api installed)
#                   The local Dashboard has tr-api as `pip install -e ../tr-api`
#                   so it always picks up changes. The server has a STATIC
#                   install that stays frozen at install time. If you add a
#                   new module to tr-api (e.g. accounts.py, documents.py) and
#                   only deploy the app, fetch_wrapper.py crashes with
#                   `ImportError: cannot import name 'accounts'`.
#
#   3. CACHE     →  ownCloud appends `?v=<hash>` to script URLs and that hash
#                   is derived from <version> in appinfo/info.xml. If you
#                   change JS/CSS but don't bump the version, the browser
#                   sees the "same URL" and serves the cached old file. Users
#                   never see your fix. Use `--bump` to bump + re-enable.
#
# Usage:
#   ./scripts/deploy.sh                       # app + lib, no version bump
#   ./scripts/deploy.sh --bump patch          # also bump 0.1.x → 0.1.(x+1)
#   ./scripts/deploy.sh --no-lib              # JS-only change, skip pip
#   ./scripts/deploy.sh --lib --no-app        # tr-api hot-fix only
#
# =============================================================================

set -euo pipefail

# ---------- paths / hosts (edit if the deploy topology moves) ----------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TR_API_REPO="${HOME}/damkencloud/Claude/tr-api"
LOCAL_OC_APPS="${HOME}/damkencloud/oc_Apps/trade_republic"

SERVER_HOST="carlos@cloud.damken.com"
SERVER_PORT="2222"
SERVER_KEY="${HOME}/.ssh/id_ed25519"

SERVER_APP_DIR="/var/www/owncloud/apps/trade_republic"
SERVER_TR_API_SRC="/opt/tr-api-src"
SERVER_VENV="/opt/tr-venv"
SERVER_OCC="/var/www/owncloud/occ"

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

Sync Trade-Republic-owncloud + tr-api to cloud.damken.com.

Options:
  --app / --no-app         Deploy the app (default: yes)
  --lib / --no-lib         Reinstall tr-api in /opt/tr-venv (default: yes)
  --bump LEVEL             Bump <version> in appinfo/info.xml before deploy.
                           LEVEL = patch | minor | major
                           (no default — bump is opt-in)
  --skip-verify            Skip scripts/verify_dom_ids.py pre-deploy check.
                           Don't use this — the check exists because one
                           null DOM reference can abort an entire JS
                           wire-up callback (see 2026-06-05 incident).
  -h, --help               Show this help

When to bump:
  - JS or CSS changed         → --bump patch    (cache must invalidate)
  - PHP/template only         → --bump patch    (still good hygiene)
  - New feature shipped       → --bump minor
  - Breaking change           → --bump major
  - Pure tr-api lib update    → (skip bump, JS doesn't change)

The smoke test at the end will import every module fetch_wrapper.py
depends on. If any are missing the script exits non-zero so CI / your
shell prompt can show it.
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
if [[ $DO_LIB -eq 1 ]] && [[ ! -d "$TR_API_REPO" ]]; then
  die "tr-api repo not found at $TR_API_REPO (set TR_API_REPO env or use --no-lib)"
fi
[[ -f "$SERVER_KEY" ]] || die "SSH key not found at $SERVER_KEY"

# ---------- step 0: pre-deploy checks ----------
if [[ $DO_APP -eq 1 ]] && [[ $SKIP_VERIFY -eq 0 ]]; then
  say "Pre-deploy: verify DOM-ID sync (scripts/verify_dom_ids.py)"
  if ! python3 "${REPO_ROOT}/scripts/verify_dom_ids.py"; then
    die "DOM-ID check failed. Fix the missing IDs or pass --skip-verify (not recommended)."
  fi

  say "Pre-deploy: verify JS wiring (scripts/verify_wiring.py)"
  if ! python3 "${REPO_ROOT}/scripts/verify_wiring.py"; then
    die "JS wiring check failed. Fix the stranded refs or pass --skip-verify."
  fi

  say "Pre-deploy: unit tests (python3 -m unittest)"
  if ! (cd "${REPO_ROOT}" && python3 -m unittest discover -s tests >/dev/null 2>&1); then
    die "Tests failed. Run 'python3 -m unittest discover -s tests -v' to see details."
  fi
  ok "All pre-deploy checks green"
fi

# ---------- step 1: optional version bump ----------
if [[ -n "$DO_BUMP" ]]; then
  case "$DO_BUMP" in patch|minor|major) ;; *)
    die "--bump must be one of: patch, minor, major (got: $DO_BUMP)" ;;
  esac
  say "Bumping app version ($DO_BUMP) in appinfo/info.xml"
  cur=$(grep -oE '<version>[^<]+</version>' "$REPO_ROOT/appinfo/info.xml" | sed 's/<[^>]*>//g')
  [[ -n "$cur" ]] || die "Could not read current version from appinfo/info.xml"
  IFS=. read -r maj min pat <<< "$cur"
  case "$DO_BUMP" in
    patch) pat=$((pat + 1)) ;;
    minor) min=$((min + 1)); pat=0 ;;
    major) maj=$((maj + 1)); min=0; pat=0 ;;
  esac
  new="${maj}.${min}.${pat}"
  # macOS sed needs -i '' ; GNU sed accepts -i.bak. Use a tempfile to stay portable.
  tmp=$(mktemp)
  sed "s|<version>${cur}</version>|<version>${new}</version>|" \
      "$REPO_ROOT/appinfo/info.xml" > "$tmp"
  mv "$tmp" "$REPO_ROOT/appinfo/info.xml"
  ok "Version: $cur → $new"
  warn "Don't forget to commit this version bump in git."
fi

# ---------- step 2: sync app → local oc_Apps + server ----------
if [[ $DO_APP -eq 1 ]]; then
  say "Syncing app source → local oc_Apps copy ($LOCAL_OC_APPS)"
  mkdir -p "$LOCAL_OC_APPS"
  rsync -a --delete \
        --exclude='__pycache__/' --exclude='*.pyc' \
        --exclude='.git/' --exclude='.DS_Store' --exclude='.scrapped/' \
        "$REPO_ROOT/" "$LOCAL_OC_APPS/"
  ok "Local copy in sync"

  say "Syncing app → server (${SERVER_APP_DIR})"
  rsync -a -e "$RSYNC_SSH" \
        --exclude='__pycache__/' --exclude='*.pyc' --exclude='.git/' \
        --rsync-path="sudo rsync" \
        "$REPO_ROOT/" "${SERVER_HOST}:${SERVER_APP_DIR}/"
  ok "Server app in sync"

  say "chown app dir → www-data"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "sudo chown -R www-data:www-data ${SERVER_APP_DIR}"
  ok "Ownership set"
fi

# ---------- step 3: sync tr-api repo + reinstall in venv ----------
if [[ $DO_LIB -eq 1 ]]; then
  say "Syncing tr-api repo → server (${SERVER_TR_API_SRC})"
  rsync -a -e "$RSYNC_SSH" \
        --exclude='.git/' --exclude='__pycache__/' --exclude='*.pyc' \
        --exclude='.venv/' --exclude='dist/' --exclude='build/' \
        --exclude='*.egg-info/' --exclude='.DS_Store' \
        --rsync-path="sudo rsync" \
        "${TR_API_REPO}/" "${SERVER_HOST}:${SERVER_TR_API_SRC}/"
  ok "tr-api source in sync"

  say "Reinstalling tr-api in ${SERVER_VENV}"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    sudo chown -R root:root ${SERVER_TR_API_SRC}
    sudo ${SERVER_VENV}/bin/pip install --upgrade --force-reinstall ${SERVER_TR_API_SRC}/ 2>&1 | tail -3
  "
  ok "tr-api reinstalled"

  say "Smoke-test: import every module fetch_wrapper.py depends on"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    ${SERVER_VENV}/bin/python - <<'PY'
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
# Also check the bits fetch_wrapper.py specifically touches
from tr_api import accounts
assert hasattr(accounts, 'account_pairs'), 'accounts.account_pairs missing'
print('OK — all', len(required), 'modules importable, account_pairs present')
PY
  "
  ok "All tr-api modules importable on server"
fi

# ---------- step 4: cache invalidation (ownCloud regenerates ?v= hash) ----------
if [[ $DO_APP -eq 1 ]] || [[ -n "$DO_BUMP" ]]; then
  say "Invalidating ownCloud asset cache (occ app:enable trade_republic)"
  ssh "${SSH_OPTS[@]}" "$SERVER_HOST" \
    "sudo -u www-data php ${SERVER_OCC} app:enable trade_republic" | tail -3
  ok "App re-enabled"

  say "Reading version reported by occ"
  srv_ver=$(ssh "${SSH_OPTS[@]}" "$SERVER_HOST" "
    sudo -u www-data php ${SERVER_OCC} app:list 2>/dev/null \
      | awk '/^  - trade_republic:/{found=1} found && /Version:/{print \$NF; exit}'
  ")
  ok "App version on server: ${srv_ver}"
  echo
  echo "  Browsers cache /apps/trade_republic/js/dashboard.js?v=<hash>."
  echo "  The hash is derived from this version, so a bump regenerates it."
  echo "  If you DIDN'T bump (--bump) but JS/CSS changed, hard-refresh:"
  echo "    Cmd+Shift+R (macOS) / Ctrl+Shift+R (Linux/Windows)"
fi

echo
ok "Deploy complete."
