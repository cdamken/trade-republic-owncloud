<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Settings page — moved out of the modal-only flow in main.php.
 * Has its own sidebar (Account / Documents / Display / Data / Danger / About)
 * and the same top-bar + cockpit shell as the other pages.
 */
?>
<div id="tr-app" class="settings-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-config="<?php p($routes['config']); ?>"
	data-route-update="<?php p($routes['update']); ?>"
	data-route-reset="<?php p($routes['reset']); ?>"
	data-route-download-docs="<?php p($routes['downloadDocs']); ?>"
	data-route-docs-folder="<?php p($routes['docsFolder']); ?>">

<div class="top-bar">
  <div class="brand">
    <div class="logo-box">📊</div>
    <h1>Trade Republic</h1>
  </div>
  <nav>
    <a href="<?php p($routes['index']); ?>">Portfolio</a>
    <a href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
    <a href="<?php p($routes['settings']); ?>" class="active">⚙ Settings</a>
    <a href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
  </nav>
  <div class="actions">
    <a class="ghost" href="<?php p($routes['index']); ?>#docs"
       style="text-decoration:none; display:inline-block; padding:8px 16px;
              background:transparent; color:var(--muted); border:1px solid var(--border);
              border-radius:8px; font-size:13px; font-weight:600;">📄 Documents</a>
    <button id="update-btn">🔄 Update Now</button>
  </div>
</div>

<div class="cockpit">
  <div class="cockpit-row kpis">
    <div><div class="ck-label">Total Net Wealth</div><div class="ck-value big" id="ck-total">€0.00</div><div class="ck-sub" id="ck-total-sub">—</div></div>
    <div><div class="ck-label">Investment Cost</div><div class="ck-value" id="ck-cost">€0.00</div><div class="ck-sub">Sum of all buys</div></div>
    <div><div class="ck-label">Total P/L</div><div class="ck-value" id="ck-pl">€0.00</div><div class="ck-sub" id="ck-pl-pct">0.00%</div></div>
    <div><div class="ck-label">Available Cash</div><div class="ck-value asset-cash" id="ck-cash">€0.00</div><div class="ck-sub">To be reinvested</div></div>
  </div>
  <div class="cockpit-row buckets" id="ck-buckets"></div>
</div>

