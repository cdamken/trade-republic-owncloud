<?php
/**
 * IngestService (TR) — normalise the Trade Republic fetch output into the
 * tr_* DB tables. Same role + idempotency rules as gbm-owncloud's, but TR's
 * data shapes differ:
 *   - portfolio.json: summary{depot_buycost, total_netvalue, cash_eur, ...} +
 *     all_positions[{isin, name, category, avg_cost (per-unit), quantity,
 *     buy_cost_eur, net_value_eur, current_price}]. ONE account, 5 buckets →
 *     mapped to security.asset_class. Currency EUR. ext_id = ISIN.
 *   - account_transactions.csv (';'-delimited, NO event id): columns
 *     Date;Type;Value;Note;ISIN;Shares;Fees;Taxes;ISIN2;Shares2;EventType;
 *     EventSubType → orders (Buy/Sell) / dividends / transactions. We
 *     synthesise external_id = hash(date|type|isin|value|shares) for dedup.
 *
 * STATE (accounts/holdings) replaced each run; EVENTS upserted by external_id;
 * SECURITIES find-or-create by ISIN; one portfolio_snapshot per data date.
 */

namespace OCA\TradeRepublic\Service;

use OCA\TradeRepublic\Db\Account;
use OCA\TradeRepublic\Db\AccountMapper;
use OCA\TradeRepublic\Db\AccountSnapshot;
use OCA\TradeRepublic\Db\AccountSnapshotMapper;
use OCA\TradeRepublic\Db\Dividend;
use OCA\TradeRepublic\Db\DividendMapper;
use OCA\TradeRepublic\Db\Holding;
use OCA\TradeRepublic\Db\HoldingMapper;
use OCA\TradeRepublic\Db\HoldingSnapshot;
use OCA\TradeRepublic\Db\HoldingSnapshotMapper;
use OCA\TradeRepublic\Db\Order;
use OCA\TradeRepublic\Db\OrderMapper;
use OCA\TradeRepublic\Db\PortfolioSnapshot;
use OCA\TradeRepublic\Db\PortfolioSnapshotMapper;
use OCA\TradeRepublic\Db\Security;
use OCA\TradeRepublic\Db\SecurityMapper;
use OCA\TradeRepublic\Db\Transaction;
use OCA\TradeRepublic\Db\TransactionMapper;
use OCP\IConfig;

class IngestService {
	private const ACCOUNT_KEY = 'depot';

	/** @var IConfig */ private $config;
	/** @var SecurityMapper */ private $securities;
	/** @var AccountMapper */ private $accounts;
	/** @var HoldingMapper */ private $holdings;
	/** @var OrderMapper */ private $orders;
	/** @var TransactionMapper */ private $transactions;
	/** @var DividendMapper */ private $dividends;
	/** @var PortfolioSnapshotMapper */ private $snapshots;
	/** @var HoldingSnapshotMapper */ private $holdingSnapshots;
	/** @var AccountSnapshotMapper */ private $accountSnapshots;

	/** isin => security row id, cached per run. */
	private $secCache = [];

	public function __construct(
		IConfig $config,
		SecurityMapper $securities,
		AccountMapper $accounts,
		HoldingMapper $holdings,
		OrderMapper $orders,
		TransactionMapper $transactions,
		DividendMapper $dividends,
		PortfolioSnapshotMapper $snapshots,
		HoldingSnapshotMapper $holdingSnapshots,
		AccountSnapshotMapper $accountSnapshots
	) {
		$this->config = $config;
		$this->securities = $securities;
		$this->accounts = $accounts;
		$this->holdings = $holdings;
		$this->orders = $orders;
		$this->transactions = $transactions;
		$this->dividends = $dividends;
		$this->snapshots = $snapshots;
		$this->holdingSnapshots = $holdingSnapshots;
		$this->accountSnapshots = $accountSnapshots;
	}

	public function dataDir(string $uid): string {
		$base = (string) $this->config->getSystemValue('datadirectory', '/var/www/owncloud/data');
		return rtrim($base, '/') . '/' . $uid . '/trade_republic';
	}

