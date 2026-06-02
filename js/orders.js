/* global OC */
/**
 * Orders page logic — verbatim port of Trade-Republic-Dashboard
 * commit 7fcbe0b (with 66cc26d's _shared.js + a25f890's brand palette).
 *
 * ownCloud patches:
 *   - CSV URL: `../DATA/account_transactions.csv` → routes.data with
 *     '__TYPE__' = 'transactions_csv' (ApiController serves the file).
 *   - Inline on{input,change,click} attrs removed from the template;
 *     handlers wired here via addEventListener (CSP).
 *   - fmtEUR / fmtDate / monthKey / monthLabel / parseCsv come from
 *     js/_shared.js (loaded by PageController before this script).
 */
(function () {
'use strict';

const state = {
  rows: [],
  sortKey: 'Date',
  sortDir: 'desc',
};

let dataUrl;

async function load() {
  try {
    const res = await fetch(dataUrl + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) {
      document.getElementById('error-box').innerHTML =
        '<div class="warning"><b>No transactions data yet.</b> Click <b>🔄 Update Now</b> above to fetch from Trade Republic.</div>';
      return;
    }
    const text = await res.text();
    const all = parseCsv(text);
    state.rows = all.filter(r => r.Type === 'Buy' || r.Type === 'Sell');
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
  const buys  = state.rows.filter(r => r.Type === 'Buy');
  const sells = state.rows.filter(r => r.Type === 'Sell');
  const buyTotal  = buys.reduce((s, r) => s + r._abs, 0);
  const sellTotal = sells.reduce((s, r) => s + r._abs, 0);
  const net = sellTotal - buyTotal;
  document.getElementById('card-total-trades').textContent = state.rows.length.toLocaleString();
  document.getElementById('card-total-trades-sub').textContent =
    buys.length.toLocaleString() + ' buys · ' + sells.length.toLocaleString() + ' sells';
  document.getElementById('card-total-buy').textContent  = fmtEUR(buyTotal);
  document.getElementById('card-total-sell').textContent = fmtEUR(sellTotal);
  const netEl = document.getElementById('card-net');
  netEl.textContent = (net >= 0 ? '+' : '') + fmtEUR(Math.abs(net));
  netEl.className = 'value ' + (net >= 0 ? 'pl-pos' : 'pl-neg');
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = key;
    state.sortDir = (key === 'Date') ? 'desc' : 'asc';
  }
  renderTable();
}

function renderTable() {
  const search = document.getElementById('search').value.toLowerCase();
  const side   = document.getElementById('side-filter').value;
  const month  = document.getElementById('month-filter').value;

  let rows = state.rows.filter(r => {
    if (side && r.Type !== side) return false;
    if (month && monthKey(r.Date) !== month) return false;
    if (search) {
      const blob = ((r.Note || '') + ' ' + (r.ISIN || '')).toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    const va = a[state.sortKey] != null ? a[state.sortKey] : '';
    const vb = b[state.sortKey] != null ? b[state.sortKey] : '';
    if (typeof va === 'number' || typeof vb === 'number') {
      return state.sortDir === 'asc' ? (va - vb) : (vb - va);
    }
    return state.sortDir === 'asc'
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });

  document.getElementById('trades-count').textContent =
    rows.length.toLocaleString() + ' / ' + state.rows.length.toLocaleString();

  document.getElementById('trades-tbody').innerHTML = rows.map(r => {
    const pill = r.Type === 'Buy' ? 'side-buy' : 'side-sell';
    const safeNote = (r.Note || '').replace(/</g, '&lt;');
    return '<tr>' +
      '<td>' + fmtDate(r.Date) + '</td>' +
      '<td>' + safeNote + '</td>' +
      '<td class="isin">' + (r.ISIN || '') + '</td>' +
      '<td><span class="side-pill ' + pill + '">' + r.Type + '</span></td>' +
      '<td class="num">' + fmtEUR(r._abs) + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No trades match the filters.</td></tr>';
}

function init() {
  const root = document.getElementById('tr-app');
  if (!root) return;
  document.body.classList.add('tr-app-active');
  dataUrl = root.dataset.routeData.replace('__TYPE__', 'transactions_csv');

  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('side-filter').addEventListener('change', renderTable);
  document.getElementById('month-filter').addEventListener('change', renderTable);

  const table = document.getElementById('orders-table');
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
