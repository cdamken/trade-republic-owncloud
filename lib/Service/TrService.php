<?php
/**
 * Per-user bridge to the tr-api Python library.
 *
 * Every public method here operates on a single ownCloud user. The userId is
 * resolved lazily from IUserSession, which makes leaking another user's data
 * structurally impossible: every path goes through userId() at request time,
 * and there is no setter for it.
 *
 * Storage layout (datadirectory is the ownCloud root data dir):
 *
 *   {datadirectory}/{uid}/trade_republic/
 *     ├── profile/             ← tr-api profile dir (cookies, config). 0700.
 *     │   ├── cookies.json     ← session cookies; written by tr-api login flow
 *     │   └── profile.json
 *     ├── .pending_login.json  ← in-flight processId between push & code submit
 *     ├── portfolio.json       ← shaped portfolio for the dashboard
 *     ├── portfolio_raw.json   ← raw TR WS payload (debug)
 *     ├── account_transactions.csv  ← timelineTransactions in pytr CSV layout
 *     ├── analytics.json       ← cash flow / dividends / monthly aggregates
 *     ├── net_worth_history.json    ← daily snapshot rows
 *     ├── last_update.date     ← "YYYY-MM-DD"
 *     └── fetch.log            ← stdout/stderr of the last wrapper run
 *
 * Credentials live in IConfig (user prefs); PIN is encrypted with ICrypto.
 *
 * Site admins control the Python interpreter via system config:
 *
 *     occ config:system:set trade_republic.python_bin --value=/path/to/venv/bin/python
 *
 * The venv must have tr-api installed (`pip install tr-api[browser]`).
 */

namespace OCA\TradeRepublic\Service;

use OCP\IConfig;
use OCP\IUserSession;
use OCP\Security\ICrypto;

class TrService {

	const APPID = 'trade_republic';

	const EXIT_OK            = 0;
	const EXIT_MFA_REQUIRED  = 10;
	const EXIT_MFA_INVALID   = 11;
	const EXIT_AUTH_FAILED   = 12;
	const EXIT_API_ERROR     = 20;
	const EXIT_RATE_LIMITED  = 21;
	const EXIT_CONFIG_ERROR  = 30;

	private $userSession;
	private $config;
	private $crypto;
	private $dataDirRoot;
	private $userIdCache = null;

	public function __construct(IUserSession $userSession, IConfig $config, ICrypto $crypto) {
		$this->userSession = $userSession;
		$this->config = $config;
		$this->crypto = $crypto;
		$this->dataDirRoot = rtrim(
			(string) $config->getSystemValue('datadirectory', \OC::$SERVERROOT . '/data'),
			'/'
		);
	}

	private function userId(): string {
		if ($this->userIdCache === null) {
			$user = $this->userSession->getUser();
			if ($user === null) {
				throw new \RuntimeException('TR app: no user in session');
			}
			$this->userIdCache = $user->getUID();
		}
		return $this->userIdCache;
	}

	// ------------------------------------------------------------------
	// Paths (per-user, isolated)
	// ------------------------------------------------------------------
	public function userTrDir(): string {
		$path = $this->dataDirRoot . '/' . $this->userId() . '/trade_republic';
		if (!is_dir($path)) {
			@mkdir($path, 0700, true);
		}
		return $path;
	}

	public function profileDir(): string {
		$path = $this->userTrDir() . '/profile';
		if (!is_dir($path)) {
			@mkdir($path, 0700, true);
		}
		return $path;
	}

	public function dataPath(string $name): string {
		// Whitelist to avoid path traversal via the api#data route.
		$allowed = [
			'portfolio.json',
			'analytics.json',
			'net_worth_history.json',
			'last_update.date',
		];
		if (!in_array($name, $allowed, true)) {
			throw new \InvalidArgumentException("unknown data file: $name");
		}
		return $this->userTrDir() . '/' . $name;
	}

	// ------------------------------------------------------------------
	// Credentials (per-user, PIN encrypted)
	// ------------------------------------------------------------------
	public function getPhone(): string {
		return (string) $this->config->getUserValue($this->userId(), self::APPID, 'phone', '');
	}

