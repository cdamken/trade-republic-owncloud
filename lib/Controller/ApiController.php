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
}
