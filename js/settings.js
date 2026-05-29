/**
 * Settings page wiring — Account save, Reset everything, plus the shared
 * sticky cockpit. All POSTs include ownCloud's CSRF requesttoken header.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('tr-app');
    if (!root) return;
    document.body.classList.add('tr-app-active');
    const routes = {
      index:        root.dataset.routeIndex,
      analytics:    root.dataset.routeAnalytics,
      settings:     root.dataset.routeSettings,
      glossary:     root.dataset.routeGlossary,
      data:         root.dataset.routeData,
      config:       root.dataset.routeConfig,
      update:       root.dataset.routeUpdate,
      reset:        root.dataset.routeReset,
      downloadDocs: root.dataset.routeDownloadDocs,
    };

    // Populate cockpit
    loadCockpit(routes);

    // Load current phone
    try {
      const r = await fetch(routes.config);
      if (r.ok) {
        const j = await r.json();
        if (j.phone) document.getElementById('setting-phone').value = j.phone;
      }
    } catch (_) {}

    // Sidebar active-link tracking
    document.querySelectorAll('.settings-side a').forEach(a => {
      a.addEventListener('click', () => {
        document.querySelectorAll('.settings-side a').forEach(l => l.classList.remove('active'));
        a.classList.add('active');
      });
    });

    // Save Account
    document.getElementById('save-account-btn').addEventListener('click', async () => {
      const phone = document.getElementById('setting-phone').value.trim();
      const pin = document.getElementById('setting-pin').value.trim();
      if (!/^\+\d{8,15}$/.test(phone)) {
        return setStatus('account-status', 'Phone must look like +4912345678', 'err');
      }
      if (!/^\d{4,6}$/.test(pin)) {
        return setStatus('account-status', 'PIN must be 4–6 digits', 'err');
      }
      setStatus('account-status', 'Saving…');
      const r = await fetch(routes.config, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
        body: JSON.stringify({ phone, pin }),
      });
      if (r.ok) {
        setStatus('account-status', '✓ Saved — go to Portfolio and click Update Now to authenticate', 'ok');
        document.getElementById('setting-pin').value = '';
      } else {
        setStatus('account-status', 'Save failed', 'err');
      }
    });

    // Reset everything
    document.getElementById('reset-all-btn').addEventListener('click', async () => {
      if (!confirm('Permanently wipe ALL data, credentials, and session cookies for your TR account?\n\nYou will need to log in again from scratch. This cannot be undone.')) return;
      if (prompt('Type "delete" to confirm') !== 'delete') return;
      setStatus('reset-status', 'Resetting…');
      const r = await fetch(routes.reset, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
        body: JSON.stringify({ confirm: 'delete' }),
      });
      if (r.ok) {
        setStatus('reset-status', '✓ Wiped — redirecting to Portfolio…', 'ok');
        setTimeout(() => location.href = routes.index, 1500);
      } else {
        setStatus('reset-status', 'Reset failed', 'err');
      }
    });
  });

  function setStatus(id, msg, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'status-msg' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    if (kind === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'status-msg'; }, 4000);
  }

  async function loadCockpit(routes) {
    const fmtE = (n) => '€' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtP = (n) => (n >= 0 ? '+' : '') + (n || 0).toFixed(2) + '%';
    let d;
    try {
      const r = await fetch(routes.data.replace('__TYPE__', 'portfolio') + '?t=' + Date.now());
      if (!r.ok) return;
      d = await r.json();
    } catch (_) { return; }
    const s = d.summary;
    document.getElementById('ck-total').textContent = fmtE(s.total_netvalue);
    document.getElementById('ck-total-sub').textContent =
      'Depot ' + fmtE(s.depot_netvalue) + ' + Cash ' + fmtE(s.cash_eur) +
      ' · ' + d.positions_with_value + ' positions';
    document.getElementById('ck-cost').textContent = fmtE(s.depot_buycost);
    document.getElementById('ck-pl').textContent = fmtE(s.depot_pl_eur);
    document.getElementById('ck-pl-pct').textContent = fmtP(s.depot_pl_pct);
    document.getElementById('ck-cash').textContent = fmtE(s.cash_eur);

    const labels = {
      stocksAndETFs: ['📈 Brokerage (Stocks/ETFs)', 'asset-equity'],
      bonds: ['🏛 Bonds', 'asset-bonds'],
      privateMarkets: ['🔒 Private Equity', 'asset-pe'],
      cryptos: ['🪙 Crypto', 'asset-crypto'],
      others: ['· Others', 'asset-cash'],
    };
    const by = s.by_category || {};
    const pills = [];
    for (const k of ['stocksAndETFs', 'bonds', 'privateMarkets', 'cryptos', 'others']) {
      const b = by[k];
      if (!b || !b.count) continue;
      const [name, color] = labels[k];
      pills.push('<div class="b-pill"><div class="b-label">' + name + '</div>' +
        '<div class="b-value ' + color + '">' + fmtE(b.net_value_eur) + '</div>' +
        '<div class="b-sub">' + b.count + ' pos · ' + fmtP(b.pl_pct) + '</div></div>');
    }
    pills.push('<div class="b-pill"><div class="b-label">💶 Cash</div>' +
      '<div class="b-value asset-cash">' + fmtE(s.cash_eur) + '</div>' +
      '<div class="b-sub">to invest / withdraw</div></div>');
    document.getElementById('ck-buckets').innerHTML = pills.join('');
  }
})();
