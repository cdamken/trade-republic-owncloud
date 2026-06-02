/* global OC */
/**
 * Shared "🔄 Update Now" flow — loaded on every page (Portfolio, Analytics,
 * Dividends, Settings, Glossary) so the button works in-place from anywhere
 * instead of bouncing the user to Portfolio first.
 *
 * Self-contained: on DOMContentLoaded it
 *   1) Reads `data-route-*` attrs from `#tr-app` (every page already exposes
 *      index/update; this module also needs `data-route-update`, which the
 *      analytics/dividends/glossary templates now inject too).
 *   2) Injects the MFA + toast + progress-bar HTML into the page if it's not
 *      already there (Portfolio's main.php carries the markup verbatim; the
 *      other pages get it via this injector to avoid duplicating PHP partials).
 *   3) Wires `#update-btn` (and `#docs-btn`, if present) to the same handlers
 *      that used to live only in dashboard.js — `updateData()` / `submitMfa()`
 *      / `postUpdate()` / etc.
 *
 * Portfolio's `js/dashboard.js` already has its own copy of these handlers
 * (verbatim port from upstream), so on Portfolio we DON'T run this module's
 * init — `dashboard.js` does it. We detect that by checking for an
 * `[data-update-flow-owner="page"]` attribute on `#tr-app`; main.php sets it.
 */
