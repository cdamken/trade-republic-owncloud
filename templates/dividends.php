<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Dividends & Interest page — port of Trade-Republic-Dashboard/app/dividends.html.
 *
 * Same shell pattern as the other pages:
 *   1. Wrapped in <div id="tr-app" class="dividends-page" data-route-*="...">.
 *   2. All page-specific styles live in css/dashboard.css under `.dividends-page`
 *      selectors (ownCloud CSP forbids large inline <style> blocks on every
 *      page, and we want the styles cached once across pages anyway).
 *   3. Inline on* handlers removed — addEventListener in dividends.js.
 *   4. Chart.js is loaded by PageController::dividends() via
 *      Util::addScript('vendor/chart.umd.min').
 */
?>
<div id="tr-app" class="dividends-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-dividends="<?php p($routes['dividends']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-update="<?php p($routes['update']); ?>">

<!-- Same top-bar + cockpit as main.php / analytics.php / settings.php / glossary.php -->
<div class="top-bar">
  <div class="brand">
    <div class="logo-box">📊</div>
    <h1>Trade Republic</h1>
  </div>
  <nav>
    <a href="<?php p($routes['index']); ?>">Portfolio</a>
    <a href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a href="<?php p($routes['orders']); ?>">📋 Orders</a>
    <a href="<?php p($routes['ledger']); ?>">📒 Ledger</a>
    <a href="<?php p($routes['dividends']); ?>" class="active">💰 Dividends</a>
    <a href="<?php p($routes['settings']); ?>">⚙ Settings</a>
    <a href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
  </nav>
  <div class="actions">
    <a class="ghost" href="<?php p($routes['index']); ?>#docs"
       style="text-decoration:none; display:inline-block; padding:8px 16px;
              background:transparent; color:var(--muted); border:1px solid var(--border);
              border-radius:8px; font-size:13px; font-weight:600;">📄 Documents</a>
    <button id="update-btn">🔄 Update Now</button>
  </div>
</div>

<!-- Sticky cockpit — same as everywhere else -->
<div class="cockpit">
  <div class="cockpit-row kpis">
    <div><div class="ck-label">Total Net Wealth</div><div class="ck-value big" id="ck-total">€0.00</div><div class="ck-sub" id="ck-total-sub">—</div></div>
    <div><div class="ck-label">Investment Cost</div><div class="ck-value" id="ck-cost">€0.00</div><div class="ck-sub">Sum of all buys</div></div>
    <div><div class="ck-label">Total P/L</div><div class="ck-value" id="ck-pl">€0.00</div><div class="ck-sub" id="ck-pl-pct">0.00%</div></div>
    <div><div class="ck-label">Available Cash</div><div class="ck-value asset-cash" id="ck-cash">€0.00</div><div class="ck-sub">To be reinvested</div></div>
  </div>
  <div class="cockpit-row buckets" id="ck-buckets"></div>
</div>

<!-- Page title -->
<div class="page-title">
  <h2>💰 Dividends &amp; Interest</h2>
  <span class="meta" id="range-label">Loading…</span>
</div>

<!-- 4 summary cards (GBM design) -->
<div class="summary-cards">
  <div class="summary-card">
    <div class="label">Total received (all-time)</div>
    <div class="value green" id="card-total-net">—</div>
    <div class="delta" id="card-total-detail">—</div>
  </div>
  <div class="summary-card">
    <div class="label">Dividends only</div>
    <div class="value" id="card-divs">—</div>
    <div class="delta" id="card-divs-detail">— payments</div>
  </div>
  <div class="summary-card">
    <div class="label">Interest (Tagesgeld+)</div>
    <div class="value purple" id="card-int">—</div>
    <div class="delta" id="card-int-detail">— payments</div>
  </div>
  <div class="summary-card">
    <div class="label">Paying issuers</div>
    <div class="value" id="card-issuers">—</div>
    <div class="delta" id="card-issuers-detail">unique ISINs</div>
  </div>
</div>

<div class="dividends-note">
  <strong>About tax retention:</strong> Trade Republic does not expose
  Kapitalertragsteuer / Solidaritätszuschlag per individual payment in the
  API. The amounts shown here are <strong>gross of German withholding</strong>.
  For the actual tax retained, see your annual
  <em>Steuerbescheinigung</em> (📄 Documents → year → tax_statement).
</div>

<!-- Monthly evolution chart -->
<div class="chart-card">
  <div class="chart-card-header">
    <h3>Monthly evolution</h3>
    <div class="range-pills" id="range-pills">
      <button data-range="3">3M</button>
      <button data-range="6">6M</button>
      <button data-range="9">9M</button>
      <button data-range="12" class="active">12M</button>
      <button data-range="all">All</button>
    </div>
  </div>
  <div class="chart-container"><canvas id="monthlyChart"></canvas></div>
</div>

<!-- Detail ledger -->
<div class="section">
  <span>Payment ledger</span>
  <span class="badge" id="rows-count">—</span>
</div>

<div class="div-controls">
  <input type="text" id="div-search" placeholder="Search issuer / ISIN…">
  <select id="div-kind-filter">
    <option value="">All movements</option>
    <option value="Dividend">Dividends only</option>
    <option value="Interest">Interest only</option>
  </select>
  <select id="div-month-filter">
    <option value="">All months</option>
  </select>
  <select id="div-issuer-filter">
    <option value="">All issuers</option>
  </select>
</div>

<table id="payments-table" class="dividends-table">
  <thead>
    <tr>
      <th data-sort="date">Date</th>
      <th data-sort="name">Issuer</th>
      <th>ISIN</th>
      <th>Type</th>
      <th class="num" data-sort="amount">Amount</th>
    </tr>
  </thead>
  <tbody id="payments-tbody"></tbody>
</table>

<div class="dividends-disclaimer">
  Dashboard for personal use · data via
  <a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
  Shows every payment Trade Republic classifies as a dividend or interest payout.
</div>

</div>
