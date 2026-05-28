<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Trade-Republic-Dashboard/app/index.html (lines 183-411).
 * Two unavoidable changes:
 *   1. Wrapped in <div id="tr-app" data-route-*="..."> so JS reads URLs
 *      from data-attributes (ownCloud CSP forbids inline <script>).
 *   2. Inline on* handlers stripped — re-wired via addEventListener in
 *      js/dashboard.js. Same logic, same behaviour.
 * Inline style="..." attributes are kept; PageController allows them in CSP.
 */
?>
<div id="tr-app"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-config="<?php p($routes['config']); ?>"
	data-route-update="<?php p($routes['update']); ?>"
	data-route-reset="<?php p($routes['reset']); ?>"
	data-route-download-docs="<?php p($routes['downloadDocs']); ?>">

<h1>
  <div class="logo-box">📊</div>
  Trade Republic Portfolio
</h1>

<div class="nav" style="justify-content: space-between; align-items: center;">
  <div style="display: flex; gap: 12px;">
    <a href="<?php p($routes['index']); ?>" class="active">Portfolio</a>
    <a href="<?php p($routes['analytics']); ?>">Analytics</a>
  </div>
  <div style="display:flex; gap:10px; align-items:center;">
    <button id="update-btn" class="update-btn">
      <span class="spinner"></span><span class="icon">🔄</span><span class="label">Update Now</span>
    </button>
    <button id="docs-btn" class="update-btn"
            style="background:transparent; color:var(--muted); border:1px solid var(--border); font-weight:500;"
            title="Download every PDF Trade Republic has issued for this account (trades, dividends, statements, tax docs). Files appear in your Files app under trade_republic/documents/.">
      📄 Documents
    </button>
    <button id="setup-open-btn" class="update-btn" style="background:transparent; color:var(--muted); border:1px solid var(--border); font-weight:500;"
            title="Change phone / PIN, or switch to a different account">
      ⚙️ Account
    </button>
    <span id="update-status" class="update-status" style="display:none"></span>
  </div>
</div>

<p class="subtitle">Data extracted via <a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener" style="color:var(--muted); text-decoration:underline;">tr-api</a> (WebSocket TR). <span id="ts"></span></p>

<!-- ============ MFA Modal ============ -->
<div id="mfa-modal" class="modal-backdrop">
  <div class="modal">
    <h3>🔐 Trade Republic Security Code</h3>
    <p>Your session expired. Trade Republic needs to verify it's you.</p>
    <div class="hint">
      📱 <strong>Open the Trade Republic app</strong> on your phone — Trade Republic
      just pushed a 4-digit code.<br>
      ⏱ The code expires in ~60 seconds.
    </div>
    <input type="text" id="mfa-input" inputmode="numeric" pattern="[0-9]*" maxlength="4"
           autocomplete="one-time-code" placeholder="0000">
    <div id="mfa-err" class="err-msg"></div>
    <label for="mfa-full-reload"
           style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;
                  background:rgba(255,255,255,0.03); border:1px solid var(--border);
                  border-radius:10px; padding:12px 14px; margin-top:14px; margin-bottom:6px;
                  font-size:13px; color:var(--muted); line-height:1.45;">
      <input type="checkbox" id="mfa-full-reload"
             style="margin-top:2px; width:18px; height:18px; accent-color:#3b82f6; flex-shrink:0;">
      <span>
        <strong style="color:var(--text);">↻ Full Reload</strong> — wipe the local cache
        (portfolio + transaction history) and re-download everything from Trade Republic.<br>
        <span style="opacity:.8;">Use this if the numbers look off. Takes ~1–3 min.
        Your login is kept; you only enter the code once.</span>
      </span>
    </label>
    <div class="modal-actions">
      <button id="mfa-cancel-btn" class="btn-cancel">Cancel</button>
      <button id="mfa-submit-btn" class="btn-submit">Submit</button>
    </div>
  </div>
</div>

<!-- ============ Reset / Switch Account Modal ============ -->
<div id="reset-modal" class="modal-backdrop">
  <div class="modal">
    <h3>⚠️ Switch to a different account?</h3>
    <p>This will <strong>erase</strong> everything related to the current Trade Republic account:</p>
    <div class="hint" style="background:rgba(248,113,113,0.08); border-left-color:var(--red); color:var(--text);">
      • Your saved phone + PIN<br>
      • Your Trade Republic session cookies<br>
      • Your downloaded portfolio, transactions, history and analytics<br>
      <br>
      The wizard will start over to configure a new account. <strong>This cannot be undone.</strong>
    </div>
    <p style="font-size:13px; color:var(--muted); margin-bottom:16px;">
      Type <code style="color:var(--red);">delete</code> below to confirm:
    </p>
    <input type="text" id="reset-confirm" placeholder="delete"
           style="width:100%; background:var(--bg); border:2px solid var(--border); color:var(--text); padding:14px 16px; font-size:18px; border-radius:10px; font-family:monospace; margin-bottom:16px; text-align:center;"
           autocomplete="off">
    <div id="reset-err" class="err-msg"></div>
    <div class="modal-actions">
      <button id="reset-cancel-btn" class="btn-cancel">Cancel</button>
      <button id="reset-submit-btn" class="btn-submit" disabled
              style="background:var(--red); color:#fff;">Erase &amp; switch</button>
    </div>
  </div>
</div>

