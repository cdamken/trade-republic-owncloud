<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Glossary page — static content explaining every term used in the dashboard.
 * Same shell (top-bar + sticky cockpit) as main.php / analytics.php /
 * settings.php so navigation between pages feels uniform.
 */
?>
<div id="tr-app" class="glossary-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-update="<?php p($routes['update']); ?>">

<!-- Unified top-bar — see templates/partials/_top_bar.php -->
<?php
$activeNav = 'glossary';
include __DIR__ . '/partials/_top_bar.php';
?>

<div class="cockpit">
  <div class="cockpit-row kpis">
    <div><div class="ck-label">Total Net Wealth</div><div class="ck-value big" id="ck-total">€0.00</div><div class="ck-sub" id="ck-total-sub">—</div></div>
    <div><div class="ck-label">Investment Cost</div><div class="ck-value" id="ck-cost">€0.00</div><div class="ck-sub">Sum of all buys</div></div>
    <div><div class="ck-label">Total P/L</div><div class="ck-value" id="ck-pl">€0.00</div><div class="ck-sub" id="ck-pl-pct">0.00%</div></div>
    <div><div class="ck-label">Available Cash</div><div class="ck-value asset-cash" id="ck-cash">€0.00</div><div class="ck-sub">To be reinvested</div></div>
  </div>
  <div class="cockpit-row buckets" id="ck-buckets"></div>
</div>

<div class="card">
  <h2 style="font-size:14px; color:var(--muted); text-transform:uppercase; letter-spacing:1.5px; font-weight:600; margin-bottom:8px;">📖 Glossary</h2>
  <p style="color:var(--muted); font-size:13px; margin-bottom:18px;">Every term used in this dashboard, in plain language.</p>

  <dl class="glossary">
    <dt>Total Net Wealth</dt>
    <dd>Everything you own inside Trade Republic right now, at current market prices.
        Sum of all positions (stocks, ETFs, bonds, crypto, private equity) plus your cash balance.</dd>

    <dt>Wealth by Bucket — Brokerage, Bonds, Private Equity, Crypto, Cash</dt>
    <dd>Different "buckets" TR uses internally. The official mobile app shows each as a separate tile.
        <strong>Brokerage</strong> covers stocks and ETFs — usually the biggest one. Each pill in the
        sticky cockpit at the top shows the value, position count, and total P/L for one bucket.</dd>

    <dt>Deposits</dt>
    <dd>Money you sent <em>from</em> your own bank account <em>to</em> Trade Republic.
        Still your money, just inside the broker, ready to invest.</dd>

    <dt>Withdrawals</dt>
    <dd>The opposite: money sent <em>from</em> Trade Republic <em>back to</em> your bank.
        Reduces "Net capital in TR".</dd>

    <dt>Card spending (a.k.a. Removals)</dt>
    <dd>Money that left your TR cash balance via the Trade Republic card (lifestyle consumption — coffee,
        groceries, restaurants). Different from Withdrawals: it wasn't moved to your bank, it was spent.</dd>

    <dt>Tax refunds</dt>
    <dd>When TR recovers tax that was over-withheld on a dividend, it credits the difference back to you.
        Counts as money "in".</dd>

    <dt>Net capital in TR</dt>
    <dd><code>Deposits + Tax refunds − Withdrawals</code>. The money you've committed to Trade Republic
        for investing. Card spending is NOT subtracted because that's lifestyle, not capital outflow.</dd>

    <dt>Current value</dt>
    <dd>Today's portfolio + cash at live market prices. Same number you see in "Total Net Wealth" at the top.</dd>

    <dt>Lifetime P/L</dt>
    <dd><code>Current value + Card spending − Net capital in TR − Investment income</code>.
        Pure price appreciation on the capital you've committed. Excludes lifestyle spending and
        dividend / interest receipts.</dd>

    <dt>Investment income</dt>
    <dd>Dividends from stocks / ETFs, plus interest TR paid you on your cash balance.
        Not counted in P/L because it's income, not appreciation.</dd>

    <dt>Top Paying Issuers</dt>
    <dd>Ranked list of which companies / ETFs paid you the most in dividends over your account's history.</dd>

    <dt>Payment Ledger</dt>
    <dd>Searchable list of every individual dividend and interest payment, with date, issuer, ISIN,
        type, and amount.</dd>

    <dt>ISIN</dt>
    <dd>International Securities Identification Number. Globally unique ID for a stock, ETF, bond, etc.
        Two country letters + 10 digits/letters.</dd>

    <dt>Net traded</dt>
    <dd><code>Total stock purchases − Total stock sales</code>. The money parked in positions.</dd>

    <dt>Asset Allocation</dt>
    <dd>How your wealth is split across asset classes.</dd>

    <dt>Concentration warnings</dt>
    <dd>Heuristic alerts on the Portfolio page about over-concentration in one stock or asset class.</dd>

    <dt>Session keepalive</dt>
    <dd>Background process that refreshes your TR session every ~290 seconds so the cookies don't expire.</dd>

    <dt>MFA / Security code</dt>
    <dd>4-digit code TR pushes to your mobile app when a fresh login is needed.</dd>
  </dl>

  <!-- Analytics methodology — ported from gbm-owncloud's glossary
       (v0.1.42, 2026-06-10) to bring TR ↔ GBM parity. Verbatim from
       upstream Trade-Republic-Dashboard. -->
  <h2 style="font-size:14px; color:var(--muted); text-transform:uppercase; letter-spacing:1.5px; font-weight:600; margin: 24px 0 8px;">📐 Analytics methodology</h2>
  <p style="color:var(--muted); font-size:13px; margin-bottom:14px;">How specific numbers in this dashboard are calculated.</p>

  <dl class="glossary">
    <dt>XIRR (Internal Rate of Return)</dt>
    <dd>Annualized money-weighted return. Considers the exact timing of each external
        cash flow (deposit, withdrawal) into TR and the current portfolio value. It's the
        "true" rate of return your committed capital has earned, in % per year.
        <br><br>
        <strong>Currently NOT computed for TR</strong> — the Lifetime P/L tile shows
        total absolute return instead. If you want to compare against benchmarks like
        MSCI World, XIRR is the right metric. Tracked as future work.</dd>

    <dt>Cost basis trajectory</dt>
    <dd>The "Capital invested over time" line you'd see on a Net Worth chart. Accumulates
        purchases − sales day by day. Does NOT reflect historical market values (we don't
        have past prices), only when you committed capital. Today's actual market value
        sits in the cockpit KPI cards above any chart.</dd>

    <dt>Forward 12-month dividend (projection)</dt>
    <dd>Naive estimate of how much you'll receive in dividends over the next 12 months,
        scaling what you received in the observed window up to 365 days. Requires ≥90
        days of dividend history to avoid noise from one-off payments. Shown on the
        Analytics page under "Income forecast".</dd>

    <dt>Yield on cost</dt>
    <dd><code>Forward 12-mo dividend ÷ Total cost basis</code>. The dividend yield you're
        earning on the money you actually paid for your positions — different from
        market-yield (which divides by current price). Tells you "how much income am
        I getting per euro I invested?".</dd>

    <dt>Benchmark replay</dt>
    <dd>When a benchmark line appears on a chart (e.g. MSCI World on the Net Worth
        chart), it's reconstructed by simulating "what if you'd bought the index on the
        same dates you bought TR positions, with the same amounts". Lets you compare
        your stock picks against a passive index using your actual cash-flow timeline,
        not a flat lump-sum baseline.</dd>
  </dl>
</div>

</div>
