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
      docsFolder:   root.dataset.routeDocsFolder,
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
      try {
        const r = await fetch(routes.config, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
          body: JSON.stringify({ phone, pin }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          setStatus('account-status', '✓ Saved — go to Portfolio and click Update Now to authenticate', 'ok');
          document.getElementById('setting-pin').value = '';
        } else {
          // Show whatever the backend told us (e.g. "phone must be in E.164…",
          // "pin must be 4–6 digits", or HTTP status if no detail field).
          const detail = body.detail || body.message || ('HTTP ' + r.status);
          setStatus('account-status', 'Save failed: ' + detail, 'err');
        }
      } catch (e) {
        setStatus('account-status', 'Save failed: ' + (e && e.message ? e.message : 'network error'), 'err');
      }
    });

    // Documents → save folder (per-user, picked from native file dialog)
    const docsInput   = document.getElementById('setting-docs-folder');
    const docsBrowse  = document.getElementById('docs-folder-browse-btn');
    const docsSaveBtn = document.getElementById('docs-folder-save-btn');

    // Load current value
    try {
      const r = await fetch(routes.docsFolder);
      if (r.ok) {
        const j = await r.json();
        if (j.folder) docsInput.value = j.folder;
      }
    } catch (_) {}

    docsBrowse.addEventListener('click', (e) => {
      e.preventDefault();
      // ownCloud's built-in dialog: title, callback, multiselect=false,
      // mimetype filter (folders only), modal=true, type=CHOOSE.
      // The picker exposes a "+ New folder" button for creating one inline.
      if (!window.OC || !OC.dialogs || !OC.dialogs.filepicker) {
        setStatus('docs-folder-status', 'File picker not available', 'err');
        return;
      }
      OC.dialogs.filepicker(
        'Choose folder for Trade Republic documents',
        (path) => {
          if (!path) return;
          // OC returns e.g. "/Finanzas/TR" — strip leading slash so it's
          // stored as a Files-root-relative path, matching what the backend
          // normaliser expects.
          docsInput.value = String(path).replace(/^\/+/, '');
        },
        false,
        'httpd/unix-directory',
        true,
        OC.dialogs.FILEPICKER_TYPE_CHOOSE
      );
    });

    docsSaveBtn.addEventListener('click', async () => {
      const folder = docsInput.value.trim().replace(/^\/+|\/+$/g, '');
      if (!folder) {
        return setStatus('docs-folder-status', 'Pick a folder first', 'err');
      }
      setStatus('docs-folder-status', 'Saving…');
      try {
        const r = await fetch(routes.docsFolder, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'requesttoken': OC.requestToken },
          body: JSON.stringify({ folder }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          if (body.folder) docsInput.value = body.folder;
          setStatus('docs-folder-status', '✓ Saved — next Documents download will use this folder', 'ok');
        } else {
          const detail = body.detail || body.message || ('HTTP ' + r.status);
          setStatus('docs-folder-status', 'Save failed: ' + detail, 'err');
        }
      } catch (e) {
        setStatus('docs-folder-status', 'Save failed: ' + (e && e.message ? e.message : 'network error'), 'err');
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
    // fmtEUR / fmtPct come from js/_shared.js (loaded first by PageController).
    let d;
    try {
      const r = await fetch(routes.data.replace('__TYPE__', 'portfolio') + '?t=' + Date.now());
      if (!r.ok) return;
      d = await r.json();
    } catch (_) { return; }
    const s = d.summary;
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
  }
})();