	/** @return array<string,int> */
	public function ingestForUser(string $uid): array {
		$dir = $this->dataDir($uid);
		if (!is_dir($dir)) {
			throw new \RuntimeException("No trade_republic data dir for '$uid': $dir");
		}
		$this->secCache = [];

		$pf = $this->loadJson($dir, 'portfolio.json') ?? [];
		$summary = $pf['summary'] ?? [];
		$asOf = $this->readAsOf($dir);
		$asOfTs = $this->readAsOfTs($dir);
		$counts = ['accounts' => 0, 'holdings' => 0, 'securities' => 0,
			'orders' => 0, 'transactions' => 0, 'dividends' => 0, 'snapshot' => 0,
			'holding_snapshots' => 0, 'account_snapshot' => 0];

		// --- STATE: one account + holdings -------------------------------
		$this->holdings->deleteByUser($uid);
		$this->accounts->deleteByUser($uid);

		$acc = new Account();
		$acc->setUserId($uid);
		$acc->setAccountKey(self::ACCOUNT_KEY);
		$acc->setName('Trade Republic');
		$acc->setType('depot');
		$acc->setCurrency('EUR');
		$acc->setCashAmount($this->num($summary['cash_eur'] ?? 0));
		$acc->setTotalValue($this->num($summary['total_netvalue'] ?? 0));
		$acc->setUpdatedAt($asOf);
		$accId = (int) $this->accounts->insert($acc)->getId();
		$counts['accounts'] = 1;

		foreach (($pf['all_positions'] ?? []) as $p) {
			$isin = (string) ($p['isin'] ?? '');
			if ($isin === '') {
				continue;
			}
			$secId = $this->resolveSecurity($uid, $isin, (string) ($p['name'] ?? ''), (string) ($p['category'] ?? ''));
			$hold = new Holding();
			$hold->setUserId($uid);
			$hold->setAccountId($accId);
			$hold->setSecurityId($secId);
			$hold->setQuantity($this->num($p['quantity'] ?? null));
			$hold->setAvgCost($this->num($p['avg_cost'] ?? null));      // per-unit (TR averageBuyIn)
			$hold->setLastPrice($this->num($p['current_price'] ?? null));
			$hold->setMarketValue($this->num($p['net_value_eur'] ?? null));
			$hold->setCurrency('EUR');
			$hold->setUpdatedAt($asOf);
			$this->holdings->insert($hold);
			$counts['holdings']++;

			// HISTORY (per position): idempotent upsert keyed by (uid, day, sec).
			// Holdings themselves are replaced each run (state), but this row
			// accrues so each asset's quantity/value can be charted over time.
			$hsnap = $this->holdingSnapshots->findByDateSecurity($uid, $asOf, $secId)
				?? $this->newHoldingSnapshot($uid, $asOf, $secId);
			$hsnap->setCapturedAt($asOfTs);
			$hsnap->setQuantity($this->num($p['quantity'] ?? null));
			$hsnap->setPrice($this->num($p['current_price'] ?? null));    // per-share market price
			$hsnap->setMarketValue($this->num($p['net_value_eur'] ?? null));
			$hsnap->setAvgCost($this->num($p['avg_cost'] ?? null));
			$this->save($this->holdingSnapshots, $hsnap);
			$counts['holding_snapshots']++;
		}
		$counts['securities'] = count($this->secCache);

		// HISTORY (per account): one row per account per data date.
		$asnap = $this->accountSnapshots->findByDateAccount($uid, $asOf, self::ACCOUNT_KEY)
			?? $this->newAccountSnapshot($uid, $asOf, self::ACCOUNT_KEY);
		$asnap->setCapturedAt($asOfTs);
		$asnap->setTotalValue($this->num($summary['total_netvalue'] ?? 0));
		$asnap->setCash($this->num($summary['cash_eur'] ?? 0));
		$this->save($this->accountSnapshots, $asnap);
		$counts['account_snapshot'] = 1;

		// --- EVENTS: account_transactions.csv ----------------------------
		foreach ($this->readCsv($dir . '/account_transactions.csv') as $r) {
			$type = strtolower(trim((string) ($r['Type'] ?? '')));
			$isin = trim((string) ($r['ISIN'] ?? ''));
			$date = trim((string) ($r['Date'] ?? ''));
			$value = $this->f($r['Value'] ?? null);
			$shares = $this->f($r['Shares'] ?? null);
			$fees = $this->f($r['Fees'] ?? null);
			$tax = $this->f($r['Taxes'] ?? null);
			$ext = substr(md5($date . '|' . $type . '|' . $isin . '|' . ($r['Value'] ?? '') . '|' . ($r['Shares'] ?? '')), 0, 32);
			$secId = $isin !== '' ? $this->resolveSecurity($uid, $isin, (string) ($r['Note'] ?? ''), '') : null;

			if ($this->isOrder($type)) {
				$side = (strpos($type, 'sell') !== false || strpos($type, 'sale') !== false) ? 'sell' : 'buy';
				$entity = $this->orders->findByExternalId($uid, $ext) ?? $this->newOrder($uid, $ext);
				$entity->setAccountKey(self::ACCOUNT_KEY);
				if ($secId !== null) {
					$entity->setSecurityId($secId);
				}
				$entity->setSide($side);
				$entity->setQuantity($this->num($shares));
				$entity->setPrice($this->num($shares != 0.0 ? abs($value) / $shares : 0));
				$entity->setFees($this->num($fees));
				$entity->setCurrency('EUR');
				$entity->setExecutedAt($date);
				$entity->setStatus('filled');
				$this->save($this->orders, $entity);
				$counts['orders']++;
			} elseif (strpos($type, 'dividend') !== false) {
				$entity = $this->dividends->findByExternalId($uid, $ext) ?? $this->newDividend($uid, $ext);
				if ($secId !== null) {
					$entity->setSecurityId($secId);
				}
				$entity->setGross($this->num($value + $tax));
				$entity->setNet($this->num($value));
				$entity->setTax($this->num($tax));
				$entity->setCurrency('EUR');
				$entity->setPaidAt($date);
				$this->save($this->dividends, $entity);
				$counts['dividends']++;
			} else {
				$entity = $this->transactions->findByExternalId($uid, $ext) ?? $this->newTransaction($uid, $ext);
				$entity->setType((string) ($r['Type'] ?? ''));
				$entity->setRawType((string) ($r['EventType'] ?? ''));
				$entity->setAmount($this->num($value));
				$entity->setCurrency('EUR');
				if ($secId !== null) {
					$entity->setSecurityId($secId);
				}
				$entity->setBookedAt($date);
				$this->save($this->transactions, $entity);
				$counts['transactions']++;
			}
		}

		// --- HISTORY: one snapshot for the data date ---------------------
		$snap = $this->snapshots->findByDate($uid, $asOf) ?? $this->newSnapshot($uid, $asOf);
		$snap->setTotalValue($this->num($summary['total_netvalue'] ?? 0));
		$snap->setTotalCost($this->num($summary['total_buycost'] ?? 0));
		$snap->setCash($this->num($summary['cash_eur'] ?? 0));
		$snap->setCurrency('EUR');
		$snap->setSource('ingest');
		$this->save($this->snapshots, $snap);
		$counts['snapshot'] = 1;

		return $counts;
	}

