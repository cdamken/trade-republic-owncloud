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
	data-update-flow-owner="page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-config="<?php p($routes['config']); ?>"
	data-route-update="<?php p($routes['update']); ?>"
	data-route-reset="<?php p($routes['reset']); ?>"
	data-route-download-docs="<?php p($routes['downloadDocs']); ?>">

<!-- New unified top-bar + sticky cockpit (same shell on every page) -->
<div class="top-bar">
  <div class="brand">
    <div class="logo-box">📊</div>
    <h1>Trade Republic</h1>
  </div>
  <nav>
    <a href="<?php p($routes['index']); ?>" class="active">Portfolio</a>
    <a href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a href="<?php p($routes['orders']); ?>">📋 Orders</a>
    <a href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
    <a href="<?php p($routes['ledger']); ?>">📒 Ledger</a>
    <a href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
    <a href="<?php p($routes['settings']); ?>">⚙ Settings</a>
  </nav>
  <div class="actions">
    <button id="docs-btn" class="ghost"
            title="Download every PDF TR has issued (trades, dividends, statements, tax). Files appear in your Files app under Trade_Republic_Docs/&lt;year&gt;/&lt;kind&gt;/.">
      📄 Documents
    </button>
    <button id="update-btn">🔄 Update Now</button>
  </div>
</div>

<!-- Thin non-blocking progress bar at top of viewport -->
<div id="progress-bar" class="progress-bar"></div>

<!-- Status banner — top-center, non-blocking (replaces dim overlay) -->
<div id="toast" class="toast">
  <button id="toast-close-btn" class="t-close" aria-label="Close">×</button>
  <div class="t-title"><span class="spin"></span> <span id="toast-title">Updating information…</span></div>
  <div class="t-stage" id="toast-stage">Connecting…</div>
</div>

<!-- Sticky cockpit — 5 KPIs + 5 bucket pills (populated by dashboard.js) -->
<div class="cockpit">
  <div class="cockpit-row kpis">
    <div>
      <div class="ck-label">Total Net Wealth</div>
      <div class="ck-value big" id="ck-total">€0.00</div>
      <div class="ck-sub" id="ck-total-sub">—</div>
    </div>
    <div>
      <div class="ck-label">Investment Cost</div>
      <div class="ck-value" id="ck-cost">€0.00</div>
      <div class="ck-sub">Sum of all buys</div>
    </div>
    <div>
      <div class="ck-label">Total P/L</div>
      <div class="ck-value" id="ck-pl">€0.00</div>
      <div class="ck-sub" id="ck-pl-pct">0.00%</div>
    </div>
    <div title="Annualized money-weighted return (XIRR). Uses all external cash flows (deposits + tax refunds minus withdrawals) plus today's portfolio value as the terminal flow. Unlike P/L %, this is time-aware: capital that worked longer counts more.">
      <div class="ck-label">XIRR (annualized)</div>
      <div class="ck-value" id="ck-xirr">—</div>
      <div class="ck-sub" id="ck-xirr-sub">money-weighted</div>
    </div>
    <div>
      <div class="ck-label">Available Cash</div>
      <div class="ck-value asset-cash" id="ck-cash">€0.00</div>
      <div class="ck-sub">To be reinvested</div>
    </div>
  </div>
  <div class="cockpit-row buckets" id="ck-buckets"></div>
</div>

<p class="subtitle">Data extracted via <a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener" style="color:var(--muted); text-decoration:underline;">tr-api</a> (WebSocket TR). <span id="ts"></span> <span id="last-update-age" class="staleness-chip"></span></p>

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
           name="tr_mfa_<?php echo bin2hex(random_bytes(4)); ?>"
           autocomplete="one-time-code"
           data-lpignore="true" data-1p-ignore data-bwignore placeholder="0000">
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
    <!-- Hidden dummy inputs absorb the browser's ownCloud-credential autofill
         so it doesn't drop them in our TR-specific fields. Plus non-standard
         field names + autocomplete="new-password" + data-lpignore for LastPass. -->
    <input type="text" name="username_dummy_<?php echo bin2hex(random_bytes(4)); ?>"
           style="display:none" tabindex="-1" autocomplete="username">
    <input type="password" name="password_dummy_<?php echo bin2hex(random_bytes(4)); ?>"
           style="display:none" tabindex="-1" autocomplete="new-password">

    <label style="display:block; color:var(--muted); font-size:12px; margin-bottom:6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Phone (international format)</label>
    <input type="tel" id="setup-phone" placeholder="+4912345678"
           name="tr_phone_<?php echo bin2hex(random_bytes(4)); ?>"
           style="width:100%; background:var(--bg); border:2px solid var(--border); color:var(--text); padding:14px 16px; font-size:18px; border-radius:10px; font-family:monospace; margin-bottom:16px;"
           autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore>
    <label style="display:block; color:var(--muted); font-size:12px; margin-bottom:6px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">PIN (4 digits)</label>
    <!-- type="text" + CSS mask so neither Chrome nor macOS Passwords
         treats this as a credential and offers to save it. -->
    <input type="text" id="setup-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6"
           placeholder="••••"
           class="pin-mask"
           name="tr_pin_<?php echo bin2hex(random_bytes(4)); ?>"
           style="width:100%; background:var(--bg); border:2px solid var(--border); color:var(--text); padding:14px 16px; font-size:24px; border-radius:10px; text-align:center; letter-spacing:8px; font-family:monospace; margin-bottom:16px;"
           autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore>
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

<!-- Old .cards (Total Net Value / Cost / P/L / etc.) moved to the cockpit above.
     Wealth-by-Bucket strip is also in the cockpit now. -->

<div id="concentration" class="concentration" style="display:none"></div>

<!-- Position detail modal (wired via event delegation in dashboard.js) -->
<div id="position-modal" class="position-modal-backdrop">
  <div class="position-modal-panel">
    <div class="position-modal-header">
      <h3 id="position-modal-title">—</h3>
      <code id="position-modal-isin">—</code>
      <button id="position-modal-close-btn" class="position-modal-close" title="Close (Esc)">✕</button>
    </div>
    <div id="position-modal-body" class="position-modal-body"></div>
    <div class="position-modal-links" id="position-modal-links"></div>
  </div>
</div>

<div class="section" id="wealth-buckets-section" style="display:none" data-toggle="wealth-buckets">
  <span class="toggle-icon">▼</span> 💼 Wealth by Bucket
  <span style="color:var(--muted); font-weight:400; font-size:0.85em; margin-left:8px;">
    matches the tiles in Trade Republic's official Wealth screen
  </span>
</div>
<div id="wealth-buckets" style="display:none"></div>

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