(function () {
'use strict';

// Exposed for diagnostic poking from devtools; tests rely on the page-level
// behaviour, not on internals being on `window`.
const NS = 'UpdateFlow';
if (window[NS] && window[NS].__loaded) return;

let routes = null;

// ============ Modal/toast/progress-bar HTML injection ============
const MODAL_HTML = (
  '<!-- injected by update_flow.js -->\n' +
  '<div id="progress-bar" class="progress-bar"></div>\n' +
  '<div id="toast" class="toast">\n' +
  '  <button id="toast-close-btn" class="t-close" aria-label="Close">×</button>\n' +
  '  <div class="t-title"><span class="spin"></span> <span id="toast-title">Updating information…</span></div>\n' +
  '  <div class="t-stage" id="toast-stage">Connecting…</div>\n' +
  '</div>\n' +
  '<div id="mfa-modal" class="modal-backdrop">\n' +
  '  <div class="modal">\n' +
  '    <h3>🔐 Trade Republic Security Code</h3>\n' +
  '    <p>Your session expired. Trade Republic needs to verify it\'s you.</p>\n' +
  '    <div class="hint">\n' +
  '      📱 <strong>Open the Trade Republic app</strong> on your phone — Trade Republic just pushed a 4-digit code.<br>\n' +
  '      ⏱ The code expires in ~60 seconds.\n' +
  '    </div>\n' +
  '    <input type="text" id="mfa-input" inputmode="numeric" pattern="[0-9]*" maxlength="4"\n' +
  '           autocomplete="one-time-code"\n' +
  '           data-lpignore="true" data-1p-ignore data-bwignore placeholder="0000">\n' +
  '    <div id="mfa-err" class="err-msg"></div>\n' +
  '    <label for="mfa-full-reload"\n' +
  '           style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;\n' +
  '                  background:rgba(255,255,255,0.03); border:1px solid var(--border);\n' +
  '                  border-radius:10px; padding:12px 14px; margin-top:14px; margin-bottom:6px;\n' +
  '                  font-size:13px; color:var(--muted); line-height:1.45;">\n' +
  '      <input type="checkbox" id="mfa-full-reload"\n' +
  '             style="margin-top:2px; width:18px; height:18px; accent-color:#3b82f6; flex-shrink:0;">\n' +
  '      <span>\n' +
  '        <strong style="color:var(--text);">↻ Full Reload</strong> — wipe the local cache\n' +
  '        (portfolio + transaction history) and re-download everything from Trade Republic.<br>\n' +
  '        <span style="opacity:.8;">Use this if the numbers look off. Takes ~1–3 min.\n' +
  '        Your login is kept; you only enter the code once.</span>\n' +
  '      </span>\n' +
  '    </label>\n' +
  '    <div class="modal-actions">\n' +
  '      <button id="mfa-cancel-btn" class="btn-cancel">Cancel</button>\n' +
  '      <button id="mfa-submit-btn" class="btn-submit">Submit</button>\n' +
  '    </div>\n' +
  '  </div>\n' +
  '</div>\n'
);

function injectModalsIfMissing() {
  if (document.getElementById('mfa-modal')) return;          // Portfolio already has it
  const root = document.getElementById('tr-app') || document.body;
  const holder = document.createElement('div');
  holder.id = 'update-flow-injected';
  holder.innerHTML = MODAL_HTML;
  // Append at the end of #tr-app so CSS scoped under `#tr-app .modal-backdrop`
  // still wins. (All modal/toast/progress-bar CSS is already scoped that way.)
  root.appendChild(holder);
}

// ============ Button helpers ============
const updateBtn = () => document.getElementById('update-btn');
function setUpdateBtn(loading, label) {
  const b = updateBtn();
  if (!b) return;
  b.disabled = loading;
  b.classList.toggle('loading', loading);
  const labelEl = b.querySelector('.label');
  if (labelEl) labelEl.textContent = label || 'Update Now';
  else b.textContent = '🔄 ' + (label || 'Update Now');
}

// Tiny inline status helper. Most pages don't have an #update-status element
// (only the legacy portfolio shape did), so this is best-effort — show via
// the toast for the others.
function showStatus(kind, msg) {
  // Re-use the toast as a non-blocking status surface.
  const t = document.getElementById('toast');
  if (t) {
    t.classList.remove('ok', 'err');
    if (kind) t.classList.add(kind);
    const title = document.getElementById('toast-title');
    const stage = document.getElementById('toast-stage');
    if (title) title.textContent = msg || '';
    if (stage) stage.textContent = '';
    t.classList.add('active');
    if (kind === 'ok') setTimeout(() => t.classList.remove('active'), 3000);
  }
}

// ============ Toast / progress bar ============
function showToast(stage, kind) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.classList.remove('ok', 'err');
  if (kind) t.classList.add(kind);
  const stageEl = document.getElementById('toast-stage');
  if (stageEl) stageEl.textContent = stage;
  t.classList.add('active');
}
function setToastTitle(title) {
  const el = document.getElementById('toast-title');
  if (el) el.textContent = title;
}
function hideToast() {
  const t = document.getElementById('toast');
  if (t) t.classList.remove('active');
}
function showProgressBar() {
  const b = document.getElementById('progress-bar');
  if (b) b.classList.add('active', 'indet');
}
function hideProgressBar() {
  const b = document.getElementById('progress-bar');
  if (b) b.classList.remove('active', 'indet');
}

const PROGRESS_STAGES_NORMAL = [
  { until: 5,   text: 'Connecting to Trade Republic…' },
  { until: 15,  text: 'Verifying session…' },
  { until: 45,  text: 'Downloading portfolio and prices…' },
  { until: 90,  text: 'Resolving names and instruments…' },
  { until: 150, text: 'Downloading recent transactions…' },
  { until: Infinity, text: 'Almost done…' },
];
const PROGRESS_STAGES_FULL = [
  { until: 5,   text: 'Connecting to Trade Republic…' },
  { until: 15,  text: 'Verifying session…' },
  { until: 45,  text: 'Downloading portfolio and prices…' },
  { until: 90,  text: 'Resolving names and instruments…' },
  { until: 240, text: 'Downloading the FULL transaction history…' },
  { until: Infinity, text: 'Almost done, thanks for the patience…' },
];
let _progressStartedAt = null;
let _progressTimer = null;

function showProgressOverlay(opts) {
  const stages = (opts && opts.full) ? PROGRESS_STAGES_FULL : PROGRESS_STAGES_NORMAL;
  setToastTitle((opts && opts.full) ? 'Updating all information…' : 'Updating information…');
  showToast(stages[0].text);
  showProgressBar();
  _progressStartedAt = Date.now();
  _progressTimer = setInterval(() => {
    const elapsed = (Date.now() - _progressStartedAt) / 1000;
    const stage = stages.find(s => elapsed < s.until) || stages[stages.length - 1];
    showToast(stage.text);
  }, 500);
}
function hideProgressOverlay() {
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  _progressStartedAt = null;
  hideProgressBar();
  hideToast();
}

// ============ Network ============
async function postUpdate(mfaCode, opts) {
  const body = {};
  if (mfaCode) body.mfa_code = mfaCode;
  if (opts && opts.full) body.full = true;
  const res = await fetch(routes.update, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
    body: JSON.stringify(body),
  });
  let payload = {};
  try { payload = await res.json(); } catch (e) { payload = {}; }
  return { http: res.status, state: payload.status, detail: payload.detail };
}