<!-- ============ Setup / Account Settings Modal ============ -->
<div id="setup-modal" class="modal-backdrop">
  <div class="modal" style="max-width: 480px;">
    <h3 id="setup-title">👋 Welcome — first-time setup</h3>
    <p id="setup-intro">To connect to Trade Republic, this dashboard needs your TR <strong>phone number</strong> and <strong>PIN</strong>.</p>
    <div class="hint">
      🔒 Stored encrypted in your ownCloud profile (PIN with <code>ICrypto</code>).<br>
      🚫 Never sent anywhere except the official Trade Republic API.<br>
      ↻ Changing the phone wipes the current dashboard data (so the new
      account doesn't see stale holdings). Changing only the PIN keeps the
      data but forces a fresh login.
    </div>
    <label style="display:block; color:var(--muted); font-size:12px; margin-bottom:6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Phone (international format)</label>
    <input type="tel" id="setup-phone" placeholder="+4912345678"
           style="width:100%; background:var(--bg); border:2px solid var(--border); color:var(--text); padding:14px 16px; font-size:18px; border-radius:10px; font-family:monospace; margin-bottom:16px;"
           autocomplete="tel">
    <label style="display:block; color:var(--muted); font-size:12px; margin-bottom:6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">PIN (4 digits)</label>
    <input type="password" id="setup-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6"
           placeholder="••••"
           style="width:100%; background:var(--bg); border:2px solid var(--border); color:var(--text); padding:14px 16px; font-size:24px; border-radius:10px; text-align:center; letter-spacing:8px; font-family:monospace; margin-bottom:16px;">
    <div id="setup-err" class="err-msg"></div>
    <div class="modal-actions">
      <button id="setup-cancel-btn" class="btn-cancel" style="display:none;">Cancel</button>
      <button id="setup-submit-btn" class="btn-submit" style="width:100%;">Continue →</button>
    </div>
    <!-- "Switch account" link, only visible in edit-existing mode (toggled by JS) -->
    <div id="setup-reset-link" style="display:none; margin-top:16px; text-align:center;">
      <a href="#" id="setup-open-reset" style="color:var(--red); font-size:12px; text-decoration:underline;">Switch to a different account…</a>
    </div>
  </div>
</div>

<!-- ============ Progress overlay (during /update fetches) ============ -->
<div class="progress-overlay" id="progress-overlay">
  <div class="progress-box">
    <div class="progress-spinner"></div>
    <h2 id="progress-title">Updating your portfolio</h2>
    <div class="progress-stage" id="progress-stage">Connecting to Trade Republic…</div>
    <div class="progress-hint">
      This usually takes 30 seconds to 2 minutes.<br>
      Please don't close this tab.
    </div>
    <div class="progress-elapsed" id="progress-elapsed">0s</div>
  </div>
</div>

<div class="warning" id="warning" style="display:none"></div>

<div class="cards" id="cards"></div>

<div class="section" data-toggle="winners">
  <span class="toggle-icon">▼</span> 🏆 Top Winners <span class="badge" id="winners-count">0</span>
</div>
<table id="winners">
  <thead>
    <tr>
      <th data-sort="name">Asset</th>
      <th data-sort="isin">ISIN</th>
      <th class="num" data-sort="quantity">Qty</th>
      <th class="num" data-sort="net_value_eur">Value</th>
      <th class="num" data-sort="pl_eur">P/L €</th>
      <th class="num" data-sort="pl_pct">P/L %</th>
    </tr>
  </thead>
  <tbody></tbody>
</table>

<div class="section" data-toggle="losers">
  <span class="toggle-icon">▼</span> 💔 Top Losers <span class="badge" id="losers-count">0</span>
</div>
<table id="losers">
  <thead>
    <tr>
      <th data-sort="name">Asset</th>
      <th data-sort="isin">ISIN</th>
      <th class="num" data-sort="quantity">Qty</th>
      <th class="num" data-sort="net_value_eur">Value</th>
      <th class="num" data-sort="pl_eur">P/L €</th>
      <th class="num" data-sort="pl_pct">P/L %</th>
    </tr>
  </thead>
  <tbody></tbody>
</table>

<div class="section" data-toggle="all-container">
  <span class="toggle-icon">▼</span> 📋 All Positions <span class="badge" id="total-count">0</span>
</div>

<div id="all-container">
  <div class="controls">
    <input type="text" id="search" placeholder="Search name or ISIN...">
    <select id="bucketFilter">
      <option value="all">All value ranges</option>
      <option value="over_2000">Over €2,000</option>
      <option value="range_500_2000">€500–€2,000</option>
      <option value="range_100_500">€100–€500</option>
      <option value="range_20_100">€20–€100</option>
      <option value="under_20">Under €20</option>
    </select>
    <select id="plFilter">
      <option value="all">All P/L</option>
      <option value="winners">Winners (+)</option>
      <option value="losers">Losers (-)</option>
      <option value="big_winners">Winners &gt;50%</option>
      <option value="big_losers">Losers &gt;25%</option>
    </select>
  </div>

  <table id="all">
    <thead>
      <tr>
        <th data-sort="name">Name</th>
        <th data-sort="isin">ISIN</th>
        <th class="num" data-sort="quantity">Qty</th>
        <th class="num" data-sort="avg_cost">Avg Cost</th>
        <th class="num" data-sort="current_price">Price</th>
        <th class="num" data-sort="buy_cost_eur">Invested</th>
        <th class="num" data-sort="net_value_eur">Net Value</th>
        <th class="num" data-sort="pl_eur">P/L €</th>
        <th class="num" data-sort="pl_pct">P/L %</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</div>

</div>
