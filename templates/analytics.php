<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Trade-Republic-Dashboard/app/analytics.html body
 * (lines 72-189). Same changes as main.php:
 *   1. Wrapped in <div id="tr-app" class="analytics-page" data-route-*="...">.
 *   2. Inline on* handlers removed — addEventListener in analytics.js.
 *   3. <script src="https://cdn.jsdelivr.net/npm/chart.js"> from the
 *      upstream <head> is loaded by PageController::analytics() via
 *      Util::addScript('trade_republic', 'vendor/chart.umd.min.js') so the
 *      ownCloud CSP doesn't have to whitelist a CDN.
 */
?>
<div id="tr-app" class="analytics-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-data="<?php p($routes['data']); ?>">

<!-- Same top-bar + cockpit as main.php / settings.php / glossary.php -->
<div class="top-bar">
  <div class="brand">
    <div class="logo-box">📈</div>
    <h1>Trade Republic</h1>
  </div>
  <nav>
    <a href="<?php p($routes['index']); ?>">Portfolio</a>
    <a href="<?php p($routes['analytics']); ?>" class="active">Analytics</a>
    <a href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
    <a href="<?php p($routes['settings']); ?>">⚙ Settings</a>
    <a href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
  </nav>
  <div class="actions">
    <a class="ghost" href="<?php p($routes['index']); ?>#docs"
       style="text-decoration:none; display:inline-block; padding:8px 16px;
              background:transparent; color:var(--muted); border:1px solid var(--border);
              border-radius:8px; font-size:13px; font-weight:600;">📄 Documents</a>
    <a href="<?php p($routes['index']); ?>#update"
       style="text-decoration:none; display:inline-block; padding:8px 16px;
              background:var(--blue); color:var(--bg); border-radius:8px;
              font-size:13px; font-weight:600;">🔄 Update Now</a>
  </div>
</div>

<!-- Sticky cockpit — read-only, pulled from portfolio.json on load -->
<div class="cockpit">
  <div class="cockpit-row kpis">
    <div><div class="ck-label">Total Net Wealth</div><div class="ck-value big" id="ck-total">€0.00</div><div class="ck-sub" id="ck-total-sub">—</div></div>
    <div><div class="ck-label">Investment Cost</div><div class="ck-value" id="ck-cost">€0.00</div><div class="ck-sub">Sum of all buys</div></div>
    <div><div class="ck-label">Total P/L</div><div class="ck-value" id="ck-pl">€0.00</div><div class="ck-sub" id="ck-pl-pct">0.00%</div></div>
    <div><div class="ck-label">Available Cash</div><div class="ck-value asset-cash" id="ck-cash">€0.00</div><div class="ck-sub">To be reinvested</div></div>
  </div>
  <div class="cockpit-row buckets" id="ck-buckets"></div>
</div>

