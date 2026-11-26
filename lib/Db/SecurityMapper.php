<?php
/**
 * SecurityMapper — layer 4 reference.
 *
 * ownCloud 10.13 has no QBMapper; we extend the legacy
 * OCP\AppFramework\Db\Mapper. Every query is scoped by user_id (the
 * per-user isolation boundary). Raw SQL uses the `*PREFIX*` table-prefix
 * token and positional `?` params, which the legacy Mapper binds safely.
 */

namespace OCA\TradeRepublic\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\Mapper;
use OCP\IDBConnection;

class SecurityMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'tr_securities', Security::class);
	}

	/** Wipe this user's rows (Reset / account-switch). Per-user, bound
	 *  parameter — never a table-wide delete. */
	public function deleteByUser(string $userId): void {
		$this->execute('DELETE FROM `*PREFIX*tr_securities` WHERE `user_id` = ?', [$userId]);
	}

	/** @return Security[] */
	public function findByUser(string $userId): array {
		$sql = 'SELECT * FROM `*PREFIX*tr_securities` WHERE `user_id` = ?';
		return $this->findEntities($sql, [$userId]);
	}

	/** Resolve by broker-native id (GBM issue_id / security_id). */
	public function findByExtId(string $userId, string $extId): ?Security {
		$sql = 'SELECT * FROM `*PREFIX*tr_securities` WHERE `user_id` = ? AND `ext_id` = ?';
		try {
			return $this->findEntity($sql, [$userId, $extId]);
		} catch (DoesNotExistException $e) {
			return null;
		}
	}
}
