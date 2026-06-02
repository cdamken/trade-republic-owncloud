<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Trade-Republic-Dashboard/app/orders.html (commits 7fcbe0b
 * + 66cc26d + a25f890). Same shape as the other ownCloud templates:
 *   1. Wrapped in <div id="tr-app" class="orders-page" data-route-*="...">.
 *   2. Inline <style> migrated to scoped #tr-app[.orders-page] rules in
 *      css/dashboard.css.
 *   3. Inline <script> moved into js/orders.js (ownCloud CSP blocks inline
 *      scripts). Shared helpers live in js/_shared.js (loaded by
 *      PageController before orders.js).
 *   4. CSV fetched via routes.data.replace('__TYPE__','transactions_csv')
 *      instead of `../DATA/account_transactions.csv`.
 */
?>
<div id="tr-app" class="orders-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-dividends="<?php p($routes['dividends']); ?>"
	data-route-orders="<?php p($routes['orders']); ?>"
	data-route-ledger="<?php p($routes['ledger']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-update="<?php p($routes['update']); ?>">

<div class="top-bar">
  <div class="brand">
    <div class="logo-box">📋</div>
    <h1>Trade Republic</h1>
  </div>
  <nav>
    <a href="<?php p($routes['index']); ?>">Portfolio</a>
    <a href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a href="<?php p($routes['orders']); ?>" class="active">📋 Orders</a>
    <a href="<?php p($routes['ledger']); ?>">📒 Ledger</a>
    <a href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
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

<div id="error-box"></div>

<!-- ---------- Summary cards ---------- -->
<div class="cards">
  <div class="card">
    <div class="label">Trades</div>
    <div class="value" id="card-total-trades">—</div>
    <div class="delta" id="card-total-trades-sub">in window</div>
  </div>
  <div class="card">
    <div class="label">Total bought</div>
    <div class="value blue" id="card-total-buy">—</div>
    <div class="delta muted">€ outflow (buys)</div>
  </div>
  <div class="card">
    <div class="label">Total sold</div>
    <div class="value purple" id="card-total-sell">—</div>
    <div class="delta muted">€ inflow (sells)</div>
  </div>
  <div class="card">
    <div class="label">Net flow</div>
    <div class="value" id="card-net">—</div>
    <div class="delta muted">sells − buys</div>
  </div>
</div>

<!-- ---------- All trades ---------- -->
<div class="section">
  <span>All trades</span>
  <span class="badge" id="trades-count">—</span>
</div>

<div class="controls">
  <input type="text" id="search" placeholder="Search by security or ISIN…">
  <select id="side-filter">
    <option value="">Buys + Sells</option>
    <option value="Buy">Buys only</option>
    <option value="Sell">Sells only</option>
  </select>
  <select id="month-filter">
    <option value="">All months</option>
  </select>
</div>

<table id="orders-table">
  <thead>
    <tr>
      <th data-sort="Date">Date</th>
      <th data-sort="Note">Security</th>
      <th>ISIN</th>
      <th data-sort="Type">Side</th>
      <th class="num">Amount (€)</th>
    </tr>
  </thead>
  <tbody id="trades-tbody"></tbody>
</table>

<div class="disclaimer">
  Trade Republic data via
  <a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
  Only filled trades — TR doesn't record cancelled or pending orders
  for personal accounts (no order book exposure).
</div>

</div>
