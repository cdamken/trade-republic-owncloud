/* global Chart */
/**
 * Trade Republic Portfolio — analytics page logic.
 *
 * VERBATIM port of Trade-Republic-Dashboard/app/analytics.html (lines 191-419).
 * Only patch:
 *   - `fetch('../DATA/analytics.json')` → `fetch(routes.data.replace('__TYPE__','analytics'))`.
 *
 * Chart.js is loaded by PageController via Util::addScript('vendor/chart.umd.min.js')
 * so it's available globally at this point.
 */
// ============ Chart styling helpers (shared) ============
// Mirrors Trade-Republic-Dashboard/app/analytics.html. Vertical gradient
// for bar/area fills; subtle axis styling; custom tooltip; smooth easing.
function vGradient(ctx, chartArea, hex, alphaTop = 0.85, alphaBottom = 0.15) {
  if (!chartArea) return hex;
  const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  const rgb = hex.length === 9 ? hex.slice(0, 7) : hex;
  const toRgba = (h, a) => {
    const r = parseInt(h.slice(1, 3), 16);
    const gg = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return `rgba(${r},${gg},${b},${a})`;
  };
  g.addColorStop(0, toRgba(rgb, alphaTop));
  g.addColorStop(1, toRgba(rgb, alphaBottom));
  return g;
}
const AXIS_BASE = {
  grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false, tickLength: 0 },
  border: { display: false },
  ticks: { color: '#7a8599', font: { size: 12, weight: '500' }, padding: 8 },
};
const TOOLTIP = {
  backgroundColor: 'rgba(15, 20, 25, 0.95)',
  titleColor: '#e8eef5', titleFont: { size: 12, weight: '600' },
  bodyColor: '#e8eef5', bodyFont: { size: 13 },
  padding: 12, borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
  cornerRadius: 8, displayColors: true, boxPadding: 6,
};
const ANIMATION = { duration: 700, easing: 'easeOutQuart' };

