<?php
/** HoldingSnapshotMapper — layer 2 history, per position. Scoped by user_id.
 *  Idempotent per (user, day, security) via the tr_hsnap_uq unique index. */

namespace OCA\TradeRepublic\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\Mapper;
use OCP\IDBConnection;

class HoldingSnapshotMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'tr_holding_snapshots', HoldingSnapshot::class);
	}

	/**
	 * Full per-position history, oldest first — the series the per-asset
	 * variation view consumes.
	 * @return HoldingSnapshot[]
	 */
	public function findByUser(string $userId): array {
		$sql = 'SELECT * FROM `*PREFIX*tr_holding_snapshots` '
			. 'WHERE `user_id` = ? ORDER BY `captured_on` ASC, `security_id` ASC';
		return $this->findEntities($sql, [$userId]);
	}

	/**
	 * Time series for one security, oldest first.
	 * @return HoldingSnapshot[]
	 */
	public function findBySecurity(string $userId, int $securityId): array {
		$sql = 'SELECT * FROM `*PREFIX*tr_holding_snapshots` '
			. 'WHERE `user_id` = ? AND `security_id` = ? ORDER BY `captured_on` ASC';
		return $this->findEntities($sql, [$userId, $securityId]);
	}

	/** Lookup one (day, security), for the idempotent daily upsert. */
	public function findByDateSecurity(string $userId, string $capturedOn, int $securityId): ?HoldingSnapshot {
		$sql = 'SELECT * FROM `*PREFIX*tr_holding_snapshots` '
			. 'WHERE `user_id` = ? AND `captured_on` = ? AND `security_id` = ?';
		try {
			return $this->findEntity($sql, [$userId, $capturedOn, $securityId]);
		} catch (DoesNotExistException $e) {
			return null;
		}
	}
}