<!-- Cash Flow (external: TR ↔ outside world) -->
<div class="cf-card">
  <h2>Cash Flow — Money in &amp; out of the wealth</h2>
  <div class="cf-grid">
    <div class="cf-tile in">
      <div class="label">Deposits</div>
      <div class="value" id="cf-deposits">€0</div>
      <div class="sub"><span id="cf-deposits-count">0</span> transactions</div>
    </div>
    <div class="cf-tile in">
      <div class="label">Tax refunds</div>
      <div class="value" id="cf-refunds">€0</div>
      <div class="sub"><span id="cf-refunds-count">0</span> transactions</div>
    </div>
    <div class="cf-tile out">
      <div class="label">Withdrawals (to your bank)</div>
      <div class="value" id="cf-withdrawals" style="color: #fbbf24;">€0</div>
      <div class="sub"><span id="cf-withdrawals-count">0</span> transactions</div>
    </div>
    <div class="cf-tile out">
      <div class="label">Card spending (consumption)</div>
      <div class="value" id="cf-removals">€0</div>
      <div class="sub"><span id="cf-removals-count">0</span> transactions</div>
    </div>
  </div>
  <div class="cf-grid">
    <div class="cf-tile">
      <div class="label">Net capital in TR</div>
      <div class="value" id="cf-net" style="color: var(--blue);">€0</div>
      <div class="sub">Deposits + Tax refunds − Withdrawals</div>
    </div>
    <div class="cf-tile">
      <div class="label">Current value (portfolio + cash)</div>
      <div class="value" id="cf-current" style="color: var(--text);">€0</div>
    </div>
    <div class="cf-tile" id="cf-pl-tile">
      <div class="label">Lifetime P/L</div>
      <div class="value" id="cf-pl">€0</div>
      <div class="sub" id="cf-pl-pct">0.00%</div>
    </div>
    <div class="cf-tile">
      <div class="label">Avg monthly net flow</div>
      <div class="value" id="cf-avg-month" style="color: var(--text); font-size: 24px;">€0</div>
      <div class="sub" id="cf-month-count">0 months</div>
    </div>
  </div>
  <div class="cf-formula">
    <strong>Withdrawals</strong> are money moved from TR back to your own bank (still your money, just elsewhere).
    <strong>Card spending</strong> is lifestyle consumption funded from your TR cash balance.
    <strong>Net capital in TR</strong> = Deposits + Tax refunds − Withdrawals (the money you've committed to TR for investing).
    <strong>Lifetime P/L</strong> = Current value + Card spending − Net capital in TR − Investment income. Pure price appreciation on the capital you've committed.
  </div>

  <!-- Income forecast (Forward 12-month dividends + Yield on cost). 2026-06-01 —
       replaces the old Trading totals tiles which just repeated buys/sells totals
       already visible in net_traded. These two answer "what will I earn in the
       next year?" — actionable, unlike the gross flow numbers we used to show. -->
  <h2 style="margin-top: 32px;">Income forecast</h2>
  <div class="cf-grid">
    <div class="cf-tile in">
      <div class="label">Forward 12-mo dividends</div>
      <div class="value" id="cf-fwd-div">—</div>
      <div class="sub" id="cf-fwd-div-sub">Projection from last 12 months</div>
    </div>
    <div class="cf-tile">
      <div class="label">Yield on cost</div>
      <div class="value" id="cf-yoc" style="color: var(--blue);">—</div>
      <div class="sub">Forward dividends ÷ total cost basis</div>
    </div>
    <div class="cf-tile">
      <div class="label">Total stock purchases</div>
      <div class="value" id="cf-buys">€0</div>
      <div class="sub"><span id="cf-buys-count">0</span> buy orders</div>
    </div>
    <div class="cf-tile">
      <div class="label">Total stock sales</div>
      <div class="value" id="cf-sells">€0</div>
      <div class="sub"><span id="cf-sells-count">0</span> sell orders</div>
    </div>
  </div>
</div>

<!-- Top / Bottom contributors — which positions drove (or dragged) the P/L. -->
<div class="cf-card" style="margin-top: 24px;">
  <h2>Top contributors to P/L</h2>
  <p style="color: var(--muted); font-size: 12px; margin-bottom: 16px;">
    The 5 positions with the largest positive P/L and the 5 with the largest negative P/L.
    Tells you what's actually driving the total return number.
  </p>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
    <div>
      <h3 style="font-size: 13px; color: var(--green); text-transform: uppercase;
                 letter-spacing: 1px; font-weight: 600; margin-bottom: 8px;">
        🏆 Top winners
      </h3>
      <table id="contributors-top" style="font-size: 13px; width: 100%;">
        <thead>
          <tr style="color: var(--muted); font-size: 11px; text-transform: uppercase;">
            <th style="text-align: left;">Asset</th>
            <th class="num">P/L €</th>
            <th class="num">P/L %</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
    <div>
      <h3 style="font-size: 13px; color: var(--red); text-transform: uppercase;
                 letter-spacing: 1px; font-weight: 600; margin-bottom: 8px;">
        💔 Top losers
      </h3>
      <table id="contributors-bottom" style="font-size: 13px; width: 100%;">
        <thead>
          <tr style="color: var(--muted); font-size: 11px; text-transform: uppercase;">
            <th style="text-align: left;">Asset</th>
            <th class="num">P/L €</th>
            <th class="num">P/L %</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </div>
</div>

<div class="grid-top">
  <!-- 1. Assets Allocation -->
  <div class="card">
    <h2>Asset Allocation</h2>
    <div class="stat" id="alloc-total">€0.00</div>
    <div class="substat">Current capital distribution</div>
    <div class="chart-container"><canvas id="allocationChart"></canvas></div>
  </div>
  <!-- 2. Net Worth Evolution -->
  <div class="card">
    <h2>Net Worth Evolution</h2>
    <div class="stat" id="history-current">€0.00</div>
    <div class="substat" id="history-substat">Total portfolio value (positions + cash) over time</div>
    <div class="range-buttons" id="history-range">
      <button data-range="1W">1W</button>
      <button data-range="1M">1M</button>
      <button data-range="3M">3M</button>
      <button data-range="6M">6M</button>
      <button data-range="1Y">1Y</button>
      <button data-range="ALL" class="active">All</button>
    </div>
    <div class="chart-container" id="history-container">
      <canvas id="historyChart"></canvas>
    </div>
  </div>
</div>

<!-- Dividends + Interest are now in their own tab (templates/dividends.php).
     The redundant "Open Dividends" banner that used to live here was removed
     2026-06-01 — the tab is already in the top nav. -->


</div>
