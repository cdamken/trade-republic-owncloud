/* global OC */
/**
 * Trade Republic Portfolio — portfolio page logic.
 *
 * Ported from Trade-Republic-Dashboard/app/index.html. URLs come from
 * data-route-* attributes on #tr-app (set by templates/main.php) so nothing
 * needs to live in an inline <script>, which OC's default CSP blocks.
 * POSTs carry the ownCloud CSRF token.
 *
 * Login differences vs. the GBM sibling app:
 *   - Credentials are phone (E.164) + PIN, not email + password.
 *   - MFA is a 4-digit push (TR sends it to the user's mobile app), not a
 *     6-digit TOTP — the modal accepts only 4 digits and points the user
 *     to their phone, not an authenticator.
 *   - Login is two-step on the server side: first /update with no code
 *     triggers the push, second /update with the code completes it. The
 *     JS side just sees mfa_required and reopens the modal.
 */
(function () {
	'use strict';

	let routes;
	const dataUrl = (type) => routes.data.replace('__TYPE__', type);

	// ----------------------------------------------------------------------
	// Format helpers
	// ----------------------------------------------------------------------
	const fmtMoney = (n, opts) => {
		opts = opts || {};
		if (n == null || isNaN(n)) return '—';
		const sign = opts.sign === true;
		const decimals = opts.decimals != null ? opts.decimals : 2;
		const currency = opts.currency === true;
		const abs = Math.abs(n);
		const formatted = abs.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
		const signPrefix = n < 0 ? '−' : (sign && n > 0 ? '+' : '');
		const currencyPrefix = currency ? '€' : '';
		return signPrefix + currencyPrefix + formatted;
	};
	const fmtPct = (n) => {
		if (n == null || isNaN(n)) return '—';
		return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
	};
	const pnlClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted');
	const formatTimestamp = (raw) => {
		if (!raw) return '—';
		const s = String(raw).trim();
		// last_update.date is "YYYY-MM-DD HH:MM:SS" — make it ISO-ish for Date.
		const d = new Date(s.replace(' ', 'T'));
		if (isNaN(d.getTime())) return s;
		return d.toLocaleString('en-US', {
			year: 'numeric', month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit',
		});
	};

	const state = {
		data: null,           // portfolio.json
		lastUpdate: null,
		sortKey: 'net_value_eur',
		sortDir: 'desc',
	};

	const $ = (id) => document.getElementById(id);

	// ----------------------------------------------------------------------
	// Loader
	// ----------------------------------------------------------------------
	async function load() {
		try {
			const opts = { cache: 'no-store', headers: { Accept: 'application/json' } };
			const [portRes, lastRes] = await Promise.all([
				fetch(dataUrl('portfolio'), opts),
				fetch(dataUrl('last_update'), opts),
			]);
			state.data = portRes.ok ? await portRes.json() : null;
			state.lastUpdate = lastRes.ok ? (await lastRes.text()).trim() : '';
			renderAll();
		} catch (err) {
			$('error-box').innerHTML =
				'<div class="error"><b>Could not load data.</b><br>' +
				'Click <code>⟳ Update Now</code> to fetch.<br>' +
				'Detail: ' + (err.message || err) + '</div>';
		}
	}

	// ----------------------------------------------------------------------
	// Renderers
	// ----------------------------------------------------------------------
	function renderAll() {
		renderHeader();
		renderCards();
		renderMovers();
		renderTable();
	}

	function renderHeader() {
		$('last-update').textContent = formatTimestamp(state.lastUpdate);
	}

	function renderCards() {
		if (!state.data) {
			$('total-value').textContent = '—';
			$('total-pnl').textContent = '—';
			$('total-pnl-pct').textContent = '—';
			$('num-positions').textContent = '—';
			$('cash-value').textContent = '—';
			$('positions-note').textContent = '—';
			return;
		}
		const s = state.data.summary || {};
		$('total-value').textContent = fmtMoney(s.total_netvalue, { currency: true });
		const pnlEl = $('total-pnl');
		pnlEl.textContent = fmtMoney(s.depot_pl_eur, { sign: true, currency: true });
		pnlEl.className = 'value ' + pnlClass(s.depot_pl_eur);
		const pctEl = $('total-pnl-pct');
		pctEl.textContent = fmtPct(s.depot_pl_pct);
		pctEl.className = 'delta ' + pnlClass(s.depot_pl_eur);
		$('num-positions').textContent = state.data.total_positions || 0;
		$('positions-note').textContent =
			(state.data.positions_with_value || 0) + ' with price · ' +
			((state.data.zero_value_positions || []).length) + ' without price';
		$('cash-value').textContent = fmtMoney(s.cash_eur, { currency: true });
	}

	function renderMovers() {
		const winners = (state.data && state.data.winners_50plus) || [];
		const losers = (state.data && state.data.losers_25minus) || [];
		$('winners-count').textContent = winners.length;
		$('losers-count').textContent = losers.length;
		$('winners-tbody').innerHTML = winners.length
			? winners.slice(0, 10).map(moverRow).join('')
			: emptyRow();
		$('losers-tbody').innerHTML = losers.length
			? losers.slice(0, 10).map(moverRow).join('')
			: emptyRow();
	}

	function emptyRow() {
		return '<tr><td colspan="6" style="color: var(--muted); text-align: center;">No data</td></tr>';
	}

	function moverRow(p) {
		const qtyDecimals = (p.quantity % 1 === 0) ? 0 : 4;
		return '<tr>' +
			'<td class="ticker">' + escapeHtml(p.name || '—') + '</td>' +
			'<td class="sob-id">' + escapeHtml(p.isin || '') + '</td>' +
			'<td class="num">' + fmtMoney(p.quantity, { decimals: qtyDecimals }) + '</td>' +
			'<td class="num">' + fmtMoney(p.net_value_eur, { currency: true }) + '</td>' +
			'<td class="num ' + pnlClass(p.pl_eur) + '">' + fmtMoney(p.pl_eur, { sign: true, currency: true }) + '</td>' +
			'<td class="num ' + pnlClass(p.pl_pct) + '">' + fmtPct(p.pl_pct) + '</td>' +
		'</tr>';
	}

	function bucketMatch(value, bucket) {
		switch (bucket) {
			case 'over_2000':      return value > 2000;
			case 'range_500_2000': return value >= 500 && value <= 2000;
			case 'range_100_500':  return value >= 100 && value < 500;
			case 'range_20_100':   return value >= 20 && value < 100;
			case 'under_20':       return value < 20;
			default:               return true;
		}
	}
	function pnlMatch(p, filter) {
		switch (filter) {
			case 'winners':     return p.pl_eur > 0;
			case 'losers':      return p.pl_eur < 0;
			case 'big_winners': return p.pl_pct > 50;
			case 'big_losers':  return p.pl_pct < -25;
			default:            return true;
		}
	}

	function setSort(key) {
		if (state.sortKey === key) {
			state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			state.sortKey = key;
			state.sortDir = 'desc';
		}
		renderTable();
	}

	function renderTable() {
		const all = (state.data && state.data.all_positions) || [];
		const search = $('search').value.toLowerCase();
		const bucket = $('bucket-filter').value;
		const pnlFilter = $('pnl-filter').value;

		const rows = all.filter(p => {
			if (search) {
				const hay = ((p.name || '') + ' ' + (p.isin || '')).toLowerCase();
				if (!hay.includes(search)) return false;
			}
			if (!bucketMatch(p.net_value_eur, bucket)) return false;
			if (!pnlMatch(p, pnlFilter)) return false;
			return true;
		});

		rows.sort((a, b) => {
			const va = a[state.sortKey];
			const vb = b[state.sortKey];
			if (typeof va === 'string' || typeof vb === 'string') {
				return state.sortDir === 'asc'
					? String(va || '').localeCompare(String(vb || ''))
					: String(vb || '').localeCompare(String(va || ''));
			}
			const na = va == null ? 0 : va;
			const nb = vb == null ? 0 : vb;
			return state.sortDir === 'asc' ? na - nb : nb - na;
		});

		$('positions-count').textContent = rows.length + ' / ' + all.length;
		$('positions-tbody').innerHTML = rows.map(p => {
			const qtyDecimals = (p.quantity % 1 === 0) ? 0 : 4;
			return '<tr>' +
				'<td class="ticker">' + escapeHtml(p.name || '—') + '</td>' +
				'<td class="sob-id">' + escapeHtml(p.isin || '') + '</td>' +
				'<td class="num">' + fmtMoney(p.quantity, { decimals: qtyDecimals }) + '</td>' +
				'<td class="num">' + fmtMoney(p.avg_cost, { decimals: 4 }) + '</td>' +
				'<td class="num">' + fmtMoney(p.current_price, { decimals: 4 }) + '</td>' +
				'<td class="num">' + fmtMoney(p.buy_cost_eur, { currency: true }) + '</td>' +
				'<td class="num">' + fmtMoney(p.net_value_eur, { currency: true }) + '</td>' +
				'<td class="num ' + pnlClass(p.pl_eur) + '">' + fmtMoney(p.pl_eur, { sign: true, currency: true }) + '</td>' +
				'<td class="num ' + pnlClass(p.pl_pct) + '">' + fmtPct(p.pl_pct) + '</td>' +
			'</tr>';
		}).join('') || emptyRow().replace('colspan="6"', 'colspan="9"');
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, c => ({
			'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
		}[c]));
	}

	// ----------------------------------------------------------------------
	// Update + MFA + Config modals
	// ----------------------------------------------------------------------
	function postJson(url, body) {
		return fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
				'requesttoken': OC.requestToken,
			},
			body: JSON.stringify(body || {}),
		});
	}

	async function triggerUpdate(mfaCode) {
		const btn = $('update-btn');
		btn.disabled = true;
		btn.textContent = mfaCode ? '⟳ Verifying code...' : '⟳ Connecting...';

		// Defer the heavy overlay: the first probe (no MFA) might come back
		// with mfa_required, in which case we don't want to flash the overlay
		// before opening the MFA modal. With a code in hand we know it'll take
		// a while, so show the overlay immediately.
		let overlayShown = false;
		let pollTimer = null;
		const startOverlay = () => {
			if (overlayShown) return;
			overlayShown = true;
			showProgressOverlay();
			pollTimer = startProgressPolling();
			btn.textContent = '⟳ Updating...';
		};
		const overlayDelay = mfaCode != null ? 0 : 700;
		const overlayTimer = setTimeout(startOverlay, overlayDelay);
		const stopOverlay = () => {
			clearTimeout(overlayTimer);
			if (pollTimer) { stopProgressPolling(pollTimer); pollTimer = null; }
			if (overlayShown) { hideProgressOverlay(); overlayShown = false; }
		};

		const body = {};
		if (mfaCode) {
			body.mfa_code = mfaCode;
			if ($('mfa-full-reload').checked) body.full = true;
		}

		let res;
		try {
			res = await postJson(routes.update, body);
		} catch (err) {
			stopOverlay();
			btn.disabled = false;
			btn.textContent = '⟳ Update Now';
			alert('Could not reach the server.\nDetail: ' + err.message);
			return;
		}

		clearTimeout(overlayTimer);
		if (pollTimer) { stopProgressPolling(pollTimer); pollTimer = null; }

		let payload = {};
		try { payload = await res.json(); } catch (_) {}

		if (res.ok && payload.status === 'ok') {
			closeMfaModal();
			btn.textContent = '⟳ Refreshing view...';
			await load();
			stopOverlay();
			btn.disabled = false;
			btn.textContent = '⟳ Update Now';
			return;
		}

		stopOverlay();
		btn.disabled = false;
		btn.textContent = '⟳ Update Now';

		if (payload.status === 'mfa_required') { openMfaModal(); return; }
		if (payload.status === 'mfa_invalid') { openMfaModal('Wrong or expired code. Press Update again so TR sends you a new one.'); return; }
		if (payload.status === 'auth_failed') {
			closeMfaModal();
			openConfigModal();
			const errEl = $('config-error');
			errEl.textContent = 'Credentials rejected by Trade Republic.';
			errEl.classList.remove('hidden');
			return;
		}
		if (payload.status === 'rate_limited') {
			closeMfaModal();
			alert('Trade Republic rate-limited the login. Wait a few minutes.\n' + (payload.detail || ''));
			return;
		}
		if (payload.status === 'config_error') {
			closeMfaModal();
			openConfigModal(true);
			return;
		}
		if (payload.status === 'api_error') {
			closeMfaModal();
			alert('Trade Republic API error: ' + (payload.detail || 'no detail'));
			return;
		}
		closeMfaModal();
		alert('Update failed (HTTP ' + res.status + '): ' + (payload.detail || 'no detail'));
	}

	function openMfaModal(errorMsg) {
		const modal = $('mfa-modal');
		const errEl = $('mfa-error');
		const input = $('mfa-input');
		if (errorMsg) { errEl.textContent = errorMsg; errEl.classList.remove('hidden'); }
		else { errEl.classList.add('hidden'); }
		input.value = '';
		$('mfa-submit').disabled = true;
		$('mfa-full-reload').checked = false;
		modal.classList.add('show');
		setTimeout(() => input.focus(), 100);
	}
	function closeMfaModal() { $('mfa-modal').classList.remove('show'); }

	async function loadConfigStatus() {
		try {
			const res = await fetch(routes.config, { headers: { Accept: 'application/json' } });
			return await res.json();
		} catch (_) { return { configured: false, phone: null }; }
	}

	async function maybeShowConfigOnFirstLoad() {
		const s = await loadConfigStatus();
		if (!s.configured) openConfigModal(true);
		else if (s.phone) $('phone-label').textContent = 'Account: ' + maskPhone(s.phone);
	}

	function maskPhone(p) {
		if (!p) return '—';
		if (p.length <= 4) return p;
		return p.slice(0, 4) + '••••' + p.slice(-2);
	}

	function openConfigModal(firstTime) {
		const modal = $('config-modal');
		const errEl = $('config-error');
		errEl.classList.add('hidden');
		loadConfigStatus().then(s => {
			const phoneEl = $('config-phone');
			const pinEl = $('config-pin');
			if (s.phone && !firstTime) phoneEl.value = s.phone;
			pinEl.value = '';
			$('config-submit').disabled = true;
			modal.classList.add('show');
			setTimeout(() => (s.phone && !firstTime ? pinEl : phoneEl).focus(), 100);
		});
	}
	function closeConfigModal() { $('config-modal').classList.remove('show'); }

	// ----------------------------------------------------------------------
	// Reset modal (wipe phone, PIN, cookies, data)
	// ----------------------------------------------------------------------
	function openResetModal() {
		closeConfigModal();
		$('reset-error').classList.add('hidden');
		$('reset-confirm').value = '';
		$('reset-submit').disabled = true;
		$('reset-modal').classList.add('show');
		setTimeout(() => $('reset-confirm').focus(), 100);
	}
	function closeResetModal() { $('reset-modal').classList.remove('show'); }
	async function submitReset() {
		if ($('reset-confirm').value !== 'delete') return;
		$('reset-submit').disabled = true;
		try {
			const res = await postJson(routes.reset, {});
			if (res.ok) {
				closeResetModal();
				$('phone-label').textContent = 'Account: —';
				$('last-update').textContent = '—';
				state.data = null;
				renderAll();
				openConfigModal(true);
				return;
			}
			const p = await res.json().catch(() => ({}));
			$('reset-error').textContent = p.detail || 'Could not erase the account.';
			$('reset-error').classList.remove('hidden');
		} catch (e) {
			$('reset-error').textContent = 'Could not reach the server.';
			$('reset-error').classList.remove('hidden');
		}
		$('reset-submit').disabled = false;
	}

	// ----------------------------------------------------------------------
	// Progress overlay
	// ----------------------------------------------------------------------
	const PROGRESS_STAGES = [
		{ until: 3,        text: 'Connecting to Trade Republic…' },
		{ until: 15,       text: 'Downloading your portfolio…' },
		{ until: 45,       text: 'Downloading transactions…' },
		{ until: 120,      text: 'Computing analytics…' },
		{ until: 180,      text: 'Almost done…' },
		{ until: Infinity, text: 'Still working, hang on…' },
	];
	let _progressStartedAt = null;

	function showProgressOverlay() {
		$('progress-overlay').classList.add('show');
		$('progress-stage').textContent = PROGRESS_STAGES[0].text;
		$('progress-elapsed').textContent = '0s';
		_progressStartedAt = Date.now();
	}
	function hideProgressOverlay() {
		$('progress-overlay').classList.remove('show');
		_progressStartedAt = null;
	}
	function startProgressPolling() {
		const tick = () => {
			if (_progressStartedAt == null) return;
			const elapsed = (Date.now() - _progressStartedAt) / 1000;
			const stage = PROGRESS_STAGES.find(s => elapsed < s.until)
				|| PROGRESS_STAGES[PROGRESS_STAGES.length - 1];
			const el = $('progress-stage');
			if (el && el.textContent !== stage.text) el.textContent = stage.text;
			$('progress-elapsed').textContent = Math.floor(elapsed) + 's';
		};
		tick();
		return setInterval(tick, 1000);
	}
	function stopProgressPolling(timer) { if (timer != null) clearInterval(timer); }

	function onConfigInput() {
		const phone = $('config-phone').value.trim();
		const pin = $('config-pin').value;
		const phoneOk = /^\+[1-9]\d{7,14}$/.test(phone);
		const pinOk = /^\d{4,6}$/.test(pin);
		$('config-submit').disabled = !(phoneOk && pinOk);
	}

	async function submitConfig() {
		const phone = $('config-phone').value.trim();
		const pin = $('config-pin').value;
		const btn = $('config-submit');
		const errEl = $('config-error');
		btn.disabled = true;
		btn.textContent = 'Saving...';
		try {
			const res = await postJson(routes.config, { phone, pin });
			const payload = await res.json();
			if (res.ok && payload.status === 'ok') {
				btn.textContent = 'Save';
				closeConfigModal();
				$('phone-label').textContent = 'Account: ' + maskPhone(phone);
				triggerUpdate();
				return;
			}
			errEl.textContent = payload.detail || 'Error saving credentials.';
			errEl.classList.remove('hidden');
		} catch (_) {
			errEl.textContent = 'Could not reach the server.';
			errEl.classList.remove('hidden');
		}
		btn.textContent = 'Save';
		onConfigInput();
	}

	function onMfaInput(e) {
		const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
		e.target.value = cleaned;
		$('mfa-submit').disabled = cleaned.length !== 4;
	}

	function submitMfa() {
		const code = $('mfa-input').value.trim();
		if (!(code.length === 4 && /^\d+$/.test(code))) return;
		$('mfa-submit').disabled = true;
		triggerUpdate(code);
	}

	// ----------------------------------------------------------------------
	// Wire-up
	// ----------------------------------------------------------------------
	document.addEventListener('DOMContentLoaded', () => {
		const root = $('tr-app');
		document.body.classList.add('tr-app-active');

		routes = {
			index:     root.dataset.routeIndex,
			analytics: root.dataset.routeAnalytics,
			data:      root.dataset.routeData,
			config:    root.dataset.routeConfig,
			update:    root.dataset.routeUpdate,
			reset:     root.dataset.routeReset,
		};

		$('update-btn').addEventListener('click', () => triggerUpdate());
		$('settings-btn').addEventListener('click', () => openConfigModal());
		$('search').addEventListener('input', renderTable);
		$('bucket-filter').addEventListener('change', renderTable);
		$('pnl-filter').addEventListener('change', renderTable);

		document.querySelectorAll('#positions-table th[data-sort]').forEach(th => {
			th.addEventListener('click', () => setSort(th.dataset.sort));
		});

		$('config-modal').addEventListener('click', (e) => {
			if (e.target.id === 'config-modal') closeConfigModal();
		});
		$('mfa-modal').addEventListener('click', (e) => {
			if (e.target.id === 'mfa-modal') closeMfaModal();
		});
		$('reset-modal').addEventListener('click', (e) => {
			if (e.target.id === 'reset-modal') closeResetModal();
		});
		$('config-cancel').addEventListener('click', closeConfigModal);
		$('config-reset').addEventListener('click', openResetModal);
		$('reset-cancel').addEventListener('click', closeResetModal);
		$('mfa-cancel').addEventListener('click', closeMfaModal);

		$('config-phone').addEventListener('input', onConfigInput);
		$('config-pin').addEventListener('input', onConfigInput);
		$('config-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitConfig(); });
		$('config-submit').addEventListener('click', submitConfig);

		$('reset-confirm').addEventListener('input', (e) => {
			$('reset-submit').disabled = e.target.value !== 'delete';
		});
		$('reset-confirm').addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && e.target.value === 'delete') submitReset();
		});
		$('reset-submit').addEventListener('click', submitReset);

		$('mfa-input').addEventListener('input', onMfaInput);
		$('mfa-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitMfa(); });
		$('mfa-submit').addEventListener('click', submitMfa);

		document.addEventListener('keydown', (e) => {
			if (e.key !== 'Escape') return;
			closeMfaModal();
			closeConfigModal();
			closeResetModal();
		});

		maybeShowConfigOnFirstLoad();
		load();
	});
})();