	public function isConfigured(): bool {
		$phone = $this->getPhone();
		$pin = (string) $this->config->getUserValue($this->userId(), self::APPID, 'pin_enc', '');
		return $phone !== '' && $phone[0] === '+' && $pin !== '';
	}

	public function setCredentials(string $phone, string $pin): void {
		$this->config->setUserValue($this->userId(), self::APPID, 'phone', $phone);
		$this->config->setUserValue(
			$this->userId(), self::APPID, 'pin_enc',
			$this->crypto->encrypt($pin)
		);
	}

	private function getDecryptedPin(): string {
		$enc = (string) $this->config->getUserValue($this->userId(), self::APPID, 'pin_enc', '');
		if ($enc === '') {
			return '';
		}
		try {
			return $this->crypto->decrypt($enc);
		} catch (\Exception $e) {
			return '';
		}
	}

	// ------------------------------------------------------------------
	// Reset (wipe everything for this user)
	// ------------------------------------------------------------------
	public function reset(): void {
		$this->config->deleteUserValue($this->userId(), self::APPID, 'phone');
		$this->config->deleteUserValue($this->userId(), self::APPID, 'pin_enc');
		$dir = $this->userTrDir();
		// rm -rf $dir
		$this->rrmdir($dir);
	}

	private function rrmdir(string $dir): void {
		if (!is_dir($dir)) {
			return;
		}
		$items = scandir($dir);
		if ($items === false) {
			return;
		}
		foreach ($items as $item) {
			if ($item === '.' || $item === '..') {
				continue;
			}
			$path = $dir . '/' . $item;
			if (is_dir($path) && !is_link($path)) {
				$this->rrmdir($path);
			} else {
				@unlink($path);
			}
		}
		@rmdir($dir);
	}

	// ------------------------------------------------------------------
	// Update: invoke the Python wrapper
	// ------------------------------------------------------------------
	/**
	 * Runs the bridge script and returns ['exitCode' => int, 'stdout' => str, 'stderr' => str].
	 *
	 * Two-step login: the first call (with $mfaCode === null) initiates the
	 * push and exits 10 (mfa_required) so the browser opens its 4-digit modal.
	 * The second call passes the code via $mfaCode and completes the login.
	 *
	 * $full forces a full transactions re-download (the wrapper does
	 * incremental by default).
	 */
	public function runFetch(?string $mfaCode, bool $full = false): array {
		if (!$this->isConfigured()) {
			return ['exitCode' => self::EXIT_CONFIG_ERROR, 'stdout' => '', 'stderr' => 'credentials not configured'];
		}

		$python = $this->config->getSystemValue('trade_republic.python_bin', 'python3');
		$script = realpath(__DIR__ . '/../../python/fetch_wrapper.py');
		if ($script === false || !is_file($script)) {
			return ['exitCode' => self::EXIT_CONFIG_ERROR, 'stdout' => '', 'stderr' => 'fetch_wrapper.py not found'];
		}

		$cmd = [
			$python,
			$script,
			'--profile-dir', $this->profileDir(),
			'--data-dir',    $this->userTrDir(),
		];
		if ($mfaCode !== null) {
			$cmd[] = '--mfa-code';
			$cmd[] = $mfaCode;
		}
		if ($full) {
			$cmd[] = '--full';
		}

		$env = [
			'TR_PHONE'    => $this->getPhone(),
			'TR_PIN'      => $this->getDecryptedPin(),
			'PATH'        => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
			'HOME'        => sys_get_temp_dir(),
			'LANG'        => 'C.UTF-8',
		];
		// Shared Playwright/Chromium cache. The wrapper re-points HOME to a
		// per-user profile dir, which would otherwise force Playwright to
		// re-download Chromium on every first run. Default matches INSTALL.md;
		// override with `occ config:system:set trade_republic.playwright_browsers_path`.
		$browsersPath = (string) $this->config->getSystemValue(
			'trade_republic.playwright_browsers_path',
			'/var/cache/tr-playwright'
		);
		if ($browsersPath !== '') {
			$env['PLAYWRIGHT_BROWSERS_PATH'] = $browsersPath;
		}

		return $this->runProcess($cmd, $env, 240);
	}

