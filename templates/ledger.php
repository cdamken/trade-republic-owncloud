<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Trade-Republic-Dashboard/app/ledger.html (commits a401156
 * + 66cc26d + a25f890). Sibling of templates/orders.php — same shape, broader
 * dataset (every CSV row, not just Buy/Sell).
 */
?>
<div id="tr-app" class="ledger-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-dividends="<?php p($routes['dividends']); ?>"
	data-route-orders="<?php p($routes['orders']); ?>"
	data-route-ledger="<?php p($routes['ledger']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-update="<?php p($routes['update']); ?>">

<!-- Unified top-bar — see templates/partials/_top_bar.php -->
<?php
$activeNav = 'ledger';
$logoEmoji = '📒';
include __DIR__ . '/partials/_top_bar.php';
?>

<div id="error-box"></div>

<!-- ---------- Summary cards (per category) ---------- -->
<div class="cards">
  <div class="card">
    <div class="label">Total events</div>
    <div class="value" id="card-total">—</div>
    <div class="delta muted">all categories</div>
  </div>
  <div class="card">
    <div class="label">Cash flow (net)</div>
    <div class="value" id="card-cashflow">—</div>
    <div class="delta muted">deposits − withdrawals − removals + tax refund</div>
  </div>
  <div class="card">
    <div class="label">Dividends + interest</div>
    <div class="value pl-pos" id="card-income">—</div>
    <div class="delta muted">passive income</div>
  </div>
  <div class="card">
    <div class="label">Card spending</div>
    <div class="value pl-neg" id="card-spending">—</div>
    <div class="delta muted">Removal — TR card</div>
  </div>
</div>

<!-- ---------- All events ---------- -->
<div class="section">
  <span>All events</span>
  <span class="badge" id="events-count">—</span>
</div>

<div class="controls">
  <input type="text" id="search" placeholder="Search by security, ISIN or note…">
  <select id="type-filter">
    <option value="">All categories</option>
    <option value="Buy">Buy</option>
    <option value="Sell">Sell</option>
    <option value="Dividend">Dividend</option>
    <option value="Interest">Interest</option>
    <option value="Deposit">Deposit</option>
    <option value="Withdrawal">Withdrawal</option>
    <option value="Removal">Removal (card)</option>
    <option value="Tax Refund">Tax Refund</option>
  </select>
  <select id="month-filter">
    <option value="">All months</option>
  </select>
  <select id="page-size">
    <option value="999999" selected>All rows</option>
    <option value="200">200 rows</option>
    <option value="500">500 rows</option>
    <option value="1000">1000 rows</option>
    <option value="2000">2000 rows</option>
  </select>
  <a href="<?php p(str_replace('__KIND__', 'ledger', $routes['exportCsv'])); ?>"
     download="ledger.csv"
     style="background: rgba(96,165,250,0.08); color: var(--blue); text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; border: 1px solid var(--blue); white-space: nowrap;"
     title="Download every transaction as CSV (date, eventType, category, description, ISIN, amount, status)">↓ Export CSV</a>
</div>

<table id="ledger-table">
  <thead>
    <tr>
      <th data-sort="Date">Date</th>
      <th data-sort="Type">Category</th>
      <th data-sort="Note">Detail</th>
      <th>ISIN</th>
      <th class="num">Amount (€)</th>
    </tr>
  </thead>
  <tbody id="events-tbody"></tbody>
</table>

<div class="disclaimer">
  Trade Republic data via
  <a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
  Categories reflect Trade Republic's CSV. Sign of Amount = sign of the
  CSV Value field (Buy/Withdrawal/Removal are negative). For
  filled-trades-only view see <a href="<?php p($routes['orders']); ?>">Orders</a>.
</div>

</div>
