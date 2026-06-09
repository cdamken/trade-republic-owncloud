/**
 * Glossary page — only needs to populate the sticky cockpit (rest is static HTML).
 * Same pattern as analytics.js loadCockpit().
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('tr-app');
    if (!root) return;
    document.body.classList.add('tr-app-active');

    const dataUrl = root.dataset.routeData.replace('__TYPE__', 'portfolio');
    let d;
    try {
      const r = await fetch(dataUrl + '?t=' + Date.now());
      if (!r.ok) return;
      d = await r.json();
    } catch (_) { return; }

    const s = d.summary;
    // fmtEUR / fmtPct come from js/_shared.js (loaded first by PageController).

    document.getElementById('ck-total').textContent = fmtEUR(s.total_netvalue);
    document.getElementById('ck-total-sub').textContent =
      'Depot ' + fmtEUR(s.depot_netvalue) + ' + Cash ' + fmtEUR(s.cash_eur) +
      ' · ' + d.positions_with_value + ' positions';
    document.getElementById('ck-cost').textContent = fmtEUR(s.depot_buycost);
    document.getElementById('ck-pl').textContent = fmtEUR(s.depot_pl_eur);
    document.getElementById('ck-pl-pct').textContent = fmtPct(s.depot_pl_pct);
    document.getElementById('ck-cash').textContent = fmtEUR(s.cash_eur);

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
        '<div class="b-value ' + color + '">' + fmtEUR(b.net_value_eur) + '</div>' +
        '<div class="b-sub">' + b.count + ' pos · ' + fmtPct(b.pl_pct) + '</div></div>');
    }
    pills.push('<div class="b-pill"><div class="b-label">💶 Cash</div>' +
      '<div class="b-value asset-cash">' + fmtEUR(s.cash_eur) + '</div>' +
      '<div class="b-sub">to invest / withdraw</div></div>');
    document.getElementById('ck-buckets').innerHTML = pills.join('');
  });
})();