// ============ Main update flow ============
async function updateData() {
  setUpdateBtn(true, 'Updating…');
  let overlayShown = false;
  const overlayDelay = setTimeout(() => {
    showProgressOverlay({ full: false });
    overlayShown = true;
  }, 5500);
  const cleanupOverlay = () => {
    clearTimeout(overlayDelay);
    if (overlayShown) { hideProgressOverlay(); overlayShown = false; }
  };
  try {
    const r = await postUpdate(null);
    if (r.http === 200) {
      clearTimeout(overlayDelay);
      showStatus('ok', '✓ Updated — reloading');
      broadcastUpdateComplete();   // tell other tabs to refresh their chip
      setTimeout(() => location.reload(), 800);
      return;
    }
    cleanupOverlay();
    if (r.state === 'mfa_required') { openMfaModal(); return; }
    if (r.state === 'rate_limited') {
      showStatus('err', '⚠ Rate-limited by Trade Republic — wait 15–30 min and retry');
      return;
    }
    showStatus('err', '✗ ' + (r.detail || r.state || ('HTTP ' + r.http)));
  } catch (e) {
    cleanupOverlay();
    showStatus('err', '✗ Network error');
  } finally {
    setUpdateBtn(false);
  }
}

function openMfaModal() {
  const m = document.getElementById('mfa-modal');
  if (!m) return;
  m.classList.add('open');
  const errEl = document.getElementById('mfa-err');
  if (errEl) errEl.classList.remove('show');
  const inp = document.getElementById('mfa-input');
  if (inp) inp.value = '';
  const cb = document.getElementById('mfa-full-reload');
  if (cb) cb.checked = false;
  setTimeout(() => { if (inp) inp.focus(); }, 100);
  setUpdateBtn(false);
}
function closeMfaModal() {
  const m = document.getElementById('mfa-modal');
  if (m) m.classList.remove('open');
}

