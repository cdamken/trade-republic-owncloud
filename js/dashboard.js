/* global OC */
/**
 * Trade Republic Portfolio — portfolio page logic.
 *
 * VERBATIM port of Trade-Republic-Dashboard/app/index.html (lines 412-963).
 * Only the following lines are patched for ownCloud:
 *   - `let routes = ...` is read from data-route-* attributes (lines below).
 *   - URLs: `/update` → routes.update; `/reset` → routes.reset;
 *           `/setup_status` & `/setup` → routes.config (GET + POST);
 *           `../DATA/portfolio.json` → routes.data.replace('__TYPE__','portfolio').
 *   - All POSTs add `requesttoken: OC.requestToken` (ownCloud CSRF).
 *   - Inline on* event handlers from the HTML are re-wired here via
 *     addEventListener (ownCloud's CSP blocks inline scripts).
 *
 * Logic, state model, and behaviour are otherwise identical to upstream —
 * if you compare upstream vs. this side-by-side, the diff should fit on
 * a screen.
 */
(function () {
'use strict';

let routes;  // set in DOMContentLoaded from data-route-* on #tr-app

let state = {
  data: null,
  all: { sortBy: 'net_value_eur', sortDir: -1 },
  winners: { sortBy: 'pl_pct', sortDir: -1 },
  losers: { sortBy: 'pl_pct', sortDir: 1 },
  search: '',
  bucket: 'all',
  plFilter: 'all'
};

// fmtEUR / fmtPct live in js/_shared.js (loaded first by PageController).
// dashboard.js used to declare its own top-level copies — removed in
// v0.1.40 along with the per-page inline `fmtE`/`fmtP` helpers. fmtPct
// callsites in this file pass `1` as the second arg because the
// portfolio table is the only place that uses 1-decimal P/L; every
// other page accepts the 2-decimal default.

// Quantity formatter that adapts decimal precision to the instrument
// class (verbatim from Dashboard commit 1384e2e). Crypto needs many
// decimals (0.029624 ETH); whole-share stocks look cleaner as integers
// ("12" not "12.0000"); fractional stocks (savings-plan units) still
// need up to 4 decimals.
function fmtQty(n, category) {
  if (n == null || isNaN(n)) return '—';
  if (category === 'cryptos') {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 6, maximumFractionDigits: 8,
    });
  }
  const isWhole = (n % 1 === 0);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 4,
  });
}

// Staleness chip helper — same heuristic as gbm-dashboard.
// Returns {label, severity}: fresh ≤15m, warn ≤1h, stale >1h.
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

// Inject + refresh the staleness chip in the top-bar .actions on every
// page — including Portfolio. Same format as the chip on secondary
// pages (update_flow.js): "Updated HH:MM · 2 h ago". Same place
// (top-bar) so all pages look consistent (2026-06-09 — Carlos noticed
// Portfolio's chip lived in the subtitle and looked nothing like the
// others).
async function refreshStalenessChip() {
  if (!routes || !routes.data) return;
  // Ensure the chip element exists in the top-bar — inject it the first
  // time refreshStalenessChip runs.
  let chip = document.getElementById('last-update-age');
  if (!chip) {
    const actions = document.querySelector('.top-bar .actions');
    if (!actions) return;
    chip = document.createElement('span');
    chip.id = 'last-update-age';
    chip.className = 'staleness-chip';
    const upd = document.getElementById('update-btn');
    if (upd) actions.insertBefore(chip, upd);
    else actions.appendChild(chip);
  }
  let fetchedAt = null;
  try {
    const r = await fetch(routes.data.replace('__TYPE__', 'last_update') + '?t=' + Date.now());
    if (r.ok) fetchedAt = (await r.text()).trim();
  } catch (_) { /* keep prior state on error */ }
  if (fetchedAt && /\d{4}-\d{2}-\d{2}[ T]\d/.test(fetchedAt)) {
    const s = stalenessHint(fetchedAt);
    if (!s) return;
    const parseable = fetchedAt.replace(' ', 'T');
    const d = new Date(parseable);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const abs = sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    chip.textContent = 'Updated ' + abs + ' · ' + s.label;
    chip.className = 'staleness-chip show ' + s.severity;
    chip.title = 'Snapshot fetched ' + fetchedAt;
  } else {
    chip.className = 'staleness-chip';
  }
}

// Cross-tab refresh: when an Update Now completes in another tab,
// BroadcastChannel signals this one to refresh its chip instantly.
let _trUpdateChannel = null;
try {
  _trUpdateChannel = new BroadcastChannel('tr-dashboard-update');
  _trUpdateChannel.onmessage = (e) => {
    if (e.data && e.data.type === 'update-complete') {
      refreshStalenessChip();
    }
  };
} catch (_) { /* old browser — fall back to the 60s poll below */ }

// Poll every minute as a fallback (and to roll "5 min ago" → "6 min ago"
// without a reload). Cheap: ~20 bytes per request.
setInterval(refreshStalenessChip, 60_000);

function broadcastUpdateComplete() {
  if (_trUpdateChannel) {
    try { _trUpdateChannel.postMessage({ type: 'update-complete', t: Date.now() }); } catch (_) {}
  }
}

function toggleSection(id) {
  const el = document.getElementById(id);
  const section = el.previousElementSibling;
  section.classList.toggle('collapsed');
  el.classList.toggle('hidden');
}