	// --- helpers ---------------------------------------------------------

	private function isOrder(string $type): bool {
		foreach (['buy', 'sell', 'purchase', 'sale', 'savings', 'saveback'] as $kw) {
			if (strpos($type, $kw) !== false) {
				return true;
			}
		}
		return false;
	}

	private function newOrder(string $uid, string $ext): Order {
		$e = new Order(); $e->setUserId($uid); $e->setExternalId($ext); return $e;
	}
	private function newDividend(string $uid, string $ext): Dividend {
		$e = new Dividend(); $e->setUserId($uid); $e->setExternalId($ext); return $e;
	}
	private function newTransaction(string $uid, string $ext): Transaction {
		$e = new Transaction(); $e->setUserId($uid); $e->setExternalId($ext); return $e;
	}
	private function newSnapshot(string $uid, string $date): PortfolioSnapshot {
		$e = new PortfolioSnapshot(); $e->setUserId($uid); $e->setCapturedOn($date); return $e;
	}
	private function newHoldingSnapshot(string $uid, string $date, int $securityId): HoldingSnapshot {
		$e = new HoldingSnapshot();
		$e->setUserId($uid); $e->setCapturedOn($date); $e->setSecurityId($securityId);
		return $e;
	}
	private function newAccountSnapshot(string $uid, string $date, string $accountKey): AccountSnapshot {
		$e = new AccountSnapshot();
		$e->setUserId($uid); $e->setCapturedOn($date); $e->setAccountKey($accountKey);
		return $e;
	}

