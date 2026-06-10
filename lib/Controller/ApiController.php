<?php
/**
 * JSON endpoints used by the dashboard JS.
 *
 *   GET  /data/{type}    → per-user JSON file (portfolio/analytics/net_worth_history/last_update)
 *   GET  /api/config     → { configured, phone }
 *   POST /api/config     → { phone, pin }   (stored per-user, pin encrypted)
 *   POST /api/update     → { mfa_code?, full? }  (runs fetch_wrapper.py)
 *   POST /api/reset      → wipe credentials + data dir
 */

namespace OCA\TradeRepublic\Controller;

use OCA\TradeRepublic\Service\TrService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class ApiController extends Controller {

	private $tr;

	public function __construct(string $appName, IRequest $request, TrService $tr) {
		parent::__construct($appName, $request);
		$this->tr = $tr;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function data(string $type): Http\Response {
		$allowed = [
			'portfolio'         => ['file' => 'portfolio.json',          'ct' => 'application/json'],
			'analytics'         => ['file' => 'analytics.json',          'ct' => 'application/json'],
			'net_worth_history' => ['file' => 'net_worth_history.json',  'ct' => 'application/json'],
			'last_update'       => ['file' => 'last_update.date',        'ct' => 'text/plain'],
			// Raw CSV consumed by the Orders + Ledger pages (2026-06-02).
			// Same per-user isolation as the JSON files.
			'transactions_csv'  => ['file' => 'account_transactions.csv', 'ct' => 'text/csv; charset=utf-8'],
		];
		if (!isset($allowed[$type])) {
			return new JSONResponse(['error' => 'unknown type'], Http::STATUS_NOT_FOUND);
		}
		$path = $this->tr->dataPath($allowed[$type]['file']);
		if (!is_file($path)) {
			return new JSONResponse(['error' => 'not yet generated'], Http::STATUS_NOT_FOUND);
		}
		$body = file_get_contents($path);
		$response = new DataDisplayResponse($body, Http::STATUS_OK, ['Content-Type' => $allowed[$type]['ct']]);
		$response->addHeader('Cache-Control', 'no-store, must-revalidate');
		$response->addHeader('Pragma', 'no-cache');
		return $response;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function getConfig(): JSONResponse {
		$configured = $this->tr->isConfigured();
		// Both keys carry the same boolean. Upstream's /setup_status JS reads
		// `setup_complete`; we keep `configured` as well so older clients work.
		return new JSONResponse([
			'configured'     => $configured,
			'setup_complete' => $configured,
			'phone'          => $configured ? $this->tr->getPhone() : null,
		]);
	}

	/**
	 * @NoAdminRequired
	 */
	public function setConfig(string $phone = '', string $pin = ''): JSONResponse {
		$phone = trim($phone);
		// Trade Republic uses E.164 format (+ followed by 8–15 digits).
		if (!preg_match('/^\+[1-9]\d{7,14}$/', $phone)) {
			return new JSONResponse(
				['status' => 'bad_request', 'detail' => 'phone must be in E.164 format, e.g. +491701234567'],
				Http::STATUS_BAD_REQUEST
			);
		}
		// TR PINs are 4 digits today; tolerate 4–6 in case TR changes that.
		if (!ctype_digit($pin) || strlen($pin) < 4 || strlen($pin) > 6) {
			return new JSONResponse(
				['status' => 'bad_request', 'detail' => 'pin must be 4–6 digits'],
				Http::STATUS_BAD_REQUEST
			);
		}
		$this->tr->setCredentials($phone, $pin);
		return new JSONResponse(['status' => 'ok']);
	}

	/**
	 * @NoAdminRequired
	 */
	public function update(?string $mfa_code = null, $full = null): JSONResponse {
		if ($mfa_code !== null) {
			$mfa_code = trim((string) $mfa_code);
			if (!ctype_digit($mfa_code) || strlen($mfa_code) !== 4) {
				return new JSONResponse(
					['status' => 'bad_request', 'detail' => 'mfa_code must be 4 digits'],
					Http::STATUS_BAD_REQUEST
				);
			}
		}

		$forceFull = $full === true || $full === 'true' || $full === 1 || $full === '1';
		$result = $this->tr->runFetch($mfa_code === '' ? null : $mfa_code, $forceFull);

		static $map = [
			TrService::EXIT_OK            => [Http::STATUS_OK,                      'ok'],
			TrService::EXIT_MFA_REQUIRED  => [Http::STATUS_UNAUTHORIZED,            'mfa_required'],
			TrService::EXIT_MFA_INVALID   => [Http::STATUS_UNAUTHORIZED,            'mfa_invalid'],
			TrService::EXIT_AUTH_FAILED   => [Http::STATUS_UNAUTHORIZED,            'auth_failed'],
			TrService::EXIT_API_ERROR     => [Http::STATUS_BAD_GATEWAY,             'api_error'],
			TrService::EXIT_RATE_LIMITED  => [Http::STATUS_TOO_MANY_REQUESTS,       'rate_limited'],
			TrService::EXIT_CONFIG_ERROR  => [Http::STATUS_INTERNAL_SERVER_ERROR,   'config_error'],
		];
		$exit = $result['exitCode'];
		[$httpStatus, $jsonStatus] = $map[$exit] ?? [Http::STATUS_INTERNAL_SERVER_ERROR, 'error'];

		$payload = ['status' => $jsonStatus];
		if ($httpStatus === Http::STATUS_OK) {
			$payload['output'] = substr($result['stdout'], -2000);
		} else {
			$stderr = trim((string) $result['stderr']);
			$lastLine = $stderr === '' ? '' : substr(strrchr("\n" . $stderr, "\n"), 1, 240);
			$payload['detail'] = $lastLine;
		}
		return new JSONResponse($payload, $httpStatus);
	}

	/**
	 * @NoAdminRequired
	 */
	public function reset(): JSONResponse {
		$this->tr->reset();
		return new JSONResponse(['status' => 'ok']);
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function getDocsFolder(): JSONResponse {
		return new JSONResponse(['folder' => $this->tr->getDocsFolder()]);
	}

	/**
	 * @NoAdminRequired
	 */
	public function setDocsFolder(string $folder = ''): JSONResponse {
		try {
			$this->tr->setDocsFolder($folder);
		} catch (\InvalidArgumentException $e) {
			return new JSONResponse(
				['status' => 'bad_request', 'detail' => $e->getMessage()],
				Http::STATUS_BAD_REQUEST
			);
		}
		return new JSONResponse([
			'status' => 'ok',
			'folder' => $this->tr->getDocsFolder(),
		]);
	}

	/**
	 * @NoAdminRequired
	 */
	public function downloadDocs(?string $since = null, ?string $kinds = null): JSONResponse {
		$result = $this->tr->runDocsDownload(
			$since ? trim($since) : null,
			$kinds ? trim($kinds) : null,
		);

		// The CLI emits a JSON envelope on stdout. Parse and surface a
		// uniform shape to the JS regardless of whether tr-api succeeded.
		$envelope = json_decode((string) $result['stdout'], true);
		if (!is_array($envelope)) {
			$envelope = ['ok' => false, 'message' => substr((string) $result['stderr'], -500)];
		}

		if (!empty($envelope['ok'])) {
			$data = $envelope['data'] ?? [];
			return new JSONResponse([
				'status'   => 'ok',
				'out_dir'  => $data['out_dir']  ?? null,
				'counts'   => $data['counts']   ?? new \stdClass(),
				'manifest' => $data['manifest'] ?? null,
			], Http::STATUS_OK);
		}

		// Map tr-api exit codes (see tr-api/docs/cli-contract.md) to HTTP.
		// NB: server runs PHP 7.4, so this is if/elseif (no `match` expression).
		$exitCode = (int) ($envelope['exit_code'] ?? $result['exitCode']);
		if (in_array($exitCode, [20, 30], true)) {
			$httpStatus = Http::STATUS_UNAUTHORIZED;
			$jsonStatus = 'auth_required';
		} elseif ($exitCode === 41) {
			$httpStatus = Http::STATUS_TOO_MANY_REQUESTS;
			$jsonStatus = 'rate_limited';
		} else {
			$httpStatus = Http::STATUS_INTERNAL_SERVER_ERROR;
			$jsonStatus = 'error';
		}
		return new JSONResponse([
			'status'    => $jsonStatus,
			'exit_code' => $exitCode,
			'detail'    => substr((string) ($envelope['message'] ?? ''), 0, 500),
		], $httpStatus);
	}

	// =====================================================================
	// Per-page CSV exports — verbatim port of
	// Trade-Republic-Dashboard/app/server.py::_export_*_csv() helpers.
	// Each kind is a focused subset of account_transactions.csv (or
	// portfolio.json) matching what's visible on the corresponding
	// dashboard page. Lighter than a single 30-column dump.
	// =====================================================================

	const _BUY_SELL_EVENT_TYPES = [
		'TRADING_TRADE_EXECUTED',
		'TRADING_SAVINGSPLAN_EXECUTED',
		'SPARE_CHANGE_AGGREGATE',
		'SAVEBACK_AGGREGATE',
		'CRYPTO_BUY_EXECUTED',
		'CRYPTO_SELL_EXECUTED',
	];
	const _DIVIDEND_EVENT_TYPES = [
		'SSP_CORPORATE_ACTION_CASH',
		'ssp_corporate_action_invoice_cash',
	];

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function exportCsv(string $kind): Http\Response {
		switch ($kind) {
			case 'orders':    return $this->_csvFromCsv('orders.csv',    'orders');
			case 'ledger':    return $this->_csvFromCsv('ledger.csv',    'ledger');
			case 'dividends': return $this->_csvFromCsv('dividends.csv', 'dividends');
			case 'holdings':  return $this->_csvFromPortfolio();
			default:
				return new JSONResponse(['error' => 'unknown export kind'], Http::STATUS_BAD_REQUEST);
		}
	}

	private function _csvRow(array $row): string {
		// Quote per RFC 4180 — wrap any cell containing `,`, `"`, or
		// newline; escape embedded quotes by doubling.
		$cells = [];
		foreach ($row as $cell) {
			$cell = (string) $cell;
			if (strpbrk($cell, ",\"\n\r") !== false) {
				$cell = '"' . str_replace('"', '""', $cell) . '"';
			}
			$cells[] = $cell;
		}
		return implode(',', $cells) . "\n";
	}

	private function _csvFromCsv(string $filename, string $mode): Http\Response {
		$path = $this->tr->dataPath('account_transactions.csv');
		if ($mode === 'orders') {
			$out = $this->_csvRow(['date', 'side', 'eventType', 'isin', 'security', 'quantity', 'amount_eur', 'status']);
		} elseif ($mode === 'ledger') {
			$out = $this->_csvRow(['date', 'eventType', 'category', 'description', 'related_isin', 'amount_eur', 'status']);
		} else {
			$out = $this->_csvRow(['date', 'security', 'isin', 'amount_eur', 'currency', 'status']);
		}

		if (is_file($path) && ($fh = @fopen($path, 'r')) !== false) {
			fgetcsv($fh, 0, ';');
			while (($r = fgetcsv($fh, 0, ';')) !== false) {
				$r = array_pad($r, 12, '');
				[$date, $typ, $val, $note, $isin, $shares, $_fees, $_taxes, $_i2, $_s2, $ev, $sub] = $r;
				if ($mode === 'orders') {
					$isTrade = in_array($ev, self::_BUY_SELL_EVENT_TYPES, true)
					        || in_array($typ, ['Buy', 'Sell'], true);
					if (!$isTrade) continue;
					if (in_array($typ, ['Buy', 'Sell'], true)) {
						$side = $typ;
					} else {
						$side = ((float) $val) < 0 ? 'Buy' : 'Sell';
					}
					$out .= $this->_csvRow([$date, $side, $ev, $isin, $note, $shares, $val, $sub ?: 'executed']);
				} elseif ($mode === 'ledger') {
					if (in_array($ev, self::_BUY_SELL_EVENT_TYPES, true) || in_array($typ, ['Buy', 'Sell'], true)) {
						$cat = 'trade';
					} elseif (in_array($ev, self::_DIVIDEND_EVENT_TYPES, true) || $typ === 'Dividend') {
						$cat = 'dividend';
					} elseif (in_array($ev, ['BANK_TRANSACTION_INCOMING', 'CARD_REFUND'], true) || $typ === 'Deposit') {
						$cat = 'deposit';
					} elseif (strpos($ev, 'BANK_TRANSACTION_OUTGOING') === 0 || $typ === 'Withdrawal') {
						$cat = 'withdrawal';
					} elseif ($ev === 'CARD_TRANSACTION' || $typ === 'Removal') {
						$cat = 'card_spending';
					} elseif ($ev === 'SSP_TAX_CORRECTION' || $typ === 'Tax Refund') {
						$cat = 'tax_refund';
					} elseif (strpos($ev, 'INTEREST_PAYOUT') === 0 || $typ === 'Interest') {
						$cat = 'interest';
					} else {
						$cat = 'other';
					}
					$out .= $this->_csvRow([$date, $ev, $cat, $note, $isin, $val, $sub ?: '']);
				} else {
					if (!in_array($ev, self::_DIVIDEND_EVENT_TYPES, true) && $typ !== 'Dividend') continue;
					$out .= $this->_csvRow([$date, $note, $isin, $val, 'EUR', $sub ?: 'credited']);
				}
			}
			fclose($fh);
		}
		return $this->_sendCsv($filename, $out);
	}

	private function _csvFromPortfolio(): Http\Response {
		$path = $this->tr->dataPath('portfolio.json');
		$out = $this->_csvRow(['name', 'isin', 'type', 'qty', 'fifo', 'current_price', 'value_eur', 'daily_pnl']);
		if (is_file($path)) {
			$raw = @file_get_contents($path);
			$data = $raw ? json_decode($raw, true) : null;
			foreach ((array) ($data['all_positions'] ?? []) as $p) {
				$out .= $this->_csvRow([
					$p['name']         ?? $p['security'] ?? '',
					$p['isin']         ?? '',
					$p['type']         ?? $p['category'] ?? '',
					$p['qty']          ?? $p['quantity'] ?? '',
					$p['avg_cost']     ?? $p['fifo_avg_cost'] ?? '',
					$p['current_price'] ?? '',
					$p['net_value_eur'] ?? '',
					$p['daily_pnl_eur'] ?? $p['pl_eur'] ?? '',
				]);
			}
		}
		return $this->_sendCsv('holdings.csv', $out);
	}

	private function _sendCsv(string $filename, string $body): Http\Response {
		$response = new DataDisplayResponse(
			$body,
			Http::STATUS_OK,
			['Content-Type' => 'text/csv; charset=utf-8']
		);
		$response->addHeader('Content-Disposition', 'attachment; filename="' . $filename . '"');
		return $response;
	}
}