// ============ Update flow (POST routes.update + MFA modal) ============
const updateBtn = () => document.getElementById('update-btn');
// NOTE: #update-status used to live in the subtitle bar; v0.1.x dropped
// it in favor of the toast (#toast + #toast-stage). The showStatus()
// helper below now routes through the toast — keep both names so the
// existing 15+ call-sites don't all need a rename.
const setUpdateBtn = (loading, label) => {
  const b = updateBtn();
  if (!b) return;
  b.disabled = loading;
  b.classList.toggle('loading', loading);
  // The button can be either `<button>🔄 Update Now</button>` (current
  // top-bar) or the older `<button><span class="label">…</span></button>`
  // shape. Support both — set .label if present, otherwise fall back to
  // rewriting the whole button text (keeping the 🔄 emoji prefix).
  const labelEl = b.querySelector('.label');
  if (labelEl) {
    labelEl.textContent = label || 'Update Now';
  } else {
    b.textContent = '🔄 ' + (label || 'Update Now');
  }
};
// Route status messages through the toast (the dedicated #update-status
// span this used to write to was dropped from the template). The toast
// auto-hides 'ok' messages after 3s; errors stay visible until dismissed
// or the next showStatus() call replaces them.
const showStatus = (kind, msg) => {
  const t = document.getElementById('toast');
  const title = document.getElementById('toast-title');
  const stage = document.getElementById('toast-stage');
  if (!t || !title || !stage) return;
  t.classList.remove('ok', 'err');
  if (kind === 'ok' || kind === 'err') t.classList.add(kind);
  title.textContent = msg || '';
  stage.textContent = '';
  t.classList.add('active');
  if (kind === 'ok') setTimeout(() => t.classList.remove('active'), 3000);
};

async function postUpdate(mfaCode, opts) {
  const body = {};
  if (mfaCode) body.mfa_code = mfaCode;
  if (opts && opts.full) body.full = true;
  if (opts && opts.approveLogin) body.approve_login = true;
  const res = await fetch(routes.update, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
    body: JSON.stringify(body),
  });
  let payload = {};
  try { payload = await res.json(); } catch (e) { payload = {}; }
  return { http: res.status, state: payload.status, detail: payload.detail };
}

// ============ Switch account / Reset ============
function openResetModal() {
  document.getElementById('reset-modal').classList.add('open');
  document.getElementById('reset-err').classList.remove('show');
  document.getElementById('reset-confirm').value = '';
  document.getElementById('reset-submit-btn').disabled = true;
  setTimeout(() => document.getElementById('reset-confirm').focus(), 100);
}

function closeResetModal() {
  document.getElementById('reset-modal').classList.remove('open');
}

async function submitReset() {
  const confirm = document.getElementById('reset-confirm').value;
  const errEl = document.getElementById('reset-err');
  const btn = document.getElementById('reset-submit-btn');
  if (confirm !== 'delete') return;

  btn.disabled = true;
  btn.textContent = 'Erasing…';
  errEl.classList.remove('show');

  try {
    const r = await fetch(routes.reset, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
      body: JSON.stringify({ confirm: 'delete' }),
    });
    const j = await r.json();
    if (r.status === 200) {
      location.reload();
      return;
    }
    errEl.textContent = j.detail || ('Error ' + r.status);
    errEl.classList.add('show');
  } catch (e) {
    errEl.textContent = 'Network error: ' + e.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Erase & switch';
  }
}

// ============ Setup / account settings modal ============
async function checkSetup() {
  try {
    const r = await fetch(routes.config);
    const j = await r.json();
    if (!j.setup_complete) openSetupModal();
  } catch (e) { /* server not ready yet — silent */ }
}

async function openSetupModal() {
  let status = { setup_complete: false, phone: null };
  try {
    const r = await fetch(routes.config);
    if (r.ok) status = await r.json();
  } catch (_) {}

  const titleEl = document.getElementById('setup-title');
  const introEl = document.getElementById('setup-intro');
  const cancelBtn = document.getElementById('setup-cancel-btn');
  const submitBtn = document.getElementById('setup-submit-btn');
  const resetLinkEl = document.getElementById('setup-reset-link');

  if (status.setup_complete) {
    titleEl.textContent = '⚙️ Account settings';
    introEl.innerHTML = 'Change your TR phone number or PIN.';
    cancelBtn.style.display = '';
    submitBtn.style.width = '';
    if (resetLinkEl) resetLinkEl.style.display = '';
  } else {
    titleEl.textContent = '👋 Welcome — first-time setup';
    introEl.innerHTML = 'To connect to Trade Republic, this dashboard needs your TR <strong>phone number</strong> and <strong>PIN</strong>.';
    cancelBtn.style.display = 'none';
    submitBtn.style.width = '100%';
    if (resetLinkEl) resetLinkEl.style.display = 'none';
  }

  const phoneInput = document.getElementById('setup-phone');
  const pinInput = document.getElementById('setup-pin');
  phoneInput.value = status.phone || '';
  pinInput.value = '';

  document.getElementById('setup-modal').classList.add('open');
  document.getElementById('setup-err').classList.remove('show');
  setTimeout(() => (status.phone ? pinInput : phoneInput).focus(), 100);
}

function closeSetupModal() {
  document.getElementById('setup-modal').classList.remove('open');
}