<div class="settings-grid">
  <aside class="settings-side">
    <a href="#s-account" class="active">👤 Account</a>
    <a href="#s-documents">📄 Documents</a>
    <a href="#s-display">🎨 Display</a>
    <a href="#s-data">💾 Data</a>
    <a href="#s-danger">⚠️ Danger zone</a>
    <a href="#s-about" style="border-top:1px solid var(--border); margin-top:4px; padding-top:10px;">ℹ️ About</a>
  </aside>

  <div>
    <div class="settings-section" id="s-account">
      <h3>👤 Account</h3>
      <p class="help">Your Trade Republic phone and PIN. PIN is encrypted at rest using ownCloud's ICrypto.</p>
      <div class="form-row">
        <label>Phone (international)</label>
        <!-- The Hidden dummy inputs above each real field "absorb" browser
             autofill of stored ownCloud credentials (which match name="username"
             / name="password" on the login page). Combined with autocomplete=
             "off"/"new-password" and a non-standard name, browsers stop
             auto-filling our TR fields. -->
        <input type="text" name="username_dummy_<?php echo bin2hex(random_bytes(4)); ?>"
               style="display:none" tabindex="-1" autocomplete="username">
        <input type="tel" id="setting-phone" placeholder="+4912345678"
               name="tr_phone_<?php echo bin2hex(random_bytes(4)); ?>"
               autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore>
      </div>
      <div class="form-row">
        <label>PIN (4–6 digits)</label>
        <input type="password" name="password_dummy_<?php echo bin2hex(random_bytes(4)); ?>"
               style="display:none" tabindex="-1" autocomplete="new-password">
        <!-- type="text" + CSS mask so neither Chrome nor macOS Passwords
             treats this as a credential and offers to save it. -->
        <input type="text" id="setting-pin" inputmode="numeric" maxlength="6" placeholder="••••"
               class="pin-mask"
               name="tr_pin_<?php echo bin2hex(random_bytes(4)); ?>"
               autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore>
      </div>
      <div class="form-row">
        <label></label>
        <div>
          <button class="btn" id="save-account-btn">Save</button>
          <span class="status-msg" id="account-status"></span>
        </div>
      </div>
    </div>

    <div class="settings-section" id="s-documents">
      <h3>📄 Documents</h3>
      <p class="help">PDFs land in your Files app under
        <code>&lt;folder&gt;/&lt;year&gt;/&lt;kind&gt;/</code>. Pick any folder in your Files —
        the picker has a <strong>+ New folder</strong> button if you need to create one.</p>
      <div class="form-row">
        <label>Save folder</label>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <input type="text" id="setting-docs-folder" readonly
                 placeholder="Trade_Republic_Docs"
                 style="flex:1; min-width:220px;">
          <button class="btn ghost" id="docs-folder-browse-btn">📁 Browse…</button>
        </div>
      </div>
      <div class="form-row">
        <label></label>
        <div>
          <button class="btn" id="docs-folder-save-btn">Save</button>
          <span class="status-msg" id="docs-folder-status"></span>
        </div>
      </div>
      <div class="form-row">
        <label></label>
        <div>
          <a class="btn ghost" href="<?php p($routes['index']); ?>#docs">📥 Open Portfolio → click Documents</a>
        </div>
      </div>
    </div>

    <div class="settings-section" id="s-display">
      <h3>🎨 Display</h3>
      <p class="help">Appearance preferences.</p>
      <div class="form-row">
        <label>P/L color mode</label>
        <select id="setting-pl-color">
          <option value="sign">Sign only (no color) — current</option>
          <option value="color">Green / red</option>
        </select>
      </div>
      <div class="form-row">
        <label>Theme</label>
        <select disabled>
          <option>Dark (only option for now)</option>
        </select>
      </div>
    </div>

    <div class="settings-section" id="s-data">
      <h3>💾 Data &amp; sync</h3>
      <p class="help">Per-user data lives in your ownCloud data directory.</p>
      <div class="form-row">
        <label>Session keepalive</label>
        <div style="color:var(--muted); font-size:13px;">Background refresh via <code>tr-api auth refresh</code> every ~290 s when you click Update Now (silent re-auth).</div>
      </div>
    </div>

    <div class="settings-section" id="s-danger">
      <h3>⚠️ Danger zone</h3>
      <p class="help">Destructive actions. Confirmation required.</p>
      <div class="form-row">
        <label>Reset everything</label>
        <div>
          <button class="btn danger" id="reset-all-btn">🗑 Wipe data + credentials</button>
          <span class="status-msg" id="reset-status"></span>
        </div>
      </div>
    </div>

    <div class="settings-section" id="s-about">
      <h3>ℹ️ About</h3>
      <p class="help">Source repos and links.</p>
      <ul style="color:var(--muted); font-size:13px; line-height:1.8; list-style:none;">
        <li>📦 <code>tr-api</code> — <a href="https://github.com/cdamken/tr-api" target="_blank" rel="noopener" style="color:var(--blue);">cdamken/tr-api</a></li>
        <li>📦 Dashboard (local) — <a href="https://github.com/cdamken/trade-republic-dashboard" target="_blank" rel="noopener" style="color:var(--blue);">cdamken/trade-republic-dashboard</a></li>
        <li>📦 This (ownCloud port) — <a href="https://github.com/cdamken/trade-republic-owncloud" target="_blank" rel="noopener" style="color:var(--blue);">cdamken/trade-republic-owncloud</a></li>
      </ul>
    </div>
  </div>
</div>

</div>
