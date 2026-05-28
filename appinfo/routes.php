<?php
/**
 * Routes for the Trade Republic Portfolio app.
 *
 *   page#index       GET  /                    → portfolio dashboard
 *   page#analytics   GET  /analytics           → cash flow / dividends / history
 *   api#data         GET  /data/{type}         → per-user JSON (portfolio, analytics, net_worth, last_update)
 *   api#getConfig    GET  /api/config          → { configured: bool, phone: string|null }
 *   api#setConfig    POST /api/config          → save { phone, pin } for current user
 *   api#update       POST /api/update          → trigger refresh, optional { mfa_code, full }
 *   api#reset        POST /api/reset           → wipe per-user credentials + data
 *   api#downloadDocs POST /api/download_docs   → bulk download PDFs to per-user documents/
 */

return [
	'routes' => [
		['name' => 'page#index',         'url' => '/',                  'verb' => 'GET'],
		['name' => 'page#analytics',     'url' => '/analytics',         'verb' => 'GET'],
		['name' => 'api#data',           'url' => '/data/{type}',       'verb' => 'GET'],
		['name' => 'api#getConfig',      'url' => '/api/config',        'verb' => 'GET'],
		['name' => 'api#setConfig',      'url' => '/api/config',        'verb' => 'POST'],
		['name' => 'api#update',         'url' => '/api/update',        'verb' => 'POST'],
		['name' => 'api#reset',          'url' => '/api/reset',         'verb' => 'POST'],
		['name' => 'api#downloadDocs',   'url' => '/api/download_docs', 'verb' => 'POST'],
	],
];
