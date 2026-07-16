<?php
/** AccountSnapshotMapper — layer 2 history, per account. Scoped by user_id.
 *  Idempotent per (user, day, account_key) via the tr_asnap_uq unique index. */

namespace OCA\TradeRepublic\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\Mapper;
use OCP\IDBConnection;

class AccountSnapshotMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'tr_account_snapshots', AccountSnapshot::class);
	}

	/**
	 * Full per-account history, oldest first.
	 * @return AccountSnapshot[]
	 */
	public function findByUser(string $userId): array {
		$sql = 'SELECT * FROM `*PREFIX*tr_account_snapshots` '
			. 'WHERE `user_id` = ? ORDER BY `captured_on` ASC, `account_key` ASC';
		return $this->findEntities($sql, [$userId]);
	}

	/** Lookup one (day, account), for the idempotent daily upsert. */
	public function findByDateAccount(string $userId, string $capturedOn, string $accountKey): ?AccountSnapshot {
		$sql = 'SELECT * FROM `*PREFIX*tr_account_snapshots` '
			. 'WHERE `user_id` = ? AND `captured_on` = ? AND `account_key` = ?';
		try {
			return $this->findEntity($sql, [$userId, $capturedOn, $accountKey]);
		} catch (DoesNotExistException $e) {
			return null;
		}
	}
}
