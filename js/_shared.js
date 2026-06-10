// Shared helpers for ALL TR dashboard pages (v0.1.40 — Refactor C
// round 2). Was originally a port of just orders + ledger helpers
// from Trade-Republic-Dashboard (commit 66cc26d); the older pages
// (dashboard, analytics, dividends, settings, glossary) carried
// their own inline `fmtE` / `fmtP` 1-liner helpers declared inside
// loadCockpit() function bodies. v0.1.40 unified them by loading
// `_shared.js` on every page and removing the inline copies.
//
// Loaded by PageController for every template via
// Util::addScript('_shared'). No IIFE — these are module-level
// globals the page scripts read. The order is: _shared → update_flow
// → page script, so the page script can see `fmtEUR`/`fmtPct` at
// parse time.
//
// Names match upstream Trade-Republic-Dashboard's _shared.js where
// they exist; new helpers added here mirror the canonical 2-decimal
// "fmtP" / 0-decimal money convention used across the older pages.

// ----------------------------------------------------------------------
// Number / currency formatters
// ----------------------------------------------------------------------
function fmtEUR(n) {
  return '€' + (Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// Same as fmtEUR but with 0 fraction digits — used in the analytics
// page's cash-flow tiles where the headline number reads better
// without €.50 precision.
function fmtEUR0(n) {
  return '€' + (Number(n) || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

// Sign-aware EUR: "+€1.23" / "−€1.23" / "+€0.00" — explicit sign on
// BOTH positives and negatives. For deltas / net cash flows where the
// sign is the headline information.
//
// Uses unicode minus (U+2212). Fixed v0.1.42 (was returning negatives
// WITHOUT any sign, relying on `.red` CSS class to communicate
// negativity — colour-blind-hostile + misleading on copy-paste).
function fmtSignedEUR(n) {
  const v = Number(n) || 0;
  if (v < 0) return '−' + fmtEUR(Math.abs(v));
  return '+' + fmtEUR(v);
}

// EUR with minus on negatives but NO sign on positives: "€1.23" /
// "−€1.23" / "€0.00". For values that are conventionally positive
// (dividend totals, balances) where a "+" prefix would be visual
// noise but a missing "−" on a refund would be wrong. Mirrors
// dividends.js's historic local `fmtEur` helper.
function fmtEURWithMinus(n) {
  const v = Number(n) || 0;
  if (v < 0) return '−' + fmtEUR(Math.abs(v));
  return fmtEUR(v);
}

// Percent with sign, configurable decimals (default 2). Pass d=1 for
// the portfolio table's "+5.4%" style. Treats null/undefined as 0.
function fmtPct(n, d) {
  if (d === undefined) d = 2;
  const v = Number(n) || 0;
  return (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
}

// ----------------------------------------------------------------------
// Date / month helpers
// ----------------------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const monthKey = (iso) => (iso || '').slice(0, 7);

function monthLabel(k) {
  if (!k) return '';
  const [y, m] = k.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

// ----------------------------------------------------------------------
// CSV parser tolerant to the TR account_transactions.csv shape:
// Date;Type;Value;Note;ISIN;Shares;Fees;Taxes;ISIN2;Shares2
// Returns array of row objects.
// ----------------------------------------------------------------------
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split(';');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(';');
    if (fields.length < header.length) continue;
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = fields[j];
    out.push(row);
  }
  return out;
}
