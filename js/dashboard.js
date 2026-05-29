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

const fmt = (n, d=2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtEUR = (n) => '€' + fmt(n);
const fmtPct = (n) => (n >= 0 ? '+' : '') + fmt(n, 1) + '%';

function toggleSection(id) {
  const el = document.getElementById(id);
  const section = el.previousElementSibling;
  section.classList.toggle('collapsed');
  el.classList.toggle('hidden');
}

// ============ Update flow (POST routes.update + MFA modal) ============
const updateBtn = () => document.getElementById('update-btn');
const updateStatus = () => document.getElementById('update-status');
const setUpdateBtn = (loading, label) => {
  const b = updateBtn();
  b.disabled = loading;
  b.classList.toggle('loading', loading);
  b.querySelector('.label').textContent = label || 'Update Now';
};
const showStatus = (kind, msg) => {
  const s = updateStatus();
  s.className = 'update-status ' + kind;
  s.textContent = msg;
  s.style.display = 'inline-block';
  if (kind === 'ok') setTimeout(() => { s.style.display = 'none'; }, 5000);
};

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

function showProgressOverlay(opts) {
  const stages = (opts && opts.full) ? PROGRESS_STAGES_FULL : PROGRESS_STAGES_NORMAL;
  document.getElementById('progress-overlay').classList.add('show');
  document.getElementById('progress-title').textContent =
    (opts && opts.full) ? 'Re-downloading everything from scratch' : 'Updating your portfolio';
  document.getElementById('progress-stage').textContent = stages[0].text;
  document.getElementById('progress-elapsed').textContent = '0s';
  _progressStartedAt = Date.now();
  _progressTimer = setInterval(() => {
    const elapsed = (Date.now() - _progressStartedAt) / 1000;
    const stage = stages.find(s => elapsed < s.until) || stages[stages.length - 1];
    const stageEl = document.getElementById('progress-stage');
    if (stageEl.textContent !== stage.text) stageEl.textContent = stage.text;
    document.getElementById('progress-elapsed').textContent =
      elapsed < 60 ? `${Math.floor(elapsed)}s`
                   : `${Math.floor(elapsed / 60)}m ${Math.floor(elapsed) % 60}s`;
  }, 500);
}

function hideProgressOverlay() {
  document.getElementById('progress-overlay').classList.remove('show');
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  _progressStartedAt = null;
}

async function downloadDocs() {
  // Bulk-download every PDF Trade Republic has issued for this user into
  // their per-user data dir. Files appear inside ownCloud's Files app at
  // trade_republic/documents/<YYYY>/<kind>/ automatically. Idempotent on
  // re-runs (skips files already on disk). Server pre-checks session
  // liveness so we fail fast with auth_required when cookies died.
  if (!confirm(
    'Download every PDF (trades, dividends, statements, tax) into your\n' +
    'Files app under Trade_Republic_Docs/<year>/<kind>/?\n\n' +
    'First run can take a few minutes. Re-runs only fetch what is missing.'
  )) {
    return;
  }
  const btn = document.getElementById('docs-btn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="display:inline-block"></span> Downloading…';
  showStatus('', 'Walking timeline + downloading PDFs…');
  try {
    const r = await fetch(routes.downloadDocs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
      body: JSON.stringify({}),
    });
    const data = await r.json();
    if (r.ok && data.status === 'ok') {
      const c = data.counts || {};
      const downloaded = c.downloaded || 0;
      const skipped    = c.skipped_existing || 0;
      const errors     = c.error || 0;
      const total      = c.total || 0;
      const summary = `${downloaded} new, ${skipped} already present` +
                      (errors ? `, ${errors} errors` : '') +
                      ` (of ${total} total)`;
      showStatus('ok', '✓ ' + summary);
      alert(
        '✓ Documents downloaded\n\n' +
        summary + '\n\n' +
        'Your PDFs are now in your Files app under:\n' +
        '   📁 Trade_Republic_Docs/<year>/<kind>/\n\n' +
        '(Refresh the Files page if you do not see them immediately.)'
      );
    } else if (data.status === 'auth_required') {
      showStatus('err', 'Session expired');
      const want = confirm(
        'Your Trade Republic session expired.\n\n' +
        'Click OK to re-authenticate now (we will open the security-code\n' +
        'prompt — same flow as Update Now). Then try Documents again.'
      );
      if (want) {
        updateData();
      }
    } else if (data.status === 'rate_limited') {
      showStatus('err', 'Rate limited by Trade Republic');
      alert('Trade Republic rate-limited us. Wait a few minutes and try again.');
    } else {
      showStatus('err', 'Download failed');
      alert('Download failed: ' + (data.detail || data.status || 'unknown error'));
    }
  } catch (e) {
    showStatus('err', 'Network error');
    alert('Download error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
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
      setTimeout(() => location.reload(), 800);
      return;
    }
    cleanupOverlay();
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
  document.getElementById('ts').textContent = 'Last update: ' + new Date().toLocaleString();

  const s = state.data.summary;
  document.getElementById('cards').innerHTML = `
    <div class="card"><div class="label">Total Net Value</div>
      <div class="value blue">${fmtEUR(s.total_netvalue)}</div>
      <div class="delta">Depot ${fmtEUR(s.depot_netvalue)} + Cash ${fmtEUR(s.cash_eur)}</div></div>
    <div class="card"><div class="label">Total Investment Cost</div>
      <div class="value">${fmtEUR(s.depot_buycost)}</div>
      <div class="delta">Sum of all buys</div></div>
    <div class="card"><div class="label">Total P/L</div>
      <div class="value">${fmtEUR(s.depot_pl_eur)}</div>
      <div class="delta">${fmtPct(s.depot_pl_pct)}</div></div>
    <div class="card"><div class="label">Active Positions</div>
      <div class="value">${state.data.positions_with_value}</div>
      <div class="delta">+ ${state.data.zero_value_positions.length} with no price</div></div>
    <div class="card"><div class="label">Available Cash</div>
      <div class="value asset-cash">${fmtEUR(s.cash_eur)}</div>
      <div class="delta">To be reinvested</div></div>
  `;

  // Wealth breakdown by TR bucket — mirrors what the official app shows
  // as separate tiles (Brokerage / Bonds / Private Equity / etc.).
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

// Build external-research links for an ISIN. TR's own instrument page,
// Yahoo Finance, Stock Analysis — all permalink-based, no API calls.
function externalLinks(isin) {
  if (!isin) return '';
  const tr = `https://app.traderepublic.com/instrument/${encodeURIComponent(isin)}`;
  const yahoo = `https://finance.yahoo.com/lookup/?s=${encodeURIComponent(isin)}`;
  const sa = `https://stockanalysis.com/quote/iso/${encodeURIComponent(isin)}`;
  return `<span class="ext-links">` +
    `<a href="${tr}" target="_blank" rel="noopener" title="Open on Trade Republic">TR</a>` +
    `<a href="${yahoo}" target="_blank" rel="noopener" title="Look up on Yahoo Finance">Y!</a>` +
    `<a href="${sa}" target="_blank" rel="noopener" title="Look up on Stock Analysis">SA</a>` +
    `</span>`;
}

function rowHTML(p) {
  // Sign-only P/L (no green/red).
  return `<tr>
    <td title="${p.name}">${p.name}</td>
    <td><code style="font-size:11px;color:var(--muted)">${p.isin}</code>${externalLinks(p.isin)}</td>
    <td class="num">${fmt(p.quantity, 4)}</td>
    <td class="num">${fmtEUR(p.avg_cost)}</td>
    <td class="num">${fmtEUR(p.current_price)}</td>
    <td class="num">${fmtEUR(p.buy_cost_eur)}</td>
    <td class="num"><strong>${fmtEUR(p.net_value_eur)}</strong></td>
    <td class="num">${fmtEUR(p.pl_eur)}</td>
    <td class="num"><strong>${fmtPct(p.pl_pct)}</strong></td>
  </tr>`;
}

function shortRow(p) {
  return `<tr>
    <td title="${p.name}">${p.name}</td>
    <td><code style="font-size:11px;color:var(--muted)">${p.isin}</code>${externalLinks(p.isin)}</td>
    <td class="num">${fmt(p.quantity, 4)}</td>
    <td class="num"><strong>${fmtEUR(p.net_value_eur)}</strong></td>
    <td class="num">${fmtEUR(p.pl_eur)}</td>
    <td class="num"><strong>${fmtPct(p.pl_pct)}</strong></td>
  </tr>`;
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

function renderWealthBuckets(summary) {
  // Render one tile per TR bucket (stocksAndETFs / cryptos / bonds /
  // privateMarkets / others) + a Cash tile. Matches TR's mobile "Wealth"
  // screen separation. Hidden gracefully when by_category absent (e.g.
  // pre-upgrade portfolio.json from before this feature).
  const by = summary.by_category || {};
  const container = document.getElementById('wealth-buckets');
  const section = document.getElementById('wealth-buckets-section');
  if (!container || !section) return;

  // Each asset class gets its own consistent color across the app.
  // See css/dashboard.css :root for the palette definition.
  const labels = {
    stocksAndETFs:  { name: 'Brokerage (Stocks/ETFs)', icon: '📈', color: 'asset-equity' },
    bonds:          { name: 'Bonds',                   icon: '🏛',  color: 'asset-bonds'  },
    privateMarkets: { name: 'Private Equity',          icon: '🔒', color: 'asset-pe'     },
    cryptos:        { name: 'Crypto',                  icon: '🪙', color: 'asset-crypto' },
    others:         { name: 'Others',                  icon: '·',  color: 'asset-other'  },
  };
  const order = ['stocksAndETFs','bonds','privateMarkets','cryptos','others'];

  const tiles = [];
  for (const key of order) {
    const b = by[key];
    if (!b || !b.count) continue;
    const meta = labels[key] || { name: key, icon: '·', color: '' };
    // P/L: sign only (no color) — user preference 2026-05-28.
    tiles.push(
      '<div class="card">' +
      '<div class="label">' + meta.icon + ' ' + meta.name + '</div>' +
      '<div class="value ' + meta.color + '">' + fmtEUR(b.net_value_eur) + '</div>' +
      '<div class="delta">' + b.count + ' position' + (b.count === 1 ? '' : 's') +
        ' · cost ' + fmtEUR(b.buy_cost_eur) +
        ' <span style="margin-left:6px">' + fmtPct(b.pl_pct) + '</span>' +
      '</div></div>'
    );
  }
  tiles.push(
    '<div class="card">' +
    '<div class="label">💶 Cash</div>' +
    '<div class="value asset-cash">' + fmtEUR(summary.cash_eur) + '</div>' +
    '<div class="delta">Available to invest / withdraw</div>' +
    '</div>'
  );

  container.innerHTML = '<div class="cards">' + tiles.join('') + '</div>' +
    '<p style="color:var(--muted); font-size:0.85em; margin-top:6px;">' +
      'Sum of all tiles above = <strong>' + fmtEUR(summary.total_netvalue) + '</strong>' +
      ' (matches the Total Net Value card).</p>';
  section.style.display = '';
  container.style.display = '';
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
    index:     root.dataset.routeIndex,
    analytics: root.dataset.routeAnalytics,
    data:      root.dataset.routeData,
    config:    root.dataset.routeConfig,
    update:        root.dataset.routeUpdate,
    reset:         root.dataset.routeReset,
    downloadDocs:  root.dataset.routeDownloadDocs,
  };

  document.getElementById('update-btn').addEventListener('click', updateData);
  document.getElementById('docs-btn').addEventListener('click', downloadDocs);
  document.getElementById('setup-open-btn').addEventListener('click', openSetupModal);

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
