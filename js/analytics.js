/* global OC */
/**
 * Trade Republic Portfolio — analytics page logic.
 *
 * Consumes /data/analytics + /data/last_update. Renders cash-flow cards,
 * monthly table, dividends, allocation and net-worth history.
 */
(function () {
	'use strict';

	let routes;
	const dataUrl = (type) => routes.data.replace('__TYPE__', type);
	const $ = (id) => document.getElementById(id);

	const fmtMoney = (n, opts) => {
		opts = opts || {};
		if (n == null || isNaN(n)) return '—';
		const decimals = opts.decimals != null ? opts.decimals : 2;
		const sign = opts.sign === true;
		const currency = opts.currency !== false;
		const abs = Math.abs(n);
		const formatted = abs.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
		const signPrefix = n < 0 ? '−' : (sign && n > 0 ? '+' : '');
		return signPrefix + (currency ? '€' : '') + formatted;
	};
	const fmtPct = (n) => {
		if (n == null || isNaN(n)) return '—';
		return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
	};
	const pnlClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted');
	const formatTimestamp = (raw) => {
		if (!raw) return '—';
		const s = String(raw).trim();
		const d = new Date(s.replace(' ', 'T'));
		if (isNaN(d.getTime())) return s;
		return d.toLocaleString('en-US', {
			year: 'numeric', month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit',
		});
	};

	async function load() {
		try {
			const opts = { cache: 'no-store', headers: { Accept: 'application/json' } };
			const [aRes, lastRes] = await Promise.all([
				fetch(dataUrl('analytics'), opts),
				fetch(dataUrl('last_update'), opts),
			]);
			const data = aRes.ok ? await aRes.json() : null;
			const lastUpdate = lastRes.ok ? (await lastRes.text()).trim() : '';
			$('last-update').textContent = formatTimestamp(lastUpdate);
			if (!data) {
				$('error-box').innerHTML =
					'<div class="error"><b>No analytics yet.</b><br>' +
					'Go back to the portfolio and click <code>⟳ Update Now</code>.</div>';
				return;
			}
			renderAll(data);
		} catch (err) {
			$('error-box').innerHTML =
				'<div class="error"><b>Could not load data.</b><br>' +
				(err.message || err) + '</div>';
		}
	}

	function renderAll(data) {
		const cf = data.cash_flow || {};
		$('cf-deposits').textContent = fmtMoney(cf.deposits && cf.deposits.total);
		$('cf-removals').textContent = fmtMoney(cf.removals && cf.removals.total);
		$('cf-net-in').textContent = fmtMoney(cf.net_capital_in);
		const lifeEl = $('cf-lifetime');
		lifeEl.textContent = fmtMoney(cf.lifetime_pl, { sign: true });
		lifeEl.className = 'value ' + pnlClass(cf.lifetime_pl);
		const pctEl = $('cf-lifetime-pct');
		pctEl.textContent = fmtPct(cf.lifetime_pl_pct);
		pctEl.className = 'delta ' + pnlClass(cf.lifetime_pl);

		// Monthly table
		const monthly = (cf.monthly || []).slice().reverse();
		$('monthly-tbody').innerHTML = monthly.length
			? monthly.map(m =>
				'<tr>' +
					'<td>' + m.month + '</td>' +
					'<td class="num">' + fmtMoney(m.deposits) + '</td>' +
					'<td class="num">' + fmtMoney(m.removals) + '</td>' +
					'<td class="num">' + fmtMoney(m.tax_refunds) + '</td>' +
					'<td class="num ' + pnlClass(m.net_flow) + '">' + fmtMoney(m.net_flow, { sign: true }) + '</td>' +
				'</tr>'
			).join('')
			: '<tr><td colspan="5" class="empty">No movements.</td></tr>';

		// Dividends
		const div = data.dividends || {};
		$('div-total').textContent = fmtMoney(div.total_received || 0);
		const recent = div.recent || [];
		$('dividends-tbody').innerHTML = recent.length
			? recent.map(d =>
				'<tr>' +
					'<td>' + (d.date || '—') + '</td>' +
					'<td>' + escapeHtml(d.name || '—') + '</td>' +
					'<td class="num pos">' + fmtMoney(d.amount, { sign: true }) + '</td>' +
				'</tr>'
			).join('')
			: '<tr><td colspan="3" class="empty">No dividends recorded.</td></tr>';

		// Allocation
		const alloc = data.allocation || { categories: {}, total: 0 };
		const total = alloc.total || 0;
		const cats = Object.entries(alloc.categories || {})
			.filter(([_, v]) => v > 0)
			.sort((a, b) => b[1] - a[1]);
		$('alloc-tbody').innerHTML = cats.length
			? cats.map(([name, val]) => {
				const pct = total > 0 ? (val / total) * 100 : 0;
				return '<tr>' +
					'<td>' + escapeHtml(name) + '</td>' +
					'<td class="num">' + fmtMoney(val) + '</td>' +
					'<td class="num">' + pct.toFixed(1) + '%</td>' +
				'</tr>';
			}).join('')
			: '<tr><td colspan="3" class="empty">No data.</td></tr>';

		// History (recent 180 days)
		const history = (data.history || []).slice(-180).reverse();
		$('history-count').textContent = history.length;
		$('history-tbody').innerHTML = history.length
			? history.map(h =>
				'<tr>' +
					'<td>' + h.date + '</td>' +
					'<td class="num">' + fmtMoney(h.value || h.net_value) + '</td>' +
					'<td class="num">' + fmtMoney(h.depot != null ? h.depot : '') + '</td>' +
					'<td class="num">' + fmtMoney(h.cash != null ? h.cash : '') + '</td>' +
				'</tr>'
			).join('')
			: '<tr><td colspan="4" class="empty">No history yet.</td></tr>';
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, c => ({
			'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
		}[c]));
	}

	document.addEventListener('DOMContentLoaded', () => {
		const root = $('tr-app');
		document.body.classList.add('tr-app-active');
		routes = {
			data:      root.dataset.routeData,
			analytics: root.dataset.routeAnalytics,
			index:     root.dataset.routeIndex,
		};
		load();
	});
})();