	private function save($mapper, $entity): void {
		if ($entity->getId() === null) {
			$mapper->insert($entity);
		} else {
			$mapper->update($entity);
		}
	}

	/** Find-or-create a security by ISIN (TR's natural key). */
	private function resolveSecurity(string $uid, string $isin, string $name, string $category): int {
		if (isset($this->secCache[$isin])) {
			return $this->secCache[$isin];
		}
		$sec = $this->securities->findByExtId($uid, $isin);
		if ($sec === null) {
			$sec = new Security();
			$sec->setUserId($uid);
			$sec->setExtId($isin);
			$sec->setIsin($isin);
			$sec->setName($name);
			$sec->setAssetClass($category);
			$sec->setRegion('foreign');
			$sec->setCurrency('EUR');
			$sec = $this->securities->insert($sec);
		} elseif ($name !== '' && (string) $sec->getName() === '') {
			$sec->setName($name);
			$this->securities->update($sec);
		}
		$id = (int) $sec->getId();
		$this->secCache[$isin] = $id;
		return $id;
	}

	/** @return array<int,array<string,string>> rows keyed by header column (';'-delimited). */
	private function readCsv(string $path): array {
		if (!is_file($path)) {
			return [];
		}
		$out = [];
		$fh = fopen($path, 'r');
		if ($fh === false) {
			return [];
		}
		$header = fgetcsv($fh, 0, ';');
		if ($header === false) {
			fclose($fh);
			return [];
		}
		while (($row = fgetcsv($fh, 0, ';')) !== false) {
			$assoc = [];
			foreach ($header as $i => $col) {
				$assoc[$col] = $row[$i] ?? '';
			}
			$out[] = $assoc;
		}
		fclose($fh);
		return $out;
	}

	/** @return array|null */
	private function loadJson(string $dir, string $file) {
		$p = $dir . '/' . $file;
		if (!is_file($p)) {
			return null;
		}
		$d = json_decode((string) file_get_contents($p), true);
		return is_array($d) ? $d : null;
	}

	private function readAsOf(string $dir): string {
		$p = $dir . '/last_update.date';
		if (is_file($p)) {
			$raw = trim((string) file_get_contents($p));
			if ($raw !== '') {
				return substr($raw, 0, 10);
			}
		}
		return date('Y-m-d');
	}

	/** Full fetch timestamp (day + time), e.g. "2026-07-15T17:05:31Z". Falls
	 *  back to the current datetime if last_update.date is missing/empty. */
	private function readAsOfTs(string $dir): string {
		$p = $dir . '/last_update.date';
		if (is_file($p)) {
			$raw = trim((string) file_get_contents($p));
			if ($raw !== '') {
				return $raw;
			}
		}
		return date('c');
	}

	private function f($v): float {
		return $v === null || $v === '' ? 0.0 : (float) $v;
	}

	private function num($v): ?string {
		if ($v === null || $v === '') {
			return null;
		}
		if (is_int($v)) {
			return (string) $v;
		}
		if (is_string($v) && !is_numeric($v)) {
			return $v;
		}
		$s = rtrim(rtrim(sprintf('%.6f', (float) $v), '0'), '.');
		return $s === '' || $s === '-0' ? '0' : $s;
	}
}