async function submitMfa() {
  const code = document.getElementById('mfa-input').value.trim();
  const errEl = document.getElementById('mfa-err');
  errEl.classList.remove('show');
  if (!/^\d{4}$/.test(code)) {
    errEl.textContent = 'The code must be exactly 4 digits.';
    errEl.classList.add('show');
    return;
  }
  const submitBtn = document.getElementById('mfa-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying…';
  const fullReload = !!document.getElementById('mfa-full-reload') &&
                     document.getElementById('mfa-full-reload').checked;
  setUpdateBtn(true, fullReload ? 'Re-downloading everything…' : 'Updating…');

  closeMfaModal();
  showProgressOverlay({ full: fullReload });

  try {
    const r = await postUpdate(code, { full: fullReload });
    if (r.http === 200) {
      showStatus('ok', '✓ Updated — reloading');
      broadcastUpdateComplete();   // tell other tabs to refresh their chip
      setTimeout(() => location.reload(), 800);
      return;
    }
    hideProgressOverlay();
    if (r.state === 'mfa_invalid' || r.state === 'mfa_required') {
      openMfaModal();
      errEl.textContent = 'Wrong code. Check and try again.';
      errEl.classList.add('show');
      document.getElementById('mfa-input').select();
    } else if (r.state === 'auth_failed') {
      openMfaModal();
      errEl.textContent = 'Invalid credentials. Reopen ⚙️ Account and save them again.';
      errEl.classList.add('show');
    } else if (r.state === 'rate_limited') {
      openMfaModal();
      errEl.textContent = '⚠ Trade Republic rate-limited login. Wait 15–30 min and retry.';
      errEl.classList.add('show');
    } else {
      openMfaModal();
      errEl.textContent = r.detail || ('Error ' + r.http);
      errEl.classList.add('show');
    }
  } catch (e) {
    hideProgressOverlay();
    openMfaModal();
    errEl.textContent = 'Network error: ' + e.message;
    errEl.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
    setUpdateBtn(false);
  }
}

// ============ Staleness chip ============
// Ported from Trade-Republic-Dashboard commit 2e01fec (2026-06-02).
// Reads last_update.date via routes.data and injects a colored chip into
// the top-bar .actions on every secondary page. Portfolio (main.php)
// renders its own chip inside the subtitle — this script does NOT run
// there (the page sets data-update-flow-owner="page" and we return
// early), so no conflict.
function stalenessHint(iso) {
  if (!iso) return null;
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(iso.trim());
  const parseable = hasTz ? iso.trim() : iso.trim().replace(' ', 'T');
  const d = new Date(parseable);
  if (isNaN(d.getTime())) return null;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  let label;
  if (mins < 1)       label = 'just now';
  else if (mins < 60) label = mins + ' min ago';
  else {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    label = m === 0 ? h + ' h ago' : h + ' h ' + m + ' min ago';
  }
  const severity = mins <= 15 ? 'fresh' : mins <= 60 ? 'warn' : 'stale';
  return { label, severity };
}

// Read last_update.date and re-render the chip in-place. Safe to call
// repeatedly — does nothing if the chip element isn't in the DOM yet.
async function refreshStalenessChip() {
  if (!routes || !routes.data) return;
  const chip = document.getElementById('last-update-age');
  if (!chip) return;
  try {
    const r = await fetch(routes.data.replace('__TYPE__', 'last_update') + '?t=' + Date.now());
    if (!r.ok) return;
    const ts = (await r.text()).trim();
    if (!/\d{4}-\d{2}-\d{2}[ T]\d/.test(ts)) return;
    const s = stalenessHint(ts);
    if (!s) return;
    chip.textContent = s.label;
    chip.className = 'staleness-chip show ' + s.severity;
    chip.title = 'Snapshot fetched ' + ts;
  } catch (_) { /* keep prior state on error */ }
}

async function injectStalenessChip() {
  if (!routes || !routes.data) return;
  const actions = document.querySelector('.top-bar .actions');
  if (!actions || document.getElementById('last-update-age')) return;
  const chip = document.createElement('span');
  chip.id = 'last-update-age';
  chip.className = 'staleness-chip';
  const upd = document.getElementById('update-btn');
  if (upd) actions.insertBefore(chip, upd);
  else actions.appendChild(chip);
  await refreshStalenessChip();
  // Poll every minute — keeps "2 min ago" → "3 min ago" rolling over,
  // and catches updates triggered from OTHER tabs (where this tab's chip
  // would otherwise stay frozen at its initial value).
  setInterval(refreshStalenessChip, 60_000);
}

// Cross-tab refresh: when an Update Now completes in another tab,
// BroadcastChannel signals this one to refresh its chip instantly.
// Widely supported (Chrome/Safari/Firefox); silent fallback to 60s poll.
let _trUpdateChannel = null;
try {
  _trUpdateChannel = new BroadcastChannel('tr-dashboard-update');
  _trUpdateChannel.onmessage = (e) => {
    if (e.data && e.data.type === 'update-complete') {
      refreshStalenessChip();
    }
  };
} catch (_) { /* old browser — fall back to the 60s poll */ }
function broadcastUpdateComplete() {
  if (_trUpdateChannel) {
    try { _trUpdateChannel.postMessage({ type: 'update-complete', t: Date.now() }); } catch (_) {}
  }
}

// ============ Init ============
function init() {
  const root = document.getElementById('tr-app');
  if (!root) return;
  // Portfolio (main.php) ships its own copy of this logic inside dashboard.js
  // for the verbatim-port reasons documented in CLAUDE.md. Skip there to
  // avoid double-binding `#update-btn`.
  if (root.dataset.updateFlowOwner === 'page') return;

  // Need the update route at minimum.
  const updateUrl = root.dataset.routeUpdate;
  if (!updateUrl) return;  // page hasn't opted in (e.g. some future minimal page)

  routes = {
    update: updateUrl,
    index:  root.dataset.routeIndex,
    data:   root.dataset.routeData,
  };

  injectModalsIfMissing();
  injectStalenessChip();

  // Wire the button. Pages may have rendered Update Now as either an <a>
  // (legacy) or a <button id="update-btn"> (current). Templates have been
  // updated to use the button shape on every page.
  const btn = document.getElementById('update-btn');
  if (btn) btn.addEventListener('click', updateData);

  // Modal interactions.
  const mfaInput  = document.getElementById('mfa-input');
  const mfaCancel = document.getElementById('mfa-cancel-btn');
  const mfaSubmit = document.getElementById('mfa-submit-btn');
  const mfaBack   = document.getElementById('mfa-modal');
  const toastX    = document.getElementById('toast-close-btn');
  if (mfaInput) {
    mfaInput.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    mfaInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitMfa();
    });
  }
  if (mfaCancel) mfaCancel.addEventListener('click', closeMfaModal);
  if (mfaSubmit) mfaSubmit.addEventListener('click', submitMfa);
  if (mfaBack) mfaBack.addEventListener('click', e => {
    if (e.target === mfaBack) closeMfaModal();
  });
  if (toastX) toastX.addEventListener('click', hideToast);

  // ESC closes the MFA modal (matches Portfolio's behaviour).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const m = document.getElementById('mfa-modal');
    if (m && m.classList.contains('open')) closeMfaModal();
  });
}

window[NS] = { __loaded: true, updateData, openMfaModal };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();
