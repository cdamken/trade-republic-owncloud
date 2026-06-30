<?php
/**
 * Per-user bridge to the tr-api Python library.
 *
 * Every public method here operates on a single ownCloud user. The userId is
 * resolved lazily from IUserSession (see BaseOwnCloudService::userId()),
 * which makes leaking another user's data structurally impossible: every
 * path goes through userId() at request time, and there is no setter for it.
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
 *
 * Shared DI plumbing (constructor, userId, userDir, runProcess, EXIT_*)
 * lives in BaseOwnCloudService — see that file for the security boundary
 * + subprocess gotchas. This class only carries TR-specific logic.
 */

namespace OCA\TradeRepublicNext\Service;

class TrService extends BaseOwnCloudService {

	const APPID = 'trade_republic_next';

	protected function appDirName(): string {
		return 'trade_republic_next';
	}

	// ------------------------------------------------------------------
	// Paths (per-user, isolated)
	// ------------------------------------------------------------------
	/**
	 * Where PDF documents land. We write INTO the user's Files area so
	 * documents show up automatically in the ownCloud Files app — no
	 * separate download / browse step needed. The subfolder is per-user
	 * configurable via `getDocsFolder()`; default `Trade_Republic_Docs`.
	 */
	public function userDocsDir(): string {
		$path = $this->userFilesRoot() . '/' . $this->getDocsFolder();
		if (!is_dir($path)) {
			// 0755 to match the user's other Files folders — 0750 left the
			// folder unreadable to group/other and was inconsistent with the
			// rest of the user's tree (the web server owns it as www-data, so
			// it could still serve it, but we keep perms uniform).
			@mkdir($path, 0755, true);
		}
		return $path;
	}

	/**
	 * Absolute path to the user's Files root, e.g.
	 * `{datadir}/<uid>/files`. This is what ownCloud's WebDAV/file picker
	 * uses as the user's virtual root.
	 */
	private function userFilesRoot(): string {
		return $this->dataDirRoot . '/' . $this->userId() . '/files';
	}

	/**
	 * The user-chosen subfolder inside their Files root where TR PDFs
	 * are written. Stored in `oc_preferences` (key `docs_folder`).
	 * Returned as a path RELATIVE to the Files root, with no leading or
	 * trailing slash. Defaults to `Trade_Republic_Docs`.
	 */
	public function getDocsFolder(): string {
		$raw = (string) $this->config->getUserValue(
			$this->userId(), self::APPID, 'docs_folder', 'Trade_Republic_Docs'
		);
		$normalised = $this->normaliseDocsFolder($raw);
		// Fall back rather than throwing — bad stored value shouldn't brick
		// the dashboard. Caller (setter) is where validation should live.
		return $normalised === '' ? 'Trade_Republic_Docs' : $normalised;
	}

	/**
	 * Persist a new docs folder for the current user. Path is treated as
	 * relative to the user's Files root: leading/trailing slashes are
	 * stripped, segments are validated, and `..` is rejected. Empty input
	 * is rejected too — pass `Trade_Republic_Docs` to restore the default.
	 *
	 * @throws \InvalidArgumentException on empty or unsafe input
	 */
	public function setDocsFolder(string $path): void {
		$normalised = $this->normaliseDocsFolder($path);
		if ($normalised === '') {
			throw new \InvalidArgumentException('folder must not be empty');
		}
		$this->config->setUserValue(
			$this->userId(), self::APPID, 'docs_folder', $normalised
		);
	}

	private function normaliseDocsFolder(string $path): string {
		$path = trim($path);
		// Collapse Windows-style separators just in case the picker hands
		// us one, then strip surrounding slashes.
		$path = str_replace('\\', '/', $path);
		$path = trim($path, '/');
		if ($path === '') {
			return '';
		}
		$segments = [];
		foreach (explode('/', $path) as $seg) {
			$seg = trim($seg);
			if ($seg === '' || $seg === '.') {
				continue;
			}
			if ($seg === '..') {
				throw new \InvalidArgumentException('folder must not contain ".." segments');
			}
			// Block NUL and control bytes; the rest of the cleanup is up
			// to the filesystem.
			if (preg_match('/[\x00-\x1f]/', $seg)) {
				throw new \InvalidArgumentException('folder contains invalid characters');
			}
			$segments[] = $seg;
		}
		return implode('/', $segments);
	}

