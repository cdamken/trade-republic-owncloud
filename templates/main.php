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
		<span id="phone-label">Account: loading...</span> · Last update:
		<span id="last-update">—</span>
		<button class="update-btn" id="update-btn">⟳ Update Now</button>
		<button class="settings-btn" id="settings-btn" title="Configure phone &amp; PIN">⚙ Account</button>
	</div>

	<div class="nav">
		<a href="<?php p($routes['index']); ?>" class="active">📊 Portfolio</a>
		<a href="<?php p($routes['analytics']); ?>">📈 Analytics</a>
	</div>

	<div id="error-box"></div>

	<div class="cards" id="cards">
		<div class="card">
			<div class="label">Total Value</div>
			<div class="value" id="total-value">—</div>
			<div class="delta muted">portfolio + cash</div>
		</div>
		<div class="card">
			<div class="label">Depot P/L</div>
			<div class="value" id="total-pnl">—</div>
			<div class="delta" id="total-pnl-pct">—</div>
		</div>
		<div class="card">
			<div class="label">Positions</div>
			<div class="value" id="num-positions">—</div>
			<div class="delta muted" id="positions-note">—</div>
		</div>
		<div class="card">
			<div class="label">Cash (EUR)</div>
			<div class="value" id="cash-value">—</div>
			<div class="delta muted">available to trade</div>
		</div>
	</div>

	<div class="section">
		<span>🏆 Top Winners</span>
		<span class="badge" id="winners-count">—</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Asset</th>
				<th>ISIN</th>
				<th class="num">Qty</th>
				<th class="num">Value</th>
				<th class="num">P/L €</th>
				<th class="num">P/L %</th>
			</tr>
		</thead>
		<tbody id="winners-tbody"></tbody>
	</table>

	<div class="section">
		<span>💔 Top Losers</span>
		<span class="badge" id="losers-count">—</span>
	</div>
	<table>
		<thead>
			<tr>
				<th>Asset</th>
				<th>ISIN</th>
				<th class="num">Qty</th>
				<th class="num">Value</th>
				<th class="num">P/L €</th>
				<th class="num">P/L %</th>
			</tr>
		</thead>
		<tbody id="losers-tbody"></tbody>
	</table>

	<div class="section">
		<span>📋 All Positions</span>
		<span class="badge" id="positions-count">—</span>
	</div>

	<div class="controls">
		<input type="text" id="search" placeholder="Search name or ISIN...">
		<select id="bucket-filter">
			<option value="all">All value ranges</option>
			<option value="over_2000">Over €2,000</option>
			<option value="range_500_2000">€500–€2,000</option>
			<option value="range_100_500">€100–€500</option>
			<option value="range_20_100">€20–€100</option>
			<option value="under_20">Under €20</option>
		</select>
		<select id="pnl-filter">
			<option value="all">All P/L</option>
			<option value="winners">Winners (+)</option>
			<option value="losers">Losers (−)</option>
			<option value="big_winners">Winners &gt;50%</option>
			<option value="big_losers">Losers &gt;25%</option>
		</select>
	</div>

	<table id="positions-table">
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
		<tbody id="positions-tbody"></tbody>
	</table>

	<div class="disclaimer">
		Unofficial dashboard — data via
		<a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener">tr-api</a>.
		Your phone, PIN and data live only on this ownCloud server, isolated per user.
		Not affiliated with Trade Republic Bank GmbH.
	</div>

	<div class="modal-backdrop" id="config-modal">
		<div class="modal">
			<h2>⚙ Trade Republic Account</h2>
			<p>
				Your phone is stored as plain text and the PIN is encrypted in
				your ownCloud profile. They are only used from your session. The
				first time, TR will push a <b>4-digit code</b> to your mobile app.
			</p>
			<div class="modal-error hidden" id="config-error"></div>
			<label for="config-phone">Phone (international format)</label>
			<input type="tel" class="field" id="config-phone" autocomplete="tel" placeholder="+491701234567">
			<label for="config-pin">PIN (4 digits)</label>
			<input type="password" class="field pin-field" id="config-pin" inputmode="numeric" maxlength="6" placeholder="••••">
			<div style="height: 20px;"></div>
			<div class="modal-btns">
				<button class="danger" id="config-reset" style="margin-right:auto;" title="Erase credentials and data">Erase account</button>
				<button class="secondary" id="config-cancel">Cancel</button>
				<button class="primary" id="config-submit" disabled>Save</button>
			</div>
			<div class="modal-hint">
				Zero telemetry. Nothing leaves this server.
			</div>
		</div>
	</div>

	<div class="modal-backdrop" id="reset-modal">
		<div class="modal">
			<h2>⚠ Erase account and data</h2>
			<p>
				The following will be erased <b>from this server</b>:
				<br>• your stored phone and PIN
				<br>• your Trade Republic session cookies
				<br>• your downloaded portfolio, transactions and history
				<br><br>
				This action <b>cannot be undone</b>. To confirm, type
				<code style="color:var(--red);">delete</code> below:
			</p>
			<div class="modal-error hidden" id="reset-error"></div>
			<input type="text" class="field" id="reset-confirm" autocomplete="off" placeholder="delete">
			<div style="height: 20px;"></div>
			<div class="modal-btns">
				<button class="secondary" id="reset-cancel">Cancel</button>
				<button class="danger" id="reset-submit" disabled>Erase everything</button>
			</div>
		</div>
	</div>

	<div class="progress-overlay" id="progress-overlay">
		<div class="progress-box">
			<div class="spinner"></div>
			<h2>Updating your portfolio</h2>
			<div class="progress-stage" id="progress-stage">Connecting to Trade Republic…</div>
			<div class="progress-hint">
				This usually takes between 30 seconds and 2 minutes.<br>
				Please don't close this tab.
			</div>
			<div class="progress-elapsed" id="progress-elapsed">0s</div>
		</div>
	</div>

	<div class="modal-backdrop" id="mfa-modal">
		<div class="modal">
			<h2>🔐 Trade Republic Security Code</h2>
			<p>
				Trade Republic just pushed a <b>4-digit code</b> to your mobile
				app. Open the app on your phone and enter the code here. The
				code expires in ~60 seconds.
			</p>
			<div class="modal-error hidden" id="mfa-error"></div>
			<input type="text" class="totp" id="mfa-input" maxlength="4" inputmode="numeric" autocomplete="one-time-code" placeholder="0000">
			<label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;
			              background:rgba(255,255,255,0.03); border:1px solid var(--border);
			              border-radius:10px; padding:12px 14px; margin-top:8px; margin-bottom:6px;
			              font-size:12px; color:var(--muted); line-height:1.45;">
				<input type="checkbox" id="mfa-full-reload" style="margin-top:2px;">
				<span>
					<strong style="color:var(--text);">↻ Full reload</strong> —
					re-download the full transaction history (slow, ~2 min).
					Use this if the numbers look off.
				</span>
			</label>
			<div class="modal-btns">
				<button class="secondary" id="mfa-cancel">Cancel</button>
				<button class="primary" id="mfa-submit" disabled>Update</button>
			</div>
			<div class="modal-hint">
				We don't store the code. It's only forwarded to TR for this session.
			</div>
		</div>
	</div>

</div>
