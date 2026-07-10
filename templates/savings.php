<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Savings plans page. Reads savings_plans.json (written by
 * fetch_wrapper.py::fetch_savings) via the api#data route. Sibling of
 * ledger.php — same shell + top-bar.
 */
?>
<div id="tr-app" class="savings-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-dividends="<?php p($routes['dividends']); ?>"
	data-route-orders="<?php p($routes['orders']); ?>"
	data-route-ledger="<?php p($routes['ledger']); ?>"
	data-route-savings="<?php p($routes['savings']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-update="<?php p($routes['update']); ?>">

<?php
$activeNav = 'savings';
$logoEmoji = '🔁';
include __DIR__ . '/partials/_top_bar.php';
?>

<div id="error-box"></div>

<!-- ---------- Summary cards ---------- -->
<div class="cards">
  <div class="card">
    <div class="label">Savings plans</div>
    <div class="value" id="card-count">—</div>
    <div class="delta muted" id="card-paused">—</div>
  </div>
  <div class="card">
    <div class="label">Monthly commitment</div>
    <div class="value" id="card-monthly">—</div>
    <div class="delta muted">normalised to €/month</div>
  </div>
  <div class="card">
    <div class="label">Per execution round</div>
    <div class="value" id="card-perexec">—</div>
    <div class="delta muted">sum of active plans</div>
  </div>
  <div class="card">
    <div class="label">By interval</div>
    <div class="value" id="card-intervals" style="font-size:15px; line-height:1.5;">—</div>
    <div class="delta muted">count per cadence</div>
  </div>
</div>

<div class="section">
  <span>Savings plans</span>
  <span class="badge" id="plans-count">—</span>
</div>

<div class="controls">
  <input type="text" id="search" placeholder="Search by name or ISIN…">
  <select id="interval-filter">
    <option value="">All intervals</option>
    <option value="weekly">Weekly</option>
    <option value="biweekly">Biweekly</option>
    <option value="twoPerMonth">Twice a month</option>
    <option value="monthly">Monthly</option>
    <option value="quarterly">Quarterly</option>
  </select>
</div>

<table id="savings-table">
  <thead>
    <tr>
      <th data-sort="next_execution">Next execution</th>
      <th data-sort="name">Instrument</th>
      <th>ISIN</th>
      <th data-sort="interval">Interval</th>
      <th class="num" data-sort="amount">Amount (€)</th>
      <th class="num" data-sort="monthly">€/month</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody id="savings-tbody"></tbody>
</table>

<div class="disclaimer">
  Trade Republic savings plans via
  <a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
  Read-only. Amounts are per execution; the monthly figure normalises each
  cadence to a monthly rate. Instrument names are resolved from your portfolio
  when available.
</div>

</div>