async function submitSetup() {
  const phone = document.getElementById('setup-phone').value.trim();
  const pin = document.getElementById('setup-pin').value.trim();
  const errEl = document.getElementById('setup-err');
  errEl.classList.remove('show');

  if (!/^\+\d{8,15}$/.test(phone)) {
    errEl.textContent = 'Phone must look like +4912345678 (no spaces or dashes).';
    errEl.classList.add('show');
    document.getElementById('setup-phone').focus();
    return;
  }
  if (!/^\d{4,6}$/.test(pin)) {
    errEl.textContent = 'PIN must be 4–6 digits.';
    errEl.classList.add('show');
    document.getElementById('setup-pin').focus();
    return;
  }

  const btn = document.getElementById('setup-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const r = await fetch(routes.config, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
      body: JSON.stringify({ phone, pin }),
    });
    const j = await r.json();
    if (r.status === 200) {
      closeSetupModal();
      showStatus('ok', '✓ Credentials saved — requesting MFA code…');
      const upd = await postUpdate(null);
      if (upd.http === 200) {
        showStatus('ok', '✓ Already authenticated — reloading');
        setTimeout(() => location.reload(), 800);
      } else {
        openMfaModal();
      }
      return;
    }
    errEl.textContent = j.detail || ('Error ' + r.status);
    errEl.classList.add('show');
  } catch (e) {
    errEl.textContent = 'Network error: ' + e.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue →';
  }
}

// ============ Progress overlay ============
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

// Mockup-v5: the old dim-backdrop progress overlay is replaced with a top-
// center toast + a 2px progress bar. Same function names so the existing
// updateData()/submitMfa()/etc. call sites stay unchanged.
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

// ============ Documents download (background job + in-app modal) ============
//
// The download runs as a detached server-side job; the browser starts it,
// then polls /api/docs_status. The Documents button stays disabled for the
// whole job — reconciled against the SERVER's state, so a client-side timeout
// or a page reload can't re-enable it while the server is still downloading.
// All UI is in #docs-modal (confirm → progress → result) — no native
// confirm()/alert() dialogs.

let _docsPollTimer = null;
let _docsElapsedTimer = null;
let _docsStartedAt = null;
let _docsBtnOrig = null;

function _docsBtn() { return document.getElementById('docs-btn'); }

function setDocsBtnRunning(running) {
  const btn = _docsBtn();
  if (!btn) return;
  if (_docsBtnOrig === null) _docsBtnOrig = btn.innerHTML;
  btn.disabled = running;
  btn.innerHTML = running
    ? '<span class="spinner" style="display:inline-block"></span> Downloading…'
    : _docsBtnOrig;
}

function showDocsState(which) {
  ['confirm', 'progress', 'result'].forEach((s) => {
    const el = document.getElementById('docs-' + s);
    if (el) el.style.display = (s === which) ? '' : 'none';
  });
}

function openDocsModal() {
  // If a job is already running (e.g. opened from another tab), jump straight
  // to the progress view instead of offering to start a second one.
  showDocsState(_docsPollTimer ? 'progress' : 'confirm');
  document.getElementById('docs-modal').classList.add('open');
}

function closeDocsModal() {
  document.getElementById('docs-modal').classList.remove('open');
}

// The top-bar Documents button just opens the modal — the actual work is
// gated behind the explicit "Start download" button inside it.
function downloadDocs() {
  openDocsModal();
}

async function startDocsDownload() {
  showStatus('', 'Starting document download…');
  try {
    const r = await fetch(routes.downloadDocs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
      body: JSON.stringify({}),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && (data.status === 'started' || data.status === 'already_running')) {
      _docsStartedAt = Date.now();
      setDocsBtnRunning(true);
      showDocsState('progress');
      beginDocsPolling();
      showStatus('', 'Downloading documents in the background…');
    } else if (data.status === 'auth_required') {
      // Re-auth inside the modal: explain, then route through the normal MFA
      // flow (same security-code prompt as Update Now).
      showDocsResult('err', '🔐 Session expired',
        'Your Trade Republic session expired. Re-authenticate (you\'ll get a ' +
        'security-code push), then open Documents again.');
      showStatus('err', 'Session expired');
      setTimeout(() => { closeDocsModal(); updateData(); }, 2200);
    } else {
      showDocsResult('err', '⚠️ Could not start',
        data.detail || data.status || 'Unknown error starting the download.');
      showStatus('err', 'Download failed to start');
    }
  } catch (e) {
    showDocsResult('err', '⚠️ Network error', e.message);
    showStatus('err', 'Network error');
  }
}

function beginDocsPolling() {
  stopDocsPolling();
  _docsElapsedTimer = setInterval(updateDocsElapsed, 1000);
  updateDocsElapsed();
  // Poll every 3s. First poll after a short delay so the job has a moment.
  _docsPollTimer = setInterval(pollDocsStatus, 3000);
}

function stopDocsPolling() {
  if (_docsPollTimer) { clearInterval(_docsPollTimer); _docsPollTimer = null; }
  if (_docsElapsedTimer) { clearInterval(_docsElapsedTimer); _docsElapsedTimer = null; }
}