(function () {
'use strict';

const fmtEur = (n, d=2) => '€' + n.toLocaleString(undefined, {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtEur0 = (n) => '€' + n.toLocaleString(undefined, {maximumFractionDigits:0});

// Populate the sticky cockpit from portfolio.json (separate request from
// analytics.json — kept here so this page is self-contained for the header).
async function loadCockpit(root) {
  try {
    const url = root.dataset.routeData.replace('__TYPE__', 'portfolio');
    const r = await fetch(url + '?t=' + Date.now());
    if (!r.ok) return;
    const d = await r.json();
    const s = d.summary;
    const fmtE = (n) => '€' + (n || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    const fmtP = (n) => (n >= 0 ? '+' : '') + (n || 0).toFixed(2) + '%';
    document.getElementById('ck-total').textContent = fmtE(s.total_netvalue);
    document.getElementById('ck-total-sub').textContent =
      'Depot ' + fmtE(s.depot_netvalue) + ' + Cash ' + fmtE(s.cash_eur) + ' · ' + d.positions_with_value + ' positions';
    document.getElementById('ck-cost').textContent = fmtE(s.depot_buycost);
    document.getElementById('ck-pl').textContent = fmtE(s.depot_pl_eur);
    document.getElementById('ck-pl-pct').textContent = fmtP(s.depot_pl_pct);
    document.getElementById('ck-cash').textContent = fmtE(s.cash_eur);

    const labels = {
      stocksAndETFs: ['📈 Brokerage (Stocks/ETFs)','asset-equity'],
      bonds: ['🏛 Bonds','asset-bonds'],
      privateMarkets: ['🔒 Private Equity','asset-pe'],
      cryptos: ['🪙 Crypto','asset-crypto'],
      others: ['· Others','asset-cash'],
    };
    const by = s.by_category || {};
    const pills = [];
    for (const k of ['stocksAndETFs','bonds','privateMarkets','cryptos','others']) {
      const b = by[k]; if (!b || !b.count) continue;
      const [name, color] = labels[k];
      pills.push('<div class="b-pill"><div class="b-label">' + name + '</div>' +
        '<div class="b-value ' + color + '">' + fmtE(b.net_value_eur) + '</div>' +
        '<div class="b-sub">' + b.count + ' pos · ' + fmtP(b.pl_pct) + '</div></div>');
    }
    pills.push('<div class="b-pill"><div class="b-label">💶 Cash</div>' +
      '<div class="b-value asset-cash">' + fmtE(s.cash_eur) + '</div>' +
      '<div class="b-sub">to invest / withdraw</div></div>');
    document.getElementById('ck-buckets').innerHTML = pills.join('');
  } catch (_) { /* portfolio.json not yet — leave placeholders */ }
}

async function init() {
  const root = document.getElementById('tr-app');
  document.body.classList.add('tr-app-active');
  loadCockpit(root);  // fire-and-forget — independent of analytics data
  const dataUrl = root.dataset.routeData.replace('__TYPE__', 'analytics');

  let data;
  try {
    const res = await fetch(dataUrl + '?t=' + Date.now());
    if (!res.ok) {
      // No analytics yet (first install). Show a friendly note instead of crashing.
      document.body.insertAdjacentHTML('afterbegin',
        '<div style="background:rgba(251,191,36,0.1); border-left:4px solid #fbbf24; padding:16px 20px; border-radius:8px; margin:20px 0; font-size:14px; color:#e8eef5;">' +
        '⚠️ No analytics yet — go to <a href="' + root.dataset.routeIndex + '" style="color:#60a5fa">Portfolio</a> and click <b>Update Now</b> first.</div>');
      return;
    }
    data = await res.json();
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="background:rgba(248,113,113,0.1); border-left:4px solid #f87171; padding:16px 20px; border-radius:8px; margin:20px 0; color:#e8eef5;">' +
      'Could not load analytics: ' + e.message + '</div>');
    return;
  }

  // ============ Cash Flow ============
  const cf = data.cash_flow || {};
  document.getElementById('cf-deposits').textContent = fmtEur0(cf.deposits?.total || 0);
  document.getElementById('cf-deposits-count').textContent = cf.deposits?.count || 0;
  document.getElementById('cf-refunds').textContent = fmtEur0(cf.tax_refunds?.total || 0);
  document.getElementById('cf-refunds-count').textContent = cf.tax_refunds?.count || 0;
  document.getElementById('cf-removals').textContent = fmtEur0(cf.removals?.total || 0);
  document.getElementById('cf-removals-count').textContent = cf.removals?.count || 0;
  // Withdrawal tile (new 2026-05-28). Guard for missing element so old
  // cached templates don't error.
  const wEl = document.getElementById('cf-withdrawals');
  if (wEl) {
    wEl.textContent = fmtEur0(cf.withdrawals?.total || 0);
    document.getElementById('cf-withdrawals-count').textContent = cf.withdrawals?.count || 0;
  }
  document.getElementById('cf-net').textContent = fmtEur0(cf.net_capital_in || 0);
  document.getElementById('cf-current').textContent = fmtEur0(cf.current_value || 0);

  // Lifetime P/L: null means fetch_wrapper.py decided the data was too
  // incomplete (net_capital_in <= 0, typically because of the
  // timelineActivityLog gap) to compute meaningfully. Show "—" instead of
  // a misleading "€0.00 (+0.00%)". Mirrors the upstream fix in
  // Trade-Republic-Dashboard/app/analytics.html.
  if (cf.lifetime_pl === null || cf.lifetime_pl === undefined) {
    document.getElementById('cf-pl').textContent = '—';
    document.getElementById('cf-pl').style.fontSize = '24px';
    document.getElementById('cf-pl-pct').textContent = 'incomplete data';
    document.getElementById('cf-pl-pct').title = cf.lifetime_pl_note || '';
    document.getElementById('cf-pl-pct').style.fontStyle = 'italic';
  } else {
    const pl = cf.lifetime_pl;
    const plPct = cf.lifetime_pl_pct || 0;
    document.getElementById('cf-pl').textContent = (pl >= 0 ? '+' : '−') + fmtEur0(Math.abs(pl));
    document.getElementById('cf-pl-pct').textContent = (plPct >= 0 ? '+' : '') + plPct.toFixed(2) + '%';
    document.getElementById('cf-pl-tile').classList.add(pl >= 0 ? 'pl-pos' : 'pl-neg');
  }

  // Income forecast (forward 12mo dividends + yield on cost) + trading totals
  const div = data.dividends || {};
  const fwd = div.forward_12mo;
  const fwdEl = document.getElementById('cf-fwd-div');
  const fwdSub = document.getElementById('cf-fwd-div-sub');
  if (fwd != null) {
    fwdEl.textContent = '€' + fwd.toLocaleString(undefined, {maximumFractionDigits: 0});
    fwdEl.style.color = 'var(--green)';
    fwdSub.textContent = 'From ' + (div.forward_12mo_payments_used || 0) + ' payments · ' +
                         (div.forward_12mo_basis_days || 0) + ' days basis';
  } else {
    fwdEl.textContent = '—';
    fwdSub.textContent = 'Need ≥90 days of Dividend history';
  }
  const yoc = div.yield_on_cost;
  document.getElementById('cf-yoc').textContent =
    yoc != null ? yoc.toFixed(2) + '%' : '—';
  // Buys/Sells remain — but with less prominent positioning (they're context, not headline).
  document.getElementById('cf-buys').textContent = fmtEur0(cf.buys?.total || 0);
  document.getElementById('cf-buys-count').textContent = (cf.buys?.count || 0).toLocaleString();
  document.getElementById('cf-sells').textContent = fmtEur0(cf.sells?.total || 0);
  document.getElementById('cf-sells-count').textContent = (cf.sells?.count || 0).toLocaleString();

  // Top/bottom contributors table removed — Portfolio tab covers it.

  const monthly = cf.monthly || [];
  if (monthly.length > 0) {
    const avgNet = monthly.reduce((s, m) => s + m.net_flow, 0) / monthly.length;
    document.getElementById('cf-avg-month').textContent =
      (avgNet >= 0 ? '+' : '−') + fmtEur0(Math.abs(avgNet));
    document.getElementById('cf-month-count').textContent = monthly.length + ' months';

    const lastDepMonth = [...monthly].reverse().find(m => m.deposits > 0);
    if (lastDepMonth) {
      // Tile dropped in the 2026-05-28 refactor; guard against null
      // when an older cached template lacks the element.
      const ldEl = document.getElementById('cf-last-deposit');
      if (ldEl) {
        ldEl.textContent = fmtEur0(lastDepMonth.deposits);
        document.getElementById('cf-last-deposit-date').textContent = lastDepMonth.month;
      }
    }

  }

  // Capital invested over time chart removed 2026-06-01 — see analytics
  // research note. Replaced by the benchmark overlay on the Net Worth chart
  // below (much more actionable: "did I beat the index?").

  // ============ Allocation (dividends moved to dividends.php, 2026-05-29) ============
  document.getElementById('alloc-total').textContent = '€' + (data.allocation?.total || 0).toLocaleString(undefined,{maximumFractionDigits:0});

  // 1. Allocation Chart — thinner ring + card-bg borders for separation.
  if (data.allocation && data.allocation.total > 0) {
    new Chart(document.getElementById('allocationChart'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(data.allocation.categories),
        datasets: [{
          data: Object.values(data.allocation.categories),
          backgroundColor: ['#60a5fa','#4ade80','#fbbf24','#7a8599'],
          borderColor: '#1a1f2e', borderWidth: 3, hoverOffset: 12,
          hoverBorderWidth: 3, spacing: 2,
        }],
      },
      options: {
        maintainAspectRatio: false,
        animation: { ...ANIMATION, animateRotate: true, animateScale: false },
        cutout: '70%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#e8eef5', font: { size: 14, weight: '600' },
              padding: 20, usePointStyle: true, pointStyle: 'circle',
              boxWidth: 12, boxHeight: 12,
            },
          },
          tooltip: { ...TOOLTIP,
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
                const pct = total > 0 ? (ctx.parsed / total * 100) : 0;
                return ' ' + ctx.label + ': €' + ctx.parsed.toLocaleString(undefined, {maximumFractionDigits:0}) + '  (' + pct.toFixed(1) + '%)';
              },
            },
          },
        },
      },
    });
  }

  // 2. History Chart — with range selector (1W / 1M / 3M / 6M / 1Y / All)
  let historyChartInstance = null;
  const fullHistory = data.history || [];

  function filterHistory(range) {
    if (range === 'ALL' || fullHistory.length === 0) return fullHistory;
    const daysMap = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
    const days = daysMap[range];
    if (!days) return fullHistory;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = fullHistory.filter(h => new Date(h.date) >= cutoff);
    return filtered.length > 0 ? filtered : fullHistory.slice(-1);
  }

  function renderHistoryChart(range) {
    const hist = filterHistory(range);
    if (hist.length === 0) return;

    const lastValue = hist[hist.length - 1].value;
    const firstValue = hist[0].value;
    document.getElementById('history-current').textContent =
      '€' + lastValue.toLocaleString(undefined, {minimumFractionDigits:2});

    if (hist.length > 1) {
      const delta = lastValue - firstValue;
      const pct = (delta / firstValue) * 100;
      const sign = delta >= 0 ? '+' : '−';
      const color = delta >= 0 ? 'var(--green)' : 'var(--red)';
      const rangeLabel = range === 'ALL' ? 'all-time' : range;
      document.getElementById('history-substat').innerHTML =
        `<span style="color:${color}">${sign}€${Math.abs(delta).toLocaleString(undefined,{maximumFractionDigits:0})} (${sign}${Math.abs(pct).toFixed(2)}%)</span>` +
        ` over the last ${rangeLabel} · ${hist.length} daily snapshots`;
    } else {
      document.getElementById('history-substat').textContent =
        'Total portfolio value (positions + cash) over time';
    }

    const values = hist.map(h => h.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const padding = (maxV - minV) * 0.1 || 100;
    // Let yMin go negative so losses (e.g. periods where withdrawals + card
    // spending exceeded deposits) show up below the zero line instead of
    // being silently clamped to 0.
    const yMin = Math.floor((minV - padding) / 1000) * 1000;
    const yMax = Math.ceil((maxV + padding) / 1000) * 1000;

    // Benchmark overlay — IWDA.AS (MSCI World), if backend fetched it.
    // Aligned by date to the user's history; missing months stay null
    // so Chart.js skips those points instead of drawing zero.
    const bench = (data.benchmark || {}).history || [];
    let benchAligned = null;
    if (bench.length) {
      const benchByMonth = {};
      for (const b of bench) benchByMonth[b.date.slice(0, 7)] = b.value;
      benchAligned = hist.map(h => {
        const v = benchByMonth[h.date.slice(0, 7)];
        return v == null ? null : v;
      });
    }

    if (historyChartInstance) historyChartInstance.destroy();
    const datasets = [{
      label: 'Your portfolio',
      data: values,
      borderColor: '#60a5fa',
      backgroundColor: (c) => vGradient(c.chart.ctx, c.chart.chartArea, '#60a5fa', 0.30, 0.00),
      borderWidth: 2.5,
      tension: 0.4,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHitRadius: 16,
      pointBackgroundColor: '#60a5fa',
      pointBorderColor: '#0f1419',
      pointBorderWidth: 2,
    }];
    if (benchAligned) {
      datasets.push({
        label: 'MSCI World (same cash flows)',
        data: benchAligned,
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251, 191, 36, 0.05)',
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.4,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: '#fbbf24',
        pointBorderColor: '#0f1419',
        pointBorderWidth: 2,
        spanGaps: true,
      });
    }
    historyChartInstance = new Chart(document.getElementById('historyChart'), {
      type: 'line',
      data: { labels: hist.map(h => h.date), datasets },
      options: {
        maintainAspectRatio: false,
        animation: ANIMATION,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: !!benchAligned,
                    labels: { color: '#e8eef5', font: { size: 12, weight: '500' },
                              usePointStyle: true, pointStyle: 'rectRounded', padding: 12 } },
          tooltip: { ...TOOLTIP,
            callbacks: {
              title: (items) => items[0]?.label || '',
              label: (ctx) => ' ' + (ctx.dataset.label || '') + ': €' +
                              ctx.parsed.y.toLocaleString(undefined, {minimumFractionDigits:2}),
            },
          },
        },
        scales: {
          y: {
            ...AXIS_BASE,
            min: yMin, max: yMax,
            ticks: {
              ...AXIS_BASE.ticks,
              color: '#e8eef5', font: { size: 13, weight: '600' },
              padding: 12,
              callback: (v) => '€' + (v / 1000).toFixed(0) + 'k',
            },
          },
          x: { ...AXIS_BASE,
               ticks: { ...AXIS_BASE.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
               grid: { display: false } },
        },
      },
    });
  }

  if (fullHistory.length > 0) {
    renderHistoryChart('ALL');
    document.querySelectorAll('#history-range button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#history-range button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderHistoryChart(btn.dataset.range);
      });
    });
  }

  // 3. Dividend Chart + 4. By-issuer table + 5. Full ledger moved to
  // templates/dividends.php (2026-05-29). renderDividendsByIssuer,
  // renderDividendLedger, renderLedgerRows, wireDividendFilters and the
  // _divLedgerState helper were removed with them.
}

// renderDividendsByIssuer / renderDividendLedger / renderLedgerRows /
// wireDividendFilters removed 2026-05-29 — see templates/dividends.php +
// js/dividends.js for the new GBM-style implementation.

// renderContributors removed 2026-06-01 — Portfolio tab already has
// Top Winners + Top Losers. Avoid duplication.

document.addEventListener('DOMContentLoaded', init);
})();
