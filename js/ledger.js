/* global OC */
/**
 * Ledger page logic — verbatim port of Trade-Republic-Dashboard
 * commit a401156 (with 66cc26d's _shared.js + a25f890's brand palette).
 *
 * Same ownCloud patches as orders.js: CSV via routes.data,
 * addEventListener instead of inline on* attrs, shared helpers from
 * js/_shared.js.
 */
(function () {
'use strict';

const state = {
  rows: [],
  sortKey: 'Date',
  sortDir: 'desc',
};
let dataUrl;

function catClass(type) {
  if (type === 'Buy')        return 'cat-buy';
  if (type === 'Sell')       return 'cat-sell';
  if (type === 'Dividend')   return 'cat-dividend';
  if (type === 'Interest')   return 'cat-interest';
  if (type === 'Deposit')    return 'cat-deposit';
  if (type === 'Withdrawal') return 'cat-withdrawal';
  if (type === 'Removal')    return 'cat-removal';
  if (type === 'Tax Refund') return 'cat-tax-refund';
  return 'cat-other';
}

async function load() {
  try {
    const res = await fetch(dataUrl + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) {
      document.getElementById('error-box').innerHTML =
        '<div class="warning"><b>No transactions data yet.</b> Click <b>🔄 Update Now</b> above to fetch from Trade Republic.</div>';
      return;
    }
    const text = await res.text();
    state.rows = parseCsv(text);
    for (const r of state.rows) {
      r._value = Number(r.Value) || 0;
      r._abs   = Math.abs(r._value);
    }
    document.getElementById('error-box').innerHTML = '';
    populateMonthFilter();
    renderCards();
    renderTable();
  } catch (e) {
    document.getElementById('error-box').innerHTML =
      '<div class="error"><b>Could not load the CSV.</b><br>Detail: ' + e.message + '</div>';
  }
}

function populateMonthFilter() {
  const sel = document.getElementById('month-filter');
  while (sel.children.length > 1) sel.removeChild(sel.lastChild);
  const months = [...new Set(state.rows.map(r => monthKey(r.Date)).filter(Boolean))].sort().reverse();
  for (const m of months) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = monthLabel(m);
    sel.appendChild(opt);
  }
}

function renderCards() {
  document.getElementById('card-total').textContent = state.rows.length.toLocaleString();
  const sumBy = (type) => state.rows.filter(r => r.Type === type).reduce((s, r) => s + r._abs, 0);
  const deposits    = sumBy('Deposit');
  const withdrawals = sumBy('Withdrawal');
  const removals    = sumBy('Removal');
  const taxRefund   = sumBy('Tax Refund');
  const dividends   = sumBy('Dividend');
  const interest    = sumBy('Interest');
  const netCash = deposits - withdrawals - removals + taxRefund;
  const cf = document.getElementById('card-cashflow');
  cf.textContent = fmtSignedEUR(netCash);
  cf.className = 'value ' + (netCash >= 0 ? 'pl-pos' : 'pl-neg');
  document.getElementById('card-income').textContent   = fmtEUR(dividends + interest);
  document.getElementById('card-spending').textContent = fmtEUR(removals);
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = key;
    state.sortDir = key === 'Date' ? 'desc' : 'asc';
  }
  renderTable();
}

function renderTable() {
  const search = document.getElementById('search').value.toLowerCase();
  const type   = document.getElementById('type-filter').value;
  const month  = document.getElementById('month-filter').value;
  const limit  = parseInt(document.getElementById('page-size').value, 10) || 500;

  let rows = state.rows.filter(r => {
    if (type && r.Type !== type) return false;
    if (month && monthKey(r.Date) !== month) return false;
    if (search) {
      const blob = ((r.Note || '') + ' ' + (r.ISIN || '') + ' ' + (r.Type || '')).toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    const va = a[state.sortKey] != null ? a[state.sortKey] : '';
    const vb = b[state.sortKey] != null ? b[state.sortKey] : '';
    return state.sortDir === 'asc'
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });

  const truncated = rows.length > limit ? rows.slice(0, limit) : rows;
  document.getElementById('events-count').textContent =
    rows.length > limit
      ? truncated.length.toLocaleString() + ' of ' + rows.length.toLocaleString() + ' (truncated)'
      : rows.length.toLocaleString() + ' / ' + state.rows.length.toLocaleString();

  document.getElementById('events-tbody').innerHTML = truncated.map(r => {
    const cls = catClass(r.Type);
    const amtCls = r._value >= 0 ? 'pl-pos' : 'pl-neg';
    const safeNote = (r.Note || '').replace(/</g, '&lt;');
    return '<tr>' +
      '<td>' + fmtDate(r.Date) + '</td>' +
      '<td><span class="cat-pill ' + cls + '">' + r.Type + '</span></td>' +
      '<td>' + safeNote + '</td>' +
      '<td class="isin">' + (r.ISIN || '') + '</td>' +
      '<td class="num ' + amtCls + '">' + fmtSignedEUR(r._value) + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No events match the filters.</td></tr>';
}

function init() {
  const root = document.getElementById('tr-app');
  if (!root) return;
  document.body.classList.add('tr-app-active');
  dataUrl = root.dataset.routeData.replace('__TYPE__', 'transactions_csv');

  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('type-filter').addEventListener('change', renderTable);
  document.getElementById('month-filter').addEventListener('change', renderTable);
  document.getElementById('page-size').addEventListener('change', renderTable);

  const table = document.getElementById('ledger-table');
  if (table) {
    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => setSort(th.dataset.sort));
    });
  }

  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();
