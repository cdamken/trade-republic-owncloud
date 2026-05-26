<?php
/** @var array $_ */
/** @var \OCP\IL10N $l */
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
		Trade Republic Portfolio
	</h1>
	<div class="subtitle">
		<span id="phone-label">Cuenta: cargando...</span> · Última actualización:
		<span id="last-update">—</span>
		<button class="update-btn" id="update-btn">⟳ Actualizar</button>
		<button class="settings-btn" id="settings-btn" title="Configurar teléfono y PIN">⚙ Cuenta</button>
	</div>

	<div class="nav">
		<a href="<?php p($routes['index']); ?>" class="active">📊 Portafolio</a>
		<a href="<?php p($routes['analytics']); ?>">📈 Analytics</a>
	</div>

	<div id="error-box"></div>

	<div class="cards" id="cards">
		<div class="card">
			<div class="label">Valor total</div>
			<div class="value" id="total-value">—</div>
			<div class="delta muted">portafolio + efectivo</div>
		</div>
		<div class="card">
			<div class="label">P&amp;L del depósito</div>
			<div class="value" id="total-pnl">—</div>
			<div class="delta" id="total-pnl-pct">—</div>
		</div>
		<div class="card">
			<div class="label">Posiciones</div>
			<div class="value" id="num-positions">—</div>
			<div class="delta muted" id="positions-note">—</div>
		</div>
		<div class="card">
			<div class="label">Efectivo (EUR)</div>
			<div class="value" id="cash-value">—</div>
			<div class="delta muted">disponible para operar</div>
		</div>
	</div>

	<div class="section">
		<span>▲ Top ganadores</span>
		<span class="badge" id="winners-count">—</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Nombre</th>
				<th>ISIN</th>
				<th class="num">Cantidad</th>
				<th class="num">Valor</th>
				<th class="num">P&amp;L €</th>
				<th class="num">P&amp;L %</th>
			</tr>
		</thead>
		<tbody id="winners-tbody"></tbody>
	</table>

	<div class="section">
		<span>▼ Top perdedores</span>
		<span class="badge" id="losers-count">—</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Nombre</th>
				<th>ISIN</th>
				<th class="num">Cantidad</th>
				<th class="num">Valor</th>
				<th class="num">P&amp;L €</th>
				<th class="num">P&amp;L %</th>
			</tr>
		</thead>
		<tbody id="losers-tbody"></tbody>
	</table>

	<div class="section">
		<span>Todas las posiciones</span>
		<span class="badge" id="positions-count">—</span>
	</div>

	<div class="controls">
		<input type="text" id="search" placeholder="Buscar nombre o ISIN...">
		<select id="bucket-filter">
			<option value="all">Todos los rangos</option>
			<option value="over_2000">Más de €2,000</option>
			<option value="range_500_2000">€500–€2,000</option>
			<option value="range_100_500">€100–€500</option>
			<option value="range_20_100">€20–€100</option>
			<option value="under_20">Menos de €20</option>
		</select>
		<select id="pnl-filter">
			<option value="all">P&amp;L: todos</option>
			<option value="winners">Solo ganadores (+)</option>
			<option value="losers">Solo perdedores (−)</option>
			<option value="big_winners">Ganadores &gt;50%</option>
			<option value="big_losers">Perdedores &gt;25%</option>
		</select>
	</div>

	<table id="positions-table">
		<thead>
			<tr>
				<th data-sort="name">Nombre</th>
				<th data-sort="isin">ISIN</th>
				<th class="num" data-sort="quantity">Cantidad</th>
				<th class="num" data-sort="avg_cost">Precio prom.</th>
				<th class="num" data-sort="current_price">Último</th>
				<th class="num" data-sort="buy_cost_eur">Invertido</th>
				<th class="num" data-sort="net_value_eur">Valor</th>
				<th class="num" data-sort="pl_eur">P&amp;L €</th>
				<th class="num" data-sort="pl_pct">P&amp;L %</th>
			</tr>
		</thead>
		<tbody id="positions-tbody"></tbody>
	</table>

	<div class="disclaimer">
		Dashboard no oficial — datos vía
		<a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
		Tu teléfono, PIN y datos viven solo en este servidor ownCloud, aislados por usuario.
		No afiliado con Trade Republic Bank GmbH.
	</div>

	<div class="modal-backdrop" id="config-modal">
		<div class="modal">
			<h2>⚙ Cuenta de Trade Republic</h2>
			<p>
				Tu teléfono se guarda en claro y el PIN cifrado en tu perfil de
				ownCloud. Solo se usan desde tu sesión. La primera vez TR te
				enviará un código de <b>4 dígitos</b> a tu app móvil.
			</p>
			<div class="modal-error hidden" id="config-error"></div>
			<label for="config-phone">Teléfono (formato internacional)</label>
			<input type="tel" class="field" id="config-phone" autocomplete="tel" placeholder="+491701234567">
			<label for="config-pin">PIN (4 dígitos)</label>
			<input type="password" class="field pin-field" id="config-pin" inputmode="numeric" maxlength="6" placeholder="••••">
			<div style="height: 20px;"></div>
			<div class="modal-btns">
				<button class="danger" id="config-reset" style="margin-right:auto;" title="Borrar credenciales y datos">Borrar cuenta</button>
				<button class="secondary" id="config-cancel">Cancelar</button>
				<button class="primary" id="config-submit" disabled>Guardar</button>
			</div>
			<div class="modal-hint">
				Cero telemetría. Cero envío fuera de este servidor.
			</div>
		</div>
	</div>

	<div class="modal-backdrop" id="reset-modal">
		<div class="modal">
			<h2>⚠ Borrar cuenta y datos</h2>
			<p>
				Se borrarán <b>de este servidor</b>:
				<br>• tu teléfono y PIN guardados
				<br>• las cookies de sesión de Trade Republic
				<br>• tu portafolio, transacciones e historial descargados
				<br><br>
				Esta acción <b>no se puede deshacer</b>. Para confirmar, escribe
				<code style="color:var(--red);">delete</code> abajo:
			</p>
			<div class="modal-error hidden" id="reset-error"></div>
			<input type="text" class="field" id="reset-confirm" autocomplete="off" placeholder="delete">
			<div style="height: 20px;"></div>
			<div class="modal-btns">
				<button class="secondary" id="reset-cancel">Cancelar</button>
				<button class="danger" id="reset-submit" disabled>Borrar todo</button>
			</div>
		</div>
	</div>

	<div class="progress-overlay" id="progress-overlay">
		<div class="progress-box">
			<div class="spinner"></div>
			<h2>Actualizando tu portafolio</h2>
			<div class="progress-stage" id="progress-stage">Conectando con Trade Republic…</div>
			<div class="progress-hint">
				Esto suele tardar entre 30 segundos y 2 minutos.<br>
				Por favor, no cierres esta pestaña.
			</div>
			<div class="progress-elapsed" id="progress-elapsed">0s</div>
		</div>
	</div>

	<div class="modal-backdrop" id="mfa-modal">
		<div class="modal">
			<h2>🔐 Código de Trade Republic</h2>
			<p>
				Trade Republic acaba de enviarte una notificación push con un
				código de <b>4 dígitos</b>. Ábrela en tu teléfono e introdúcelo
				aquí. El código expira en ~60 segundos.
			</p>
			<div class="modal-error hidden" id="mfa-error"></div>
			<input type="text" class="totp" id="mfa-input" maxlength="4" inputmode="numeric" autocomplete="one-time-code" placeholder="0000">
			<label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;
			              background:rgba(255,255,255,0.03); border:1px solid var(--border);
			              border-radius:10px; padding:12px 14px; margin-top:8px; margin-bottom:6px;
			              font-size:12px; color:var(--muted); line-height:1.45;">
				<input type="checkbox" id="mfa-full-reload" style="margin-top:2px;">
				<span>
					<strong style="color:var(--text);">↻ Descarga completa</strong> —
					vuelve a bajar todo el historial de transacciones (lento, ~2 min).
					Úsalo si los números parecen mal.
				</span>
			</label>
			<div class="modal-btns">
				<button class="secondary" id="mfa-cancel">Cancelar</button>
				<button class="primary" id="mfa-submit" disabled>Actualizar</button>
			</div>
			<div class="modal-hint">
				No guardamos el código. Solo se reenvía a TR para esta sesión.
			</div>
		</div>
	</div>

</div>