function updateDocsElapsed() {
  const el = document.getElementById('docs-progress-elapsed');
  if (!el || !_docsStartedAt) return;
  const s = Math.floor((Date.now() - _docsStartedAt) / 1000);
  const m = Math.floor(s / 60);
  el.textContent = m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

async function pollDocsStatus() {
  try {
    const r = await fetch(routes.docsStatus + '?t=' + Date.now(), {
      headers: { 'requesttoken': OC.requestToken },
    });
    const s = await r.json().catch(() => ({}));
    if (s.state === 'done') {
      stopDocsPolling();
      setDocsBtnRunning(false);
      const c = s.counts || {};
      const downloaded = c.downloaded || 0;
      const skipped    = c.skipped_existing || 0;
      const errors     = c.error || 0;
      const total      = c.total || 0;
      const summary = `<strong>${downloaded}</strong> new, ` +
                      `<strong>${skipped}</strong> already present` +
                      (errors ? `, <strong>${errors}</strong> errors` : '') +
                      ` (of ${total} total).`;
      showDocsResult('ok', '✓ Documents downloaded', summary);
      showStatus('ok', `✓ ${downloaded} new, ${skipped} present` +
                       (errors ? `, ${errors} errors` : ''));
    } else if (s.state === 'error') {
      stopDocsPolling();
      setDocsBtnRunning(false);
      showDocsResult('err', '⚠️ Download failed',
        s.message || 'The download did not complete.');
      showStatus('err', 'Download failed');
    }
    // state === 'running' (or 'idle' on a transient blip): keep polling.
  } catch (e) {
    // Transient network error — keep polling; the job runs server-side.
  }
}

function showDocsResult(kind, title, summaryHtml) {
  // Make sure the modal is visible (it may have been hidden), then show the
  // result panel.
  document.getElementById('docs-modal').classList.add('open');
  const titleEl = document.getElementById('docs-result-title');
  const sumEl = document.getElementById('docs-result-summary');
  if (titleEl) titleEl.textContent = title;
  if (sumEl) {
    sumEl.innerHTML = summaryHtml;
    sumEl.style.borderLeftColor = kind === 'err' ? 'var(--red)' : '';
  }
  showDocsState('result');
}

// On page load, ask the server whether a docs job is already running (e.g.
// started in another tab or before a reload). If so, reflect it in the button
// + resume polling so the disabled state survives reloads.
async function checkDocsStatusOnLoad() {
  if (!routes || !routes.docsStatus) return;
  try {
    const r = await fetch(routes.docsStatus + '?t=' + Date.now(), {
      headers: { 'requesttoken': OC.requestToken },
    });
    const s = await r.json().catch(() => ({}));
    if (s.state === 'running') {
      _docsStartedAt = s.started_at ? Date.parse(s.started_at) : Date.now();
      setDocsBtnRunning(true);
      beginDocsPolling();
    }
  } catch (e) { /* ignore — best effort */ }
}

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
      if (overlayShown) {
        document.getElementById('progress-stage').textContent = '✓ Data downloaded — reloading…';
      }
      clearTimeout(overlayDelay);
      showStatus('ok', '✓ Updated — reloading');
      broadcastUpdateComplete();   // tell other tabs to refresh their chip
      setTimeout(() => location.reload(), 800);
      return;
    }
    // v2 push-approval: TR's 2026 web login has no 4-digit code — the user
    // approves the login from a prompt in the TR mobile app. Phase 1 detected
    // a stale session; now show the "approve on your phone" overlay and run
    // phase 2 (the wrapper blocks up to ~90s waiting for the approval, then
    // fetches).
    if (r.state === 'approval_required') {
      if (!overlayShown) { showProgressOverlay({ full: false }); overlayShown = true; }
      const title = document.getElementById('progress-title');
      const stage = document.getElementById('progress-stage');
      if (title) title.textContent = 'Approve the login on your phone';
      if (stage) stage.textContent = '📱 Open Trade Republic and approve the login prompt…';
      const r2 = await postUpdate(null, { approveLogin: true });
      if (r2.http === 200) {
        if (stage) stage.textContent = '✓ Data downloaded — reloading…';
        showStatus('ok', '✓ Updated — reloading');
        broadcastUpdateComplete();
        setTimeout(() => location.reload(), 800);
        return;
      }
      cleanupOverlay();
      if (r2.state === 'approval_timeout') {
        showStatus('err', '⌛ Login not approved in time — click Update Now again and approve the prompt in your Trade Republic app.');
      } else if (r2.state === 'rate_limited') {
        showStatus('err', '⚠ Rate-limited by Trade Republic — wait 15–30 min and retry');
      } else {
        showStatus('err', '✗ ' + (r2.detail || r2.state || ('HTTP ' + r2.http)));
      }
      return;
    }
    if (r.state === 'mfa_required') {
      openMfaModal();
      return;
    }
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
  document.getElementById('mfa-modal').classList.add('open');
  document.getElementById('mfa-err').classList.remove('show');
  document.getElementById('mfa-input').value = '';
  const cb = document.getElementById('mfa-full-reload');
  if (cb) cb.checked = false;
  setTimeout(() => document.getElementById('mfa-input').focus(), 100);
  setUpdateBtn(false);
}