	public function profileDir(): string {
		$path = $this->userDir() . '/profile';
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
			// Raw CSV consumed by Orders + Ledger pages (2026-06-02 port).
			'account_transactions.csv',
		];
		if (!in_array($name, $allowed, true)) {
			throw new \InvalidArgumentException("unknown data file: $name");
		}
		return $this->userDir() . '/' . $name;
	}

	// ------------------------------------------------------------------
	// Credentials (per-user, PIN encrypted)
	// ------------------------------------------------------------------
	/**
	 * The logged-in user's id, exposed for controllers that need to pass it
	 * to the DB-backed services (IngestService / AnalysisService). Resolves
	 * from IUserSession via the base class — never from request input.
	 */
	public function currentUserId(): string {
		return $this->userId();
	}

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
		$this->config->deleteUserValue($this->userId(), self::APPID, 'docs_folder');
		$dir = $this->userDir();
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
			'--data-dir',    $this->userDir(),
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
	//
	// The download is a BACKGROUND JOB, not a synchronous request. A full
	// history is thousands of PDFs and can take 10-30 min — far longer than
	// any browser/proxy will hold an HTTP request open. The old synchronous
	// version made the fetch time out client-side ("Failed to fetch") while
	// the subprocess kept running server-side, which also let the UI re-enable
	// the Documents button and trigger a second overlapping download.
	//
	// New model:
	//   startDocsDownload() → fast pre-auth check, then launch a DETACHED
	//       process (survives this request) and write a status file. Returns
	//       immediately with state=started|already_running|auth_required.
	//   docsStatus()        → polled by the browser; reads the status file,
	//       reconciles it when the detached job has finished (parses the CLI
	//       envelope from the job log), and reports running|done|error.
	//
	// Control files live in userDir() (the app data dir, NOT the synced Files
	// area): .docs_status.json, docs_download.log, .docs_download.rc.

	private function docsStatusPath(): string { return $this->userDir() . '/.docs_status.json'; }
	private function docsLogPath(): string    { return $this->userDir() . '/docs_download.log'; }
	private function docsRcPath(): string     { return $this->userDir() . '/.docs_download.rc'; }

	/** Max wall-clock we let a docs job run before we treat a missing rc as stale. */
	const DOCS_JOB_MAX_SECONDS = 7200; // 2h

	/**
	 * Launch a bulk PDF download in the background and return its initial state.
	 *
	 * Returns one of:
	 *   ['state' => 'started']
	 *   ['state' => 'already_running']
	 *   ['state' => 'auth_required', 'message' => ...]
	 *   ['state' => 'error', 'message' => ...]
	 *
	 * Optional $since (YYYY-MM-DD) and $kinds (csv) tighten the run.
	 */
	public function startDocsDownload(?string $since = null, ?string $kinds = null): array {
		if (!$this->isConfigured()) {
			return ['state' => 'error', 'message' => 'credentials not configured'];
		}

		// Don't launch a second job on top of a live one (the whole point of
		// disabling the button). Reconcile first so a finished-but-unreaped job
		// doesn't look "running" forever.
		$status = $this->docsStatus();
		if (($status['state'] ?? '') === 'running') {
			return ['state' => 'already_running'];
		}

		$python = $this->config->getSystemValue('trade_republic.python_bin', 'python3');

		// Pre-auth check (synchronous, fast): ping, and if dead try the silent
		// pytr-style refresh. Bail with auth_required BEFORE launching so the UI
		// can open the security-code prompt instead of a job that dies instantly.
		$pingEnv = [
			'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
			'HOME' => $this->profileDir(),
			'LANG' => 'C.UTF-8',
		];
		$ping = $this->runProcess(
			[$python, '-m', 'tr_api.cli', '--json', 'ping', '--phone', $this->getPhone()],
			$pingEnv, 20
		);
		$pingEnvelope = json_decode((string) $ping['stdout'], true);
		$alive = is_array($pingEnvelope)
		      && !empty($pingEnvelope['ok'])
		      && !empty($pingEnvelope['data']['alive']);
		if (!$alive) {
			$refresh = $this->runProcess(
				[$python, '-m', 'tr_api.cli', '--json', 'auth', 'refresh', '--phone', $this->getPhone()],
				$pingEnv, 45
			);
			$refreshEnvelope = json_decode((string) $refresh['stdout'], true);
			$refreshed = is_array($refreshEnvelope)
			          && !empty($refreshEnvelope['ok'])
			          && !empty($refreshEnvelope['data']['ok']);
			if (!$refreshed) {
				return [
					'state'   => 'auth_required',
					'message' => 'Your Trade Republic session expired and the silent refresh failed. Click Update Now to do a full re-login (MFA push), then try Documents again.',
				];
			}
		}

		// Write directly into the user's Files area so the PDFs show up in the
		// Files app without extra steps.
		$outDir = $this->userDocsDir();

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

		if (!$this->launchDocsJob($cmd, $env)) {
			return ['state' => 'error', 'message' => 'Could not launch the download process.'];
		}

		$this->writeDocsStatus([
			'state'       => 'running',
			'started_at'  => date('c'),
			'finished_at' => null,
			'counts'      => null,
			'message'     => '',
			'since'       => $since,
			'kinds'       => $kinds,
		]);
		return ['state' => 'started'];
	}

	/**
	 * Fork the CLI as a fully detached process that outlives this request.
	 *
	 * The inner shell runs the command (stdout+stderr → job log), then writes
	 * its exit code to the rc file — that file's appearance is how docsStatus()
	 * knows the job finished. `nohup ... &` + redirecting the outer fd to
	 * /dev/null detaches it from the PHP-FPM worker so the request can return
	 * while the download keeps going. proc_open is used (not exec) to stay
	 * consistent with runProcess and not depend on exec() being enabled.
	 */
	private function launchDocsJob(array $cmd, array $env): bool {
		$logFile = $this->docsLogPath();
		$rcFile  = $this->docsRcPath();
		@unlink($rcFile);
		@unlink($logFile);

		$envPrefix = '';
		foreach ($env as $k => $v) {
			$envPrefix .= $k . '=' . escapeshellarg((string) $v) . ' ';
		}
		$cmdStr = implode(' ', array_map('escapeshellarg', $cmd));
		$inner  = $envPrefix . $cmdStr
		        . ' > ' . escapeshellarg($logFile) . ' 2>&1; '
		        . 'echo $? > ' . escapeshellarg($rcFile);
		$line = 'nohup sh -c ' . escapeshellarg($inner) . ' > /dev/null 2>&1 &';

		$this->logInfo('startDocsDownload: launching detached docs job');
		$descriptorSpec = [
			0 => ['pipe', 'r'],
			1 => ['file', '/dev/null', 'w'],
			2 => ['file', '/dev/null', 'w'],
		];
		$proc = @proc_open($line, $descriptorSpec, $pipes, null, null);
		if (!is_resource($proc)) {
			$this->logError('startDocsDownload: proc_open failed to launch docs job');
			return false;
		}
		if (isset($pipes[0]) && is_resource($pipes[0])) {
			fclose($pipes[0]);
		}
		// The outer `sh` returns immediately (job backgrounded with &), so this
		// does NOT block on the download.
		proc_close($proc);
		return true;
	}

	/**
	 * Current state of the docs download for this user.
	 *
	 * Shape: ['state' => 'idle'|'running'|'done'|'error',
	 *         'counts' => array|null, 'message' => string,
	 *         'started_at' => string|null, 'finished_at' => string|null].
	 *
	 * When a running job's rc file has appeared (it finished), this reconciles
	 * the status once: parses the CLI envelope from the job log, records the
	 * counts, flips state to done/error, and kicks an files:scan so the new
	 * PDFs surface in the Files app.
	 */
	public function docsStatus(): array {
		$status = $this->readDocsStatus();
		if (($status['state'] ?? 'idle') !== 'running') {
			return $status;
		}

		$rcFile = $this->docsRcPath();
		if (is_file($rcFile)) {
			return $this->reconcileFinishedDocsJob($status, (string) @file_get_contents($rcFile));
		}

		// Still running — but guard against an orphaned status (worker killed
		// before writing rc): if it's been "running" longer than the ceiling,
		// call it stale so the button doesn't stay disabled forever.
		$startedAt = strtotime((string) ($status['started_at'] ?? '')) ?: 0;
		if ($startedAt > 0 && (time() - $startedAt) > self::DOCS_JOB_MAX_SECONDS) {
			$status['state']       = 'error';
			$status['finished_at'] = date('c');
			$status['message']     = 'The download did not finish within the time limit. Please try again.';
			$this->writeDocsStatus($status);
			return $status;
		}
		return $status;
	}

	/** Parse the finished job's log + rc, persist a terminal status, scan files. */
	private function reconcileFinishedDocsJob(array $status, string $rcRaw): array {
		$rc = (int) trim($rcRaw);
		$log = (string) @file_get_contents($this->docsLogPath());

		// The CLI emits a `--json` envelope ({ok, data, ...}) as the last
		// well-formed JSON object on stdout. Scan from the end for it.
		$envelope = null;
		$lines = preg_split('/\r?\n/', $log) ?: [];
		for ($i = count($lines) - 1; $i >= 0; $i--) {
			$cand = trim($lines[$i]);
			if ($cand === '' || $cand[0] !== '{') { continue; }
			$decoded = json_decode($cand, true);
			if (is_array($decoded) && array_key_exists('ok', $decoded)) {
				$envelope = $decoded;
				break;
			}
		}

		$status['finished_at'] = date('c');
		if ($rc === 0 && is_array($envelope) && !empty($envelope['ok'])) {
			$data = $envelope['data'] ?? [];
			$status['state']  = 'done';
			$status['counts'] = $data['counts'] ?? new \stdClass();
			$status['message'] = '';
			$this->writeDocsStatus($status);
			$this->scanDocsFolder(); // surface the new PDFs in the Files app
			return $status;
		}

		// Failure — surface the tr-api exit code + message where we have it.
		$exitCode = is_array($envelope) ? (int) ($envelope['exit_code'] ?? $rc) : $rc;
		$msg = is_array($envelope) ? (string) ($envelope['message'] ?? '') : '';
		if ($msg === '') {
			$msg = $this->lastLine($log) ?: ('Download failed (exit ' . $exitCode . ').');
		}
		$status['state']     = 'error';
		$status['exit_code'] = $exitCode;
		$status['message']   = substr($msg, 0, 500);
		$this->writeDocsStatus($status);
		return $status;
	}

	private function readDocsStatus(): array {
		$path = $this->docsStatusPath();
		if (!is_file($path)) {
			return ['state' => 'idle', 'counts' => null, 'message' => '',
			        'started_at' => null, 'finished_at' => null];
		}
		$data = json_decode((string) @file_get_contents($path), true);
		if (!is_array($data)) {
			return ['state' => 'idle', 'counts' => null, 'message' => '',
			        'started_at' => null, 'finished_at' => null];
		}
		return $data;
	}

	private function writeDocsStatus(array $status): void {
		@file_put_contents(
			$this->docsStatusPath(),
			json_encode($status, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
			LOCK_EX
		);
	}

	/**
	 * Trigger an `occ files:scan` over the user's configured docs
	 * subtree. Best-effort: we ignore failures, the user can also do a
	 * manual refresh in the Files app to surface new files.
	 */
	private function scanDocsFolder(): void {
		$occ = \OC::$SERVERROOT . '/occ';
		if (!is_file($occ)) {
			return; // dev environment or unusual install layout
		}
		$path = '/' . $this->userId() . '/files/' . $this->getDocsFolder();
		// php is already running as www-data; no sudo needed.
		$cmd = ['php', $occ, 'files:scan', '--path=' . $path];
		$proc = @proc_open(
			$cmd,
			[1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
			$pipes,
			\OC::$SERVERROOT
		);
		if (is_resource($proc)) {
			// Don't block on huge scans — give it 60s, then bail.
			$start = microtime(true);
			while (proc_get_status($proc)['running'] ?? false) {
				if (microtime(true) - $start > 60) {
					proc_terminate($proc, 9);
					break;
				}
				usleep(200 * 1000);
			}
			@fclose($pipes[1]);
			@fclose($pipes[2]);
			proc_close($proc);
		}
	}
}
