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
		Cash flow, dividendos y patrimonio · Última actualización:
		<span id="last-update">—</span>
	</div>

	<div class="nav">
		<a href="<?php p($routes['index']); ?>">📊 Portafolio</a>
		<a href="<?php p($routes['analytics']); ?>" class="active">📈 Analytics</a>
	</div>

	<div id="error-box"></div>

	<div class="cards">
		<div class="card">
			<div class="label">Capital depositado</div>
			<div class="value" id="cf-deposits">—</div>
			<div class="delta muted">total ingresado</div>
		</div>
		<div class="card">
			<div class="label">Gastado con tarjeta</div>
			<div class="value" id="cf-removals">—</div>
			<div class="delta muted">salidas TR → fuera</div>
		</div>
		<div class="card">
			<div class="label">Capital neto en TR</div>
			<div class="value" id="cf-net-in">—</div>
			<div class="delta muted">depósitos − retiros</div>
		</div>
		<div class="card">
			<div class="label">P&amp;L de por vida</div>
			<div class="value" id="cf-lifetime">—</div>
			<div class="delta" id="cf-lifetime-pct">—</div>
		</div>
	</div>

	<div class="section">
		<span>Cash flow por mes</span>
		<span class="badge muted">depósitos / retiros / neto</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Mes</th>
				<th class="num">Depósitos</th>
				<th class="num">Retiros</th>
				<th class="num">Reembolsos fiscales</th>
				<th class="num">Neto</th>
			</tr>
		</thead>
		<tbody id="monthly-tbody"></tbody>
	</table>

	<div class="section">
		<span>Dividendos e intereses</span>
		<span class="badge" id="div-total">€0</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Fecha</th>
				<th>Concepto</th>
				<th class="num">Importe</th>
			</tr>
		</thead>
		<tbody id="dividends-tbody"></tbody>
	</table>

	<div class="section">
		<span>Distribución</span>
		<span class="badge muted">por categoría aproximada</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Categoría</th>
				<th class="num">Valor</th>
				<th class="num">%</th>
			</tr>
		</thead>
		<tbody id="alloc-tbody"></tbody>
	</table>

	<div class="section">
		<span>Patrimonio (últimos 180 días)</span>
		<span class="badge" id="history-count">—</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Fecha</th>
				<th class="num">Valor total</th>
				<th class="num">Depósito</th>
				<th class="num">Efectivo</th>
			</tr>
		</thead>
		<tbody id="history-tbody"></tbody>
	</table>

	<div class="disclaimer">
		Dashboard no oficial — datos vía
		<a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
		<i>P&amp;L de por vida</i> = valor actual − (depósitos − retiros). Las
		categorías de distribución se infieren heurísticamente del nombre del
		instrumento; no son una clasificación oficial.
	</div>

</div>
