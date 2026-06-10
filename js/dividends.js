/**
 * Dividends & Interest — port of Trade-Republic-Dashboard/app/dividends.html
 * inline JS. Same shape as analytics.js: reads route URLs from #tr-app
 * data-attributes, fetches analytics.json + portfolio.json, renders
 * cockpit + summary cards + monthly chart + searchable ledger.
 */
(function () {
  'use strict';

  let routes = {};
  let state = {
    rows: [],
    fromDate: null,
    toDate: null,
    sortKey: 'date',
    sortDir: 'desc',
    rangeMonths: 12,
  };
  let monthlyChartRef = null;

  // ============ Money / date formatters ============
  // fmtEur (local) replaced by _shared.js's fmtEURWithMinus in v0.1.42.
  // Same behaviour: "€1.23" / "−€1.23" — minus on negatives, no sign
  // on positives. The local declaration predated _shared.js becoming
  // a per-page global and lingered through the v0.1.40 refactor.
  const fmtEur = fmtEURWithMinus;
  const monthKey = (isoDate) => isoDate ? isoDate.slice(0, 7) : '';
  const monthLabel = (key) => {
    if (!key) return '';
    const [y, m] = key.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[+m - 1]} ${y}`;
  };
  const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // ============ Bootstrap ============
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('tr-app');
    if (!root) return;
    document.body.classList.add('tr-app-active');
    routes = {
      index:     root.dataset.routeIndex,
      analytics: root.dataset.routeAnalytics,
      settings:  root.dataset.routeSettings,
      glossary:  root.dataset.routeGlossary,
      dividends: root.dataset.routeDividends,
      data:      root.dataset.routeData,
    };
    loadCockpit();
    loadDividends();
    wireFilters();
    wireRangePills();
    wireSortHeaders();
  });

  // ============ Cockpit (read-only from portfolio.json) ============
  // fmtEUR / fmtPct come from js/_shared.js (loaded first by PageController).
  async function loadCockpit() {
    let d;
    try {
      const r = await fetch(routes.data.replace('__TYPE__', 'portfolio') + '?t=' + Date.now());
      if (!r.ok) return;
      d = await r.json();
    } catch (_) { return; }
    const s = d.summary;
    document.getElementById('ck-total').textContent = fmtEUR(s.total_netvalue);
    document.getElementById('ck-total-sub').textContent =
      `Depot ${fmtEUR(s.depot_netvalue)} + Cash ${fmtEUR(s.cash_eur)} · ${d.positions_with_value} positions`;
    document.getElementById('ck-cost').textContent = fmtEUR(s.depot_buycost);
    document.getElementById('ck-pl').textContent = fmtEUR(s.depot_pl_eur);
    document.getElementById('ck-pl-pct').textContent = fmtPct(s.depot_pl_pct);
    document.getElementById('ck-cash').textContent = fmtEUR(s.cash_eur);

    const labels = {
      stocksAndETFs:  ['📈 Brokerage (Stocks/ETFs)', 'asset-equity'],
      bonds:          ['🏛 Bonds', 'asset-bonds'],
      privateMarkets: ['🔒 Private Equity', 'asset-pe'],
      cryptos:        ['🪙 Crypto', 'asset-crypto'],
      others:         ['· Others', 'asset-cash'],
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
  }

  // ============ Dividends payload ============
  async function loadDividends() {
    const lbl = document.getElementById('range-label');
    try {
      const r = await fetch(routes.data.replace('__TYPE__', 'analytics') + '?t=' + Date.now());
      if (!r.ok) {
        lbl.textContent = 'No analytics data yet — run Update Now.';
        return;
      }
      const d = await r.json();
      const div = d.dividends || {};
      state.rows = div.all_payments || div.recent || [];
      const dates = state.rows.map(p => p.date).filter(Boolean).sort();
      state.fromDate = dates[0] || null;
      state.toDate = dates[dates.length - 1] || null;
      lbl.textContent = state.fromDate
        ? `${formatDate(state.fromDate)} → ${formatDate(state.toDate)}`
        : 'No payments recorded';
      populateFilters();
      renderCards();
      renderChart();
      renderTable();
    } catch (err) {
      lbl.textContent = 'Error loading: ' + err.message;
    }
  }

  function populateFilters() {
    const months = [...new Set(state.rows.map(p => monthKey(p.date)))].filter(Boolean).sort().reverse();
    const monthSel = document.getElementById('div-month-filter');
    for (const m of months) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = monthLabel(m);
      monthSel.appendChild(opt);
    }
    const issuers = [...new Set(state.rows.map(p => p.name).filter(Boolean))].sort();
    const issuerSel = document.getElementById('div-issuer-filter');
    for (const name of issuers) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      issuerSel.appendChild(opt);
    }
  }

  // ============ Summary cards ============
  function renderCards() {
    const divs = state.rows.filter(p => p.type === 'Dividend');
    const ints = state.rows.filter(p => p.type === 'Interest');
    const divSum = divs.reduce((s, p) => s + (p.amount || 0), 0);
    const intSum = ints.reduce((s, p) => s + (p.amount || 0), 0);
    const total = divSum + intSum;
    const issuers = new Set(divs.map(p => p.isin).filter(Boolean)).size;

    document.getElementById('card-total-net').textContent = fmtEur(total);
    document.getElementById('card-total-detail').textContent =
      `${state.rows.length} payment(s) · ${divs.length} div + ${ints.length} int`;
    document.getElementById('card-divs').textContent = fmtEur(divSum);
    document.getElementById('card-divs-detail').textContent = `${divs.length} payments`;
    document.getElementById('card-int').textContent = fmtEur(intSum);
    document.getElementById('card-int-detail').textContent = `${ints.length} payments`;
    document.getElementById('card-issuers').textContent = issuers;
    document.getElementById('card-issuers-detail').textContent = 'unique ISINs paying dividends';
  }

  // ============ Monthly chart ============
  function renderChart() {
    const buckets = {};
    for (const p of state.rows) {
      const m = monthKey(p.date); if (!m) continue;
      if (!buckets[m]) buckets[m] = { Dividend: 0, Interest: 0 };
      if (p.type === 'Dividend' || p.type === 'Interest') {
        buckets[m][p.type] += p.amount || 0;
      }
    }
    let months = Object.keys(buckets).sort();
    if (state.rangeMonths !== 'all') {
      months = months.slice(-state.rangeMonths);
    }
    const divSeries = months.map(m => buckets[m].Dividend);
    const intSeries = months.map(m => buckets[m].Interest);

    const ctx = document.getElementById('monthlyChart');
    if (!ctx) return;
    if (monthlyChartRef) monthlyChartRef.destroy();
    monthlyChartRef = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(monthLabel),
        datasets: [
          { label: 'Dividends', data: divSeries, backgroundColor: 'rgba(74,222,128,0.7)', borderRadius: 6 },
          { label: 'Interest',  data: intSeries, backgroundColor: 'rgba(192,132,252,0.7)', borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#e8eef5', font: { size: 12 } } },
          tooltip: {
            backgroundColor: 'rgba(15,20,25,0.95)', titleColor: '#e8eef5',
            bodyColor: '#e8eef5', borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1, cornerRadius: 8, padding: 12,
            callbacks: { label: (c) => `${c.dataset.label}: €${c.parsed.y.toFixed(2)}` },
          },
        },
        scales: {
          x: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7a8599' } },
          y: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' },
               ticks: { color: '#7a8599', callback: v => '€' + v.toFixed(0) } },
        },
      },
    });
  }

  function wireRangePills() {
    document.querySelectorAll('#range-pills button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#range-pills button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const r = btn.dataset.range;
        state.rangeMonths = r === 'all' ? 'all' : parseInt(r, 10);
        renderChart();
      });
    });
  }

  // ============ Filters + table ============
  function wireFilters() {
    ['div-search', 'div-kind-filter', 'div-month-filter', 'div-issuer-filter'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderTable);
    });
  }

  function wireSortHeaders() {
    document.querySelectorAll('#payments-table th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key; state.sortDir = 'desc';
        }
        renderTable();
      });
    });
  }

  function kindPill(p) {
    if (p.type === 'Dividend') return '<span class="kind-pill kind-dividend">Dividend</span>';
    if (p.type === 'Interest') return '<span class="kind-pill kind-interest">Interest</span>';
    return '<span class="kind-pill kind-other">Other</span>';
  }

  function renderTable() {
    const search = document.getElementById('div-search').value.toLowerCase();
    const kindFilter = document.getElementById('div-kind-filter').value;
    const monthFilter = document.getElementById('div-month-filter').value;
    const issuerFilter = document.getElementById('div-issuer-filter').value;

    let rows = state.rows.filter(p => {
      const blob = ((p.name || '') + ' ' + (p.isin || '')).toLowerCase();
      if (search && !blob.includes(search)) return false;
      if (kindFilter && p.type !== kindFilter) return false;
      if (monthFilter && monthKey(p.date) !== monthFilter) return false;
      if (issuerFilter && p.name !== issuerFilter) return false;
      return true;
    });

    rows.sort((a, b) => {
      const va = a[state.sortKey];
      const vb = b[state.sortKey];
      if (typeof va === 'string' && typeof vb === 'string') {
        return state.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return state.sortDir === 'asc' ? ((va || 0) - (vb || 0)) : ((vb || 0) - (va || 0));
    });

    document.getElementById('rows-count').textContent = `${rows.length} / ${state.rows.length}`;
    // Cap the visible rows at LIMIT to keep the table glanceable.
    // The user sees the top of whatever sort they picked (date desc by
    // default → newest 50). The label adapts to whether filters are
    // narrowing the result so it never says "first 50" when actually
    // the user is looking at top-N of a sorted+filtered subset.
    const LIMIT = 50;
    const isFiltered = rows.length < state.rows.length;
    const truncated = rows.length > LIMIT;
    const visible = truncated ? rows.slice(0, LIMIT) : rows;

    const tbody = document.getElementById('payments-tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No payments match the current filters</td></tr>';
      return;
    }
    let html = visible.map(p =>
      '<tr>' +
        '<td>' + formatDate(p.date) + '</td>' +
        '<td class="ticker">' + (p.name || '—') + '</td>' +
        '<td class="tx-isin">' + (p.isin || '—') + '</td>' +
        '<td>' + kindPill(p) + '</td>' +
        '<td class="num">' + fmtEur(p.amount || 0) + '</td>' +
      '</tr>'
    ).join('');
    if (truncated) {
      const sortLabel = state.sortKey === 'date' && state.sortDir === 'desc'
        ? 'newest'
        : state.sortKey === 'date' && state.sortDir === 'asc'
        ? 'oldest'
        : 'top';
      const matchHint = isFiltered ? ' matching the filters' : '';
      html += '<tr><td colspan="5" class="empty">showing ' + sortLabel + ' ' + LIMIT
            + ' of ' + rows.length + matchHint
            + ' — refine ' + (isFiltered ? 'further' : 'with filters above') + '</td></tr>';
    }
    tbody.innerHTML = html;
  }
})();
