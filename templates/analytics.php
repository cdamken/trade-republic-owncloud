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
	data-route-data="<?php p($routes['data']); ?>">

<h1><div class="logo-box">📈</div> Trade Republic Analytics</h1>
<div class="nav">
  <a href="<?php p($routes['index']); ?>">Portfolio</a>
  <a href="<?php p($routes['analytics']); ?>" class="active">Analytics</a>
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
      <div class="label">Card spending (out)</div>
      <div class="value" id="cf-removals">€0</div>
      <div class="sub"><span id="cf-removals-count">0</span> transactions</div>
    </div>
    <div class="cf-tile">
      <div class="label">Net capital in TR</div>
      <div class="value" id="cf-net" style="color: var(--blue);">€0</div>
      <div class="sub">Inflows − Outflows</div>
    </div>
  </div>
  <div class="cf-grid">
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
    <div class="cf-tile">
      <div class="label">Last deposit</div>
      <div class="value" id="cf-last-deposit" style="color: var(--text); font-size: 20px;">—</div>
      <div class="sub" id="cf-last-deposit-date">—</div>
    </div>
  </div>
  <div class="cf-formula">
    <strong>Net capital in TR</strong> = Deposits + Tax refunds − Card spending.
    <strong>Lifetime P/L</strong> = Current value − Net capital in TR. Reflects real gains/losses on what actually remains working inside the wealth.
  </div>

  <!-- Trading totals (raw numbers, no chart) -->
  <h2 style="margin-top: 32px;">Trading totals</h2>
  <div class="cf-grid">
    <div class="cf-tile out">
      <div class="label">Total stock purchases</div>
      <div class="value" id="cf-buys">€0</div>
      <div class="sub"><span id="cf-buys-count">0</span> buy orders</div>
    </div>
    <div class="cf-tile in">
      <div class="label">Total stock sales</div>
      <div class="value" id="cf-sells">€0</div>
      <div class="sub"><span id="cf-sells-count">0</span> sell orders</div>
    </div>
    <div class="cf-tile">
      <div class="label">Net traded</div>
      <div class="value" id="cf-net-traded" style="color: var(--blue);">€0</div>
      <div class="sub">Purchases − sales (money parked in positions)</div>
    </div>
  </div>

  <div style="height: 260px; margin-top: 24px;"><canvas id="cashFlowChart"></canvas></div>
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

<div class="grid-bottom">
  <!-- 3. Monthly Dividends -->
  <div class="card">
    <h2>Monthly Dividends</h2>
    <div class="stat" id="div-total">€0.00</div>
    <div class="chart-container"><canvas id="dividendChart"></canvas></div>
  </div>
  <!-- 4. Recent Payments -->
  <div class="card">
    <h2>Recent Payments</h2>
    <div class="substat">Last 10 received items</div>
    <table id="recent-divs"></table>
  </div>
</div>

</div>
