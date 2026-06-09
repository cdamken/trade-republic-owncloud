<?php
/**
 * Shared top-bar partial — rendered at the top of every page.
 *
 * Before this partial existed (≤ v0.1.36), every template inlined a
 * near-identical copy of this markup. The only real per-page
 * differences are:
 *   - which nav link is `class="active"`
 *   - the emoji shown inside `.logo-box`
 *   - whether the Documents button is the real `#docs-btn` (Portfolio,
 *     wired to the download flow in dashboard.js) or a plain link back
 *     to Portfolio's docs anchor (every other page)
 *
 * Required locals (set by the including template before `include`):
 *   $routes      array  — the routes map from PageController
 *   $activeNav   string — one of:
 *                  'portfolio' | 'analytics' | 'orders' | 'dividends'
 *                  | 'ledger' | 'glossary' | 'settings'
 *
 * Optional locals (defaults applied if unset):
 *   $logoEmoji   string — emoji rendered in `.logo-box`. Default '📊'.
 *   $docsButton  string — 'real' (Portfolio: <button id="docs-btn">
 *                  wired by dashboard.js) or 'link' (other pages: an
 *                  <a> to Portfolio#docs). Default 'link'.
 *
 * The staleness chip (`#last-update-age`) is injected into `.actions`
 * at runtime by dashboard.js / update_flow.js — never hard-code it
 * here.
 */
$activeNav  = isset($activeNav)  ? $activeNav  : '';
$logoEmoji  = isset($logoEmoji)  ? $logoEmoji  : '📊';
$docsButton = isset($docsButton) ? $docsButton : 'link';

$navItems = [
  ['key' => 'portfolio', 'route' => 'index',     'label' => 'Portfolio'],
  ['key' => 'analytics', 'route' => 'analytics', 'label' => 'Analytics'],
  ['key' => 'orders',    'route' => 'orders',    'label' => '📋 Orders'],
  ['key' => 'dividends', 'route' => 'dividends', 'label' => '💰 Dividends'],
  ['key' => 'ledger',    'route' => 'ledger',    'label' => '📒 Ledger'],
  ['key' => 'glossary',  'route' => 'glossary',  'label' => '📖 Glossary'],
  ['key' => 'settings',  'route' => 'settings',  'label' => '⚙ Settings'],
];
?>
<div class="top-bar">
  <div class="brand">
    <div class="logo-box"><?php p($logoEmoji); ?></div>
    <h1>Trade Republic</h1>
  </div>
  <nav>
    <?php foreach ($navItems as $item): ?>
      <a href="<?php p($routes[$item['route']]); ?>"<?php if ($item['key'] === $activeNav): ?> class="active"<?php endif; ?>><?php p($item['label']); ?></a>
    <?php endforeach; ?>
  </nav>
  <div class="actions">
    <?php if ($docsButton === 'real'): ?>
      <button id="docs-btn" class="ghost"
              title="Download every PDF TR has issued (trades, dividends, statements, tax). Files appear in your Files app under Trade_Republic_Docs/&lt;year&gt;/&lt;kind&gt;/.">
        📄 Documents
      </button>
    <?php else: ?>
      <a class="ghost" href="<?php p($routes['index']); ?>#docs"
         style="text-decoration:none; display:inline-block; padding:8px 16px;
                background:transparent; color:var(--muted); border:1px solid var(--border);
                border-radius:8px; font-size:13px; font-weight:600;">📄 Documents</a>
    <?php endif; ?>
    <button id="update-btn">🔄 Update Now</button>
  </div>
</div>
