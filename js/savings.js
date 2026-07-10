/* global OC, fmtEUR, fmtDate */
/**
 * Savings plans page. Reads savings_plans.json via the api#data route
 * (__TYPE__=savings). Shape:
 *   { generated_at, summary:{count,paused,by_interval,per_execution_eur,
 *     monthly_commitment_eur}, plans:[{isin,name,amount,interval,
 *     next_execution,previous_execution,paused,instrument_type,currency}] }
 *
 * Same ownCloud conventions as ledger.js: data via routes.data,
 * addEventListener (no inline on*), shared formatters from js/_shared.js.
 */
(function () {
'use strict';

const state = { plans: [], sortKey: 'next_execution', sortDir: 'asc' };
let dataUrl;

const INTERVAL_LABEL = {
  weekly: 'Weekly', biweekly: 'Biweekly', twoPerMonth: 'Twice a month',
  monthly: 'Monthly', quarterly: 'Quarterly',
};

async function load() {
  try {
    const res = await fetch(dataUrl + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.status === 404) {
      showEmpty('No savings plans yet — run “Update Now” to fetch them.');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.plans = Array.isArray(data.plans) ? data.plans : [];
    renderSummary(data.summary || {});
    renderTable();
  } catch (e) {
    showEmpty('Could not load savings plans: ' + e.message);
  }
}

function showEmpty(msg) {
  const box = document.getElementById('error-box');
  if (box) { box.textContent = msg; box.style.display = 'block'; }
}

function renderSummary(s) {
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('card-count', s.count != null ? s.count : state.plans.length);
  setText('card-paused', (s.paused || 0) + ' paused');
  setText('card-monthly', s.monthly_commitment_eur != null ? fmtEUR(s.monthly_commitment_eur) : '—');
  setText('card-perexec', s.per_execution_eur != null ? fmtEUR(s.per_execution_eur) : '—');
  const bi = s.by_interval || {};
  const parts = Object.keys(bi).sort((a, b) => bi[b] - bi[a])
    .map(k => (INTERVAL_LABEL[k] || k) + ': ' + bi[k]);
  setText('card-intervals', parts.length ? parts.join(' · ') : '—');
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = key;
    state.sortDir = key === 'amount' ? 'desc' : 'asc';
  }
  renderTable();
}

function renderTable() {
  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  const iv = document.getElementById('interval-filter').value || '';
  let rows = state.plans.filter(p => {
    if (iv && p.interval !== iv) return false;
    if (q) {
      const hay = ((p.name || '') + ' ' + (p.isin || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  const k = state.sortKey, dir = state.sortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let va = a[k], vb = b[k];
    if (k === 'amount') { va = +va || 0; vb = +vb || 0; return (va - vb) * dir; }
    va = (va == null ? '' : String(va)); vb = (vb == null ? '' : String(vb));
    return va.localeCompare(vb) * dir;
  });

  document.getElementById('plans-count').textContent = rows.length + ' of ' + state.plans.length;
  const tbody = document.getElementById('savings-tbody');
  tbody.innerHTML = rows.map(p => {
    const name = (p.name || '(unknown)').replace(/</g, '&lt;');
    const status = p.paused
      ? '<span class="cat-pill cat-other">Paused</span>'
      : '<span class="cat-pill cat-buy">Active</span>';
    return '<tr>' +
      '<td>' + (p.next_execution ? fmtDate(p.next_execution) : '—') + '</td>' +
      '<td>' + name + '</td>' +
      '<td class="isin">' + (p.isin || '') + '</td>' +
      '<td>' + (INTERVAL_LABEL[p.interval] || p.interval || '—') + '</td>' +
      '<td class="num">' + fmtEUR(+p.amount || 0) + '</td>' +
      '<td>' + status + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">No plans match the filters.</td></tr>';
}

function init() {
  const root = document.getElementById('tr-app');
  if (!root) return;
  document.body.classList.add('tr-app-active');
  dataUrl = root.dataset.routeData.replace('__TYPE__', 'savings');

  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('interval-filter').addEventListener('change', renderTable);
  const table = document.getElementById('savings-table');
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