function closeMfaModal() {
  document.getElementById('mfa-modal').classList.remove('open');
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
  const fullReload = !!document.getElementById('mfa-full-reload')?.checked;
  setUpdateBtn(true, fullReload ? 'Re-downloading everything…' : 'Updating…');

  closeMfaModal();
  showProgressOverlay({ full: fullReload });

  try {
    const r = await postUpdate(code, { full: fullReload });
    if (r.http === 200) {
      document.getElementById('progress-stage').textContent = '✓ Data downloaded — reloading…';
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

async function load() {
  const res = await fetch(routes.data.replace('__TYPE__', 'portfolio') + '?t=' + Date.now());
  if (!res.ok) return;  // no portfolio.json yet — setup wizard / first update will create it
  state.data = await res.json();

  // Analytics is optional — first-run users won't have it yet, and a
  // missing file shouldn't break the portfolio render. We use it for
  // the XIRR card and any future analytics-derived KPIs.
  try {
    const aRes = await fetch(routes.data.replace('__TYPE__', 'analytics') + '?t=' + Date.now());
    state.analytics = aRes.ok ? await aRes.json() : null;
  } catch (_) { state.analytics = null; }

  // Re-render the staleness chip in-place. Called on initial load and on
  // any cross-tab BroadcastChannel signal / 60s poll so the label stays
  // fresh and tabs catch updates fired from elsewhere.
  await refreshStalenessChip();

  // Populate the sticky cockpit (KPIs + bucket pills). Replaces the old
  // .cards section that used to live below the nav.
  const s = state.data.summary;
  renderCockpit(s, state.data);
  renderWealthBuckets(s);

  // Concentration warnings (purely informational; thresholds are heuristic).
  renderConcentrationWarnings(state.data);

  if (state.data.zero_value_positions.length > 0) {
    const w = document.getElementById('warning');
    w.style.display = 'block';
    w.innerHTML = '⚠️ <strong>Positions with missing price:</strong> ' +
      state.data.zero_value_positions.map(p => p.name).join(', ');
  }

  document.getElementById('total-count').textContent = state.data.positions_with_value;

  renderWinners();
  renderLosers();
  renderAll();
}

// Build external-research links for an ISIN. Yahoo Finance lookup +
// Stock Analysis URLs were broken — Yahoo killed their ISIN-lookup
// endpoint years ago, StockAnalysis only handles tickers. Replaced
// with Boerse Frankfurt (universal ISIN, stocks + ETFs + bonds) and
// a Google search fallback. TR URL updated to /profile/instrument/.
function externalLinks(isin) {
  if (!isin) return '';
  const tr = `https://app.traderepublic.com/profile/instrument/${encodeURIComponent(isin)}`;
  const bf = `https://www.boerse-frankfurt.de/equity/${encodeURIComponent(isin)}`;
  const google = `https://www.google.com/search?q=${encodeURIComponent(isin + ' stock')}`;
  return `<span class="ext-links">` +
    `<a href="${tr}" target="_blank" rel="noopener" title="Open on Trade Republic (requires TR login)">TR</a>` +
    `<a href="${bf}" target="_blank" rel="noopener" title="Look up on Boerse Frankfurt (stocks, ETFs, bonds by ISIN)">BF</a>` +
    `<a href="${google}" target="_blank" rel="noopener" title="Google search by ISIN">G</a>` +
    `</span>`;
}

function rowHTML(p) {
  // P/L now coloured green (positive) / red (negative). 2026-06-01 reversal
  // of the earlier sign-only choice — Carlos found it harder to scan.
  const safeIsin = esc(p.isin);
  const safeName = esc(p.name);
  const plCls = (p.pl_eur || 0) >= 0 ? 'pl-pos' : 'pl-neg';
  return `<tr>
    <td title="${safeName}"><a href="#" class="position-link" data-isin="${safeIsin}" data-name="${safeName}">${safeName}</a></td>
    <td><code>${safeIsin}</code>${externalLinks(p.isin)}</td>
    <td class="num">${fmtQty(p.quantity, p.category)}</td>
    <td class="num">${fmtEUR(p.avg_cost)}</td>
    <td class="num">${fmtEUR(p.current_price)}</td>
    <td class="num">${fmtEUR(p.buy_cost_eur)}</td>
    <td class="num"><strong>${fmtEUR(p.net_value_eur)}</strong></td>
    <td class="num ${plCls}">${fmtEUR(p.pl_eur)}</td>
    <td class="num pct ${plCls}"><strong>${fmtPct(p.pl_pct, 1)}</strong></td>
  </tr>`;
}

function shortRow(p) {
  const safeIsin = esc(p.isin);
  const safeName = esc(p.name);
  const plCls = (p.pl_eur || 0) >= 0 ? 'pl-pos' : 'pl-neg';
  return `<tr>
    <td title="${safeName}"><a href="#" class="position-link" data-isin="${safeIsin}" data-name="${safeName}">${safeName}</a></td>
    <td><code>${safeIsin}</code>${externalLinks(p.isin)}</td>
    <td class="num">${fmtQty(p.quantity, p.category)}</td>
    <td class="num"><strong>${fmtEUR(p.net_value_eur)}</strong></td>
    <td class="num ${plCls}">${fmtEUR(p.pl_eur)}</td>
    <td class="num pct ${plCls}"><strong>${fmtPct(p.pl_pct, 1)}</strong></td>
  </tr>`;
}

// ----- Position detail modal (no iframe; X-Frame-Options blocks embedding) -----
function openPositionModal(isin, name) {
  if (!isin || !state.data) return;
  const pos = (state.data.all_positions || []).find(p => p.isin === isin);
  if (!pos) return;
  const modal = document.getElementById('position-modal');
  document.getElementById('position-modal-title').textContent = name || pos.name || isin;
  document.getElementById('position-modal-isin').textContent = isin;

  const body = document.getElementById('position-modal-body');
  body.innerHTML =
    '<div class="pm-grid">' +
      '<div class="pm-stat"><div class="pm-label">Quantity</div><div class="pm-value">' + fmtQty(pos.quantity, pos.category) + '</div></div>' +
      '<div class="pm-stat"><div class="pm-label">Avg cost</div><div class="pm-value">' + fmtEUR(pos.avg_cost) + '</div></div>' +
      '<div class="pm-stat"><div class="pm-label">Current price</div><div class="pm-value">' + fmtEUR(pos.current_price) + '</div></div>' +
      '<div class="pm-stat"><div class="pm-label">Invested</div><div class="pm-value">' + fmtEUR(pos.buy_cost_eur) + '</div></div>' +
      '<div class="pm-stat"><div class="pm-label">Net value</div><div class="pm-value"><strong>' + fmtEUR(pos.net_value_eur) + '</strong></div></div>' +
      '<div class="pm-stat"><div class="pm-label">P/L</div><div class="pm-value">' + fmtEUR(pos.pl_eur) + ' (' + fmtPct(pos.pl_pct, 1) + ')</div></div>' +
    '</div>' +
    '<div class="pm-meta">Category: <strong>' + esc(pos.category || 'unknown') + '</strong> · ISIN: <code>' + esc(isin) + '</code></div>' +
    '<p class="pm-tip">Click the buttons below to open external research in a new tab. All links work by ISIN. Most financial sites block iframe embedding via <code>X-Frame-Options</code>, so we can\'t inline them.</p>';

  const links = document.getElementById('position-modal-links');
  links.innerHTML =
    '<a href="https://app.traderepublic.com/profile/instrument/' + encodeURIComponent(isin) + '" target="_blank" rel="noopener">📊 Trade Republic ↗</a>' +
    '<a href="https://www.boerse-frankfurt.de/equity/' + encodeURIComponent(isin) + '" target="_blank" rel="noopener">📈 Boerse Frankfurt ↗</a>' +
    '<a href="https://www.justetf.com/en/etf-profile.html?isin=' + encodeURIComponent(isin) + '" target="_blank" rel="noopener">🧮 JustETF (ETFs only) ↗</a>' +
    '<a href="https://www.google.com/search?q=' + encodeURIComponent(isin + ' stock') + '" target="_blank" rel="noopener">🔎 Google ↗</a>';
  modal.classList.add('open');
}

function closePositionModal() {
  document.getElementById('position-modal').classList.remove('open');
}

function sortArray(arr, cfg) {
  return [...arr].sort((a, b) => {
    const av = a[cfg.sortBy], bv = b[cfg.sortBy];
    if (typeof av === 'number') return (av - bv) * cfg.sortDir;
    return String(av).localeCompare(String(bv)) * cfg.sortDir;
  });
}

function renderConcentrationWarnings(data) {
  // Surface heuristic "you might be over-concentrated in X" warnings.
  // No external data needed; everything from the local portfolio snapshot.
  const container = document.getElementById('concentration');
  if (!container || !data) return;

  const positions = (data.all_positions || []).filter(p => p.net_value_eur > 0);
  if (positions.length === 0) { container.style.display = 'none'; return; }
  const summary = data.summary || {};
  const depot = summary.depot_netvalue || 1;
  const warnings = [];

  const top = [...positions].sort((a, b) => b.net_value_eur - a.net_value_eur)[0];
  if (top && top.net_value_eur / depot > 0.20) {
    const pct = (top.net_value_eur / depot * 100).toFixed(1);
    warnings.push('<strong>' + top.name + '</strong> is <strong>' + pct + '%</strong> of your depot ' +
                  '(' + fmtEUR(top.net_value_eur) + '). A single position above 20% means a bad week ' +
                  'for it moves your whole portfolio noticeably.');
  }

  const top5 = [...positions].sort((a, b) => b.net_value_eur - a.net_value_eur).slice(0, 5);
  const top5Value = top5.reduce((s, p) => s + p.net_value_eur, 0);
  if (top5Value / depot > 0.50 && positions.length > 10) {
    const pct = (top5Value / depot * 100).toFixed(0);
    warnings.push('Your top 5 positions are <strong>' + pct + '%</strong> of your depot ' +
                  '(out of ' + positions.length + ' total). Most of the risk concentrates in a few names.');
  }

  const buckets = summary.by_category || {};
  for (const [key, b] of Object.entries(buckets)) {
    if (!b || !b.net_value_eur) continue;
    const share = b.net_value_eur / depot;
    if (share > 0.90 && Object.keys(buckets).length > 1 && key !== 'others') {
      const pct = (share * 100).toFixed(0);
      warnings.push('<strong>' + pct + '%</strong> of your depot is in <strong>' + key + '</strong>. ' +
                    'Cross-asset diversification (e.g. some bonds against equity) reduces drawdowns ' +
                    'in market stress.');
    }
  }

  const tiny = positions.filter(p => p.net_value_eur < 50).length;
  if (tiny > 50) {
    warnings.push('<strong>' + tiny + '</strong> positions are worth less than €50 each. ' +
                  'Consider consolidating: tax forms and reconciliation get heavy at this scale.');
  }

  if (warnings.length === 0) { container.style.display = 'none'; return; }
  container.innerHTML = '<span class="ttl">⚠️ Concentration insights</span>' +
                        '<ul>' + warnings.map(w => '<li>' + w + '</li>').join('') + '</ul>';
  container.style.display = '';
}

function renderCockpit(summary, data) {
  // 5 KPIs at the top of the sticky cockpit.
  document.getElementById('ck-total').textContent = fmtEUR(summary.total_netvalue);
  document.getElementById('ck-total-sub').textContent =
    'Depot ' + fmtEUR(summary.depot_netvalue) +
    ' + Cash ' + fmtEUR(summary.cash_eur) +
    ' · ' + data.positions_with_value + ' positions';
  document.getElementById('ck-cost').textContent = fmtEUR(summary.depot_buycost);
  const plEl = document.getElementById('ck-pl');
  const plPctEl = document.getElementById('ck-pl-pct');
  plEl.textContent = fmtEUR(summary.depot_pl_eur);
  plPctEl.textContent = fmtPct(summary.depot_pl_pct, 1);
  // Recolour KPI cockpit P/L (green/red). Remove any previous class first.
  const plCls = (summary.depot_pl_eur || 0) >= 0 ? 'pl-pos' : 'pl-neg';
  plEl.classList.remove('pl-pos', 'pl-neg'); plEl.classList.add(plCls);
  plPctEl.classList.remove('pl-pos', 'pl-neg'); plPctEl.classList.add(plCls);
  document.getElementById('ck-cash').textContent = fmtEUR(summary.cash_eur);

  // XIRR — read from analytics.json (cash_flow.xirr is a percent number).
  // null = not enough flows / didn't converge → show em-dash like GBM.
  const xirr = state.analytics && state.analytics.cash_flow && state.analytics.cash_flow.xirr;
  const xirrEl = document.getElementById('ck-xirr');
  const xirrSubEl = document.getElementById('ck-xirr-sub');
  if (xirr == null || isNaN(xirr)) {
    xirrEl.textContent = '—';
    xirrEl.classList.remove('pl-pos', 'pl-neg');
    xirrSubEl.textContent = state.analytics ? 'not enough flows to converge' : 'analytics pending';
  } else {
    const sign = xirr >= 0 ? '+' : '';
    xirrEl.textContent = sign + xirr.toFixed(2) + '%';
    xirrEl.classList.remove('pl-pos', 'pl-neg');
    xirrEl.classList.add(xirr >= 0 ? 'pl-pos' : 'pl-neg');
    xirrSubEl.textContent = 'money-weighted, all external flows';
  }
}

function renderWealthBuckets(summary) {
  // Bucket pills inside the sticky cockpit (replaces the old wide tiles).
  const by = summary.by_category || {};
  const container = document.getElementById('ck-buckets');
  if (!container) return;
  const labels = {
    stocksAndETFs:  { name: 'Brokerage (Stocks/ETFs)', icon: '📈', color: 'asset-equity' },
    bonds:          { name: 'Bonds',                   icon: '🏛',  color: 'asset-bonds'  },
    privateMarkets: { name: 'Private Equity',          icon: '🔒', color: 'asset-pe'     },
    cryptos:        { name: 'Crypto',                  icon: '🪙', color: 'asset-crypto' },
    others:         { name: 'Others',                  icon: '·',  color: 'asset-other'  },
  };
  const order = ['stocksAndETFs','bonds','privateMarkets','cryptos','others'];

  const pills = [];
  for (const key of order) {
    const b = by[key];
    if (!b || !b.count) continue;
    const meta = labels[key] || { name: key, icon: '·', color: '' };
    const subCls = (b.pl_pct || 0) >= 0 ? 'pl-pos' : 'pl-neg';
    pills.push(
      '<div class="b-pill">' +
      '<div class="b-label">' + meta.icon + ' ' + meta.name + '</div>' +
      '<div class="b-value ' + meta.color + '">' + fmtEUR(b.net_value_eur) + '</div>' +
      '<div class="b-sub">' + b.count + ' pos · <span class="' + subCls + '">' + fmtPct(b.pl_pct, 1) + '</span></div>' +
      '</div>'
    );
  }
  pills.push(
    '<div class="b-pill">' +
    '<div class="b-label">💶 Cash</div>' +
    '<div class="b-value asset-cash">' + fmtEUR(summary.cash_eur) + '</div>' +
    '<div class="b-sub">to invest / withdraw</div>' +
    '</div>'
  );
  container.innerHTML = pills.join('');
}

function renderWinners() {
  const list = sortArray(state.data.winners_50plus, state.winners);
  document.getElementById('winners-count').textContent = list.length;
  document.querySelector('#winners tbody').innerHTML = list.map(shortRow).join('');
}

function renderLosers() {
  const list = sortArray(state.data.losers_25minus, state.losers);
  document.getElementById('losers-count').textContent = list.length;
  document.querySelector('#losers tbody').innerHTML = list.map(shortRow).join('');
}

function renderAll() {
  let arr = [...state.data.all_positions];

  if (state.bucket === 'over_2000') arr = arr.filter(p => p.net_value_eur >= 2000);
  else if (state.bucket === 'range_500_2000') arr = arr.filter(p => p.net_value_eur >= 500 && p.net_value_eur < 2000);
  else if (state.bucket === 'range_100_500') arr = arr.filter(p => p.net_value_eur >= 100 && p.net_value_eur < 500);
  else if (state.bucket === 'range_20_100') arr = arr.filter(p => p.net_value_eur >= 20 && p.net_value_eur < 100);
  else if (state.bucket === 'under_20') arr = arr.filter(p => p.net_value_eur < 20);

  if (state.plFilter === 'winners') arr = arr.filter(p => p.pl_pct > 0);
  else if (state.plFilter === 'losers') arr = arr.filter(p => p.pl_pct < 0);
  else if (state.plFilter === 'big_winners') arr = arr.filter(p => p.pl_pct >= 50);
  else if (state.plFilter === 'big_losers') arr = arr.filter(p => p.pl_pct <= -25);

  if (state.search) {
    const s = state.search.toLowerCase();
    arr = arr.filter(p => p.name.toLowerCase().includes(s) || p.isin.toLowerCase().includes(s));
  }

  arr = sortArray(arr, state.all);
  document.querySelector('#all tbody').innerHTML = arr.map(rowHTML).join('');
}

// ============ Wire-up (replaces the inline on* handlers from upstream HTML) ============
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('tr-app');
  document.body.classList.add('tr-app-active');
  routes = {
    index:        root.dataset.routeIndex,
    analytics:    root.dataset.routeAnalytics,
    settings:     root.dataset.routeSettings,
    glossary:     root.dataset.routeGlossary,
    data:         root.dataset.routeData,
    config:       root.dataset.routeConfig,
    update:       root.dataset.routeUpdate,
    reset:        root.dataset.routeReset,
    downloadDocs: root.dataset.routeDownloadDocs,
    docsStatus:   root.dataset.routeDocsStatus,
  };

  document.getElementById('update-btn').addEventListener('click', updateData);
  const docsBtn = document.getElementById('docs-btn');
  if (docsBtn) docsBtn.addEventListener('click', downloadDocs);
  // Documents modal: confirm → start, plus the hide/close buttons. Closing the
  // modal never stops the job — polling continues so the button stays disabled.
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('docs-start-btn', startDocsDownload);
  bind('docs-cancel-btn', closeDocsModal);
  bind('docs-progress-hide-btn', closeDocsModal);
  bind('docs-result-close-btn', closeDocsModal);
  const docsBackdrop = document.getElementById('docs-modal');
  if (docsBackdrop) docsBackdrop.addEventListener('click', (e) => {
    if (e.target === docsBackdrop) closeDocsModal();
  });
  // If a download is already running (other tab / before reload), resume.
  checkDocsStatusOnLoad();
  // Settings + Glossary are real pages now (links in the top-bar); the
  // old setup-open-btn modal trigger has moved to the Settings page.
  const toastClose = document.getElementById('toast-close-btn');
  if (toastClose) toastClose.addEventListener('click', hideToast);

  // Position detail modal — delegated click + close handlers.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.position-link');
    if (a) { e.preventDefault(); openPositionModal(a.dataset.isin, a.dataset.name); return; }
    const backdrop = document.getElementById('position-modal');
    if (backdrop && e.target === backdrop) closePositionModal();
  });
  const pmClose = document.getElementById('position-modal-close-btn');
  if (pmClose) pmClose.addEventListener('click', closePositionModal);

  document.getElementById('search').addEventListener('input', e => { state.search = e.target.value; renderAll(); });
  document.getElementById('bucketFilter').addEventListener('change', e => { state.bucket = e.target.value; renderAll(); });
  document.getElementById('plFilter').addEventListener('change', e => { state.plFilter = e.target.value; renderAll(); });

  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const tableId = th.closest('table').id;
      const key = th.dataset.sort;
      const cfg = state[tableId] || state['all'];
      if (cfg.sortBy === key) cfg.sortDir = -cfg.sortDir;
      else { cfg.sortBy = key; cfg.sortDir = -1; }
      if (tableId === 'winners') renderWinners();
      else if (tableId === 'losers') renderLosers();
      else if (tableId === 'all') renderAll();
    });
  });

  // Collapsible sections (replaces inline onclick="toggleSection('...')")
  document.querySelectorAll('.section[data-toggle]').forEach(sec => {
    sec.addEventListener('click', () => toggleSection(sec.dataset.toggle));
  });

  // Modal close on backdrop click (replaces inline onclick on .modal-backdrop)
  ['mfa-modal', 'reset-modal', 'setup-modal'].forEach(id => {
    const m = document.getElementById(id);
    if (!m) return;
    m.addEventListener('click', e => {
      if (e.target !== m) return;
      if (id === 'mfa-modal') closeMfaModal();
      else if (id === 'reset-modal') closeResetModal();
      else if (id === 'setup-modal') {
        // First-time setup ignores backdrop clicks (nothing meaningful behind it)
        const cancelBtn = document.getElementById('setup-cancel-btn');
        if (cancelBtn && cancelBtn.style.display !== 'none') closeSetupModal();
      }
    });
  });

  // MFA modal interactions
  document.getElementById('mfa-input').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });
  document.getElementById('mfa-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitMfa();
  });
  document.getElementById('mfa-cancel-btn').addEventListener('click', closeMfaModal);
  document.getElementById('mfa-submit-btn').addEventListener('click', submitMfa);

  // Reset modal interactions
  document.getElementById('reset-confirm').addEventListener('input', e => {
    document.getElementById('reset-submit-btn').disabled = e.target.value !== 'delete';
  });
  document.getElementById('reset-confirm').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value === 'delete') submitReset();
  });
  document.getElementById('reset-cancel-btn').addEventListener('click', closeResetModal);
  document.getElementById('reset-submit-btn').addEventListener('click', submitReset);

  // Setup modal interactions
  document.getElementById('setup-phone').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('setup-pin').focus();
  });
  document.getElementById('setup-pin').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });
  document.getElementById('setup-pin').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitSetup();
  });
  document.getElementById('setup-cancel-btn').addEventListener('click', closeSetupModal);
  document.getElementById('setup-submit-btn').addEventListener('click', submitSetup);
  const resetLink = document.getElementById('setup-open-reset');
  if (resetLink) resetLink.addEventListener('click', e => {
    e.preventDefault();
    closeSetupModal();
    openResetModal();
  });

  // Global ESC handler (same priority as upstream)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const pos = document.getElementById('position-modal');
    if (pos && pos.classList.contains('open')) { closePositionModal(); return; }
    const mfa = document.getElementById('mfa-modal');
    if (mfa && mfa.classList.contains('open')) { closeMfaModal(); return; }
    const reset = document.getElementById('reset-modal');
    if (reset && reset.classList.contains('open')) { closeResetModal(); return; }
    const setup = document.getElementById('setup-modal');
    const cancelBtn = document.getElementById('setup-cancel-btn');
    if (setup && setup.classList.contains('open')
        && cancelBtn && cancelBtn.style.display !== 'none') {
      closeSetupModal();
    }
  });

  load();
  checkSetup();
});
})();
