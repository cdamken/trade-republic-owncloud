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
(function () {
'use strict';

const fmtEur = (n, d=2) => '€' + n.toLocaleString(undefined, {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtEur0 = (n) => '€' + n.toLocaleString(undefined, {maximumFractionDigits:0});

async function init() {
  const root = document.getElementById('tr-app');
  document.body.classList.add('tr-app-active');
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
  document.getElementById('cf-net').textContent = fmtEur0(cf.net_capital_in || 0);
  document.getElementById('cf-current').textContent = fmtEur0(cf.current_value || 0);

  const pl = cf.lifetime_pl || 0;
  const plPct = cf.lifetime_pl_pct || 0;
  document.getElementById('cf-pl').textContent = (pl >= 0 ? '+' : '−') + fmtEur0(Math.abs(pl));
  document.getElementById('cf-pl-pct').textContent = (plPct >= 0 ? '+' : '') + plPct.toFixed(2) + '%';
  document.getElementById('cf-pl-tile').classList.add(pl >= 0 ? 'pl-pos' : 'pl-neg');

  // Trading totals (raw numbers)
  document.getElementById('cf-buys').textContent = fmtEur0(cf.buys?.total || 0);
  document.getElementById('cf-buys-count').textContent = (cf.buys?.count || 0).toLocaleString();
  document.getElementById('cf-sells').textContent = fmtEur0(cf.sells?.total || 0);
  document.getElementById('cf-sells-count').textContent = (cf.sells?.count || 0).toLocaleString();
  document.getElementById('cf-net-traded').textContent = fmtEur0(cf.net_traded || 0);

  const monthly = cf.monthly || [];
  if (monthly.length > 0) {
    const avgNet = monthly.reduce((s, m) => s + m.net_flow, 0) / monthly.length;
    document.getElementById('cf-avg-month').textContent =
      (avgNet >= 0 ? '+' : '−') + fmtEur0(Math.abs(avgNet));
    document.getElementById('cf-month-count').textContent = monthly.length + ' months';

    const lastDepMonth = [...monthly].reverse().find(m => m.deposits > 0);
    if (lastDepMonth) {
      document.getElementById('cf-last-deposit').textContent = fmtEur0(lastDepMonth.deposits);
      document.getElementById('cf-last-deposit-date').textContent = lastDepMonth.month;
    }

    // Cumulative net capital (running sum of monthly net flows)
    let running = 0;
    const cumulative = monthly.map(m => {
      running += m.net_flow;
      return Math.round(running * 100) / 100;
    });

    new Chart(document.getElementById('cashFlowChart'), {
      type: 'bar',
      data: {
        labels: monthly.map(m => m.month),
        datasets: [
          { label: 'Deposits',      data: monthly.map(m => m.deposits),    backgroundColor: '#4ade80', borderRadius: 4, stack: 'in' },
          { label: 'Tax refunds',   data: monthly.map(m => m.tax_refunds), backgroundColor: '#60a5fa', borderRadius: 4, stack: 'in' },
          { label: 'Card spending', data: monthly.map(m => -m.removals),   backgroundColor: '#f87171', borderRadius: 4, stack: 'out' },
          {
            label: 'Cumulative net capital',
            type: 'line',
            data: cumulative,
            borderColor: '#fbbf24',
            backgroundColor: 'rgba(251, 191, 36, 0.06)',
            borderWidth: 3,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 6,
            fill: false,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#e8eef5', font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label + ': €' + ctx.parsed.y.toLocaleString(undefined, {maximumFractionDigits:0}),
            },
          },
        },
        scales: {
          y:  { stacked: true, position: 'left',  ticks: { color: '#e8eef5', callback: v => '€' + (v/1000).toFixed(1) + 'k' }, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Monthly flows', color: '#7a8599' } },
          y1: { position: 'right', ticks: { color: '#fbbf24', callback: v => '€' + (v/1000).toFixed(0) + 'k' }, grid: { display: false }, title: { display: true, text: 'Cumulative', color: '#fbbf24' } },
          x:  { stacked: true, ticks: { color: '#7a8599', maxRotation: 45 }, grid: { display: false } },
        },
      },
    });
  }

  // ============ Dividends & Allocation ============
  document.getElementById('div-total').textContent = '€' + (data.dividends?.total_received || 0).toLocaleString(undefined,{minimumFractionDigits:2});
  document.getElementById('alloc-total').textContent = '€' + (data.allocation?.total || 0).toLocaleString(undefined,{maximumFractionDigits:0});

  // 1. Allocation Chart
  if (data.allocation && data.allocation.total > 0) {
    new Chart(document.getElementById('allocationChart'), {
      type: 'doughnut',
      data: { labels: Object.keys(data.allocation.categories), datasets: [{ data: Object.values(data.allocation.categories), backgroundColor: ['#60a5fa','#4ade80','#fbbf24','#7a8599'], borderWidth: 0 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#e8eef5', font: { size: 22, weight: 'bold' }, padding: 30 } } }, cutout: '65%' }
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
    const yMin = Math.max(0, Math.floor((minV - padding) / 1000) * 1000);
    const yMax = Math.ceil((maxV + padding) / 1000) * 1000;

    if (historyChartInstance) historyChartInstance.destroy();
    historyChartInstance = new Chart(document.getElementById('historyChart'), {
      type: 'line',
      data: {
        labels: hist.map(h => h.date),
        datasets: [{
          data: values,
          borderColor: '#60a5fa',
          borderWidth: 3,
          tension: 0.3,
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHitRadius: 12,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => '€' + ctx.parsed.y.toLocaleString(undefined, {minimumFractionDigits:2}),
            },
          },
        },
        scales: {
          y: {
            min: yMin, max: yMax,
            ticks: {
              color: '#e8eef5', font: { size: 20, weight: 'bold' },
              padding: 12,
              callback: (v) => '€' + (v / 1000).toFixed(0) + 'k',
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          x: {
            ticks: { color: '#7a8599', font: { size: 12, weight: 'bold' }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            grid: { display: false },
          },
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

  // 3. Dividend Chart
  const divMonths = Object.keys(data.dividends?.monthly || {}).sort();
  if (divMonths.length > 0) {
    new Chart(document.getElementById('dividendChart'), {
      type: 'bar',
      data: { labels: divMonths, datasets: [{ data: divMonths.map(m=>data.dividends.monthly[m]), backgroundColor: '#4ade80', borderRadius: 8 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: '#e8eef5', font: { size: 16, weight: 'bold' } } },
          x: { ticks: { color: '#7a8599', font: { size: 16, weight: 'bold' } } }
        }
      }
    });
  }

  const recent = data.dividends?.recent || [];
  document.getElementById('recent-divs').innerHTML = recent.map(d =>
    "<tr><td class=\"date-cell\">" + d.date + "</td><td>" + d.name + "</td><td class=\"val\">+€" + d.amount.toFixed(2) + "</td></tr>"
  ).join('');
}

document.addEventListener('DOMContentLoaded', init);
})();
