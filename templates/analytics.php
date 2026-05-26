<?php
/** @var array $_ */
$routes = $_['routes'];
?>
<div id="tr-app"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-config="<?php p($routes['config']); ?>"
	data-route-update="<?php p($routes['update']); ?>"
	data-route-reset="<?php p($routes['reset']); ?>">

	<h1>
		<div class="logo-box">TR</div>
		Analytics
	</h1>
	<div class="subtitle">
		Cash flow, dividends and net worth · Last update:
		<span id="last-update">—</span>
	</div>

	<div class="nav">
		<a href="<?php p($routes['index']); ?>">📊 Portfolio</a>
		<a href="<?php p($routes['analytics']); ?>" class="active">📈 Analytics</a>
	</div>

	<div id="error-box"></div>

	<div class="cards">
		<div class="card">
			<div class="label">Total deposited</div>
			<div class="value" id="cf-deposits">—</div>
			<div class="delta muted">money in</div>
		</div>
		<div class="card">
			<div class="label">Spent with card</div>
			<div class="value" id="cf-removals">—</div>
			<div class="delta muted">TR → outside</div>
		</div>
		<div class="card">
			<div class="label">Net capital in TR</div>
			<div class="value" id="cf-net-in">—</div>
			<div class="delta muted">deposits − removals</div>
		</div>
		<div class="card">
			<div class="label">Lifetime P/L</div>
			<div class="value" id="cf-lifetime">—</div>
			<div class="delta" id="cf-lifetime-pct">—</div>
		</div>
	</div>

	<div class="section">
		<span>Monthly cash flow</span>
		<span class="badge muted">deposits / removals / net</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Month</th>
				<th class="num">Deposits</th>
				<th class="num">Removals</th>
				<th class="num">Tax refunds</th>
				<th class="num">Net</th>
			</tr>
		</thead>
		<tbody id="monthly-tbody"></tbody>
	</table>

	<div class="section">
		<span>Dividends &amp; interest</span>
		<span class="badge" id="div-total">€0</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Date</th>
				<th>Note</th>
				<th class="num">Amount</th>
			</tr>
		</thead>
		<tbody id="dividends-tbody"></tbody>
	</table>

	<div class="section">
		<span>Allocation</span>
		<span class="badge muted">rough category split</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Category</th>
				<th class="num">Value</th>
				<th class="num">%</th>
			</tr>
		</thead>
		<tbody id="alloc-tbody"></tbody>
	</table>

	<div class="section">
		<span>Net worth (last 180 days)</span>
		<span class="badge" id="history-count">—</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Date</th>
				<th class="num">Total value</th>
				<th class="num">Depot</th>
				<th class="num">Cash</th>
			</tr>
		</thead>
		<tbody id="history-tbody"></tbody>
	</table>

	<div class="disclaimer">
		Unofficial dashboard — data via
		<a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
		<i>Lifetime P/L</i> = current value − (deposits − removals). Allocation
		categories are inferred heuristically from instrument names; they are
		not an official classification.
	</div>

</div>