	// ------------------------------------------------------------------
	// Documents: bulk PDF download via `tr-api docs download`
	// ------------------------------------------------------------------
	/**
	 * Shell out to `python -m tr_api.cli docs download` with the per-user
	 * profile + destination. Files land in <user-dir>/documents/<YYYY>/<kind>/...
	 * and become visible inside ownCloud's Files app automatically.
	 *
	 * Optional $since (YYYY-MM-DD) and $kinds (csv) tighten the run.
	 */
	public function runDocsDownload(?string $since = null, ?string $kinds = null): array {
		if (!$this->isConfigured()) {
			return ['exitCode' => self::EXIT_CONFIG_ERROR, 'stdout' => '', 'stderr' => 'credentials not configured'];
		}

		$python = $this->config->getSystemValue('trade_republic.python_bin', 'python3');
		$outDir = $this->userTrDir() . '/documents';
		if (!is_dir($outDir)) {
			@mkdir($outDir, 0700, true);
		}

		$cmd = [
			$python, '-m', 'tr_api.cli', '--json',
			'docs', 'download',
			'--out', $outDir,
			'--phone', $this->getPhone(),
		];
		if ($since) { $cmd[] = '--since'; $cmd[] = $since; }
		if ($kinds) { $cmd[] = '--kinds'; $cmd[] = $kinds; }

		// Same HOME-redirect trick as runFetch(): make tr-api's
		// ~/.tr-api/profiles/<phone>/ land inside the per-user profile dir.
		$env = [
			'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
			'HOME' => $this->profileDir(),
			'LANG' => 'C.UTF-8',
		];

		// 30 min ceiling — a full history with thousands of PDFs is plausible.
		return $this->runProcess($cmd, $env, 1800);
	}

	private function runProcess(array $cmd, array $env, int $timeoutSec): array {
		$descriptorSpec = [
			0 => ['pipe', 'r'],
			1 => ['pipe', 'w'],
			2 => ['pipe', 'w'],
		];
		$proc = proc_open($cmd, $descriptorSpec, $pipes, null, $env);
		if (!is_resource($proc)) {
			return ['exitCode' => self::EXIT_CONFIG_ERROR, 'stdout' => '', 'stderr' => 'proc_open failed'];
		}
		fclose($pipes[0]);

		stream_set_blocking($pipes[1], false);
		stream_set_blocking($pipes[2], false);

		$stdout = '';
		$stderr = '';
		$exitCode = -1;
		$deadline = microtime(true) + $timeoutSec;
		while (true) {
			$status = proc_get_status($proc);
			$stdout .= stream_get_contents($pipes[1]);
			$stderr .= stream_get_contents($pipes[2]);
			if (!$status['running']) {
				// PHP gotcha: proc_get_status() captures the exit status the
				// first time it sees the process exited. proc_close() called
				// afterwards returns -1 because the status was already reaped.
				$exitCode = (int) $status['exitcode'];
				break;
			}
			if (microtime(true) > $deadline) {
				proc_terminate($proc, 9);
				$stderr .= "\n[timeout after {$timeoutSec}s]";
				$exitCode = self::EXIT_CONFIG_ERROR;
				break;
			}
			usleep(100 * 1000);
		}
		$stdout .= stream_get_contents($pipes[1]);
		$stderr .= stream_get_contents($pipes[2]);
		fclose($pipes[1]);
		fclose($pipes[2]);
		proc_close($proc);

		@file_put_contents(
			$this->userTrDir() . '/fetch.log',
			'[' . date('c') . "] exit=$exitCode\n--- stdout ---\n$stdout\n--- stderr ---\n$stderr\n",
			LOCK_EX
		);

		return ['exitCode' => $exitCode, 'stdout' => $stdout, 'stderr' => $stderr];
	}
}
