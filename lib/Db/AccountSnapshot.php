<?php
/** Per-account daily snapshot (layer 2 · history). One row per account per
 *  day per user (TR has a single 'depot' account, but the shape mirrors the
 *  other trios). */

namespace OCA\TradeRepublic\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getCapturedOn()
 * @method void setCapturedOn(string $capturedOn)
 * @method string getAccountKey()
 * @method void setAccountKey(string $accountKey)
 * @method string getCapturedAt()
 * @method void setCapturedAt(string $capturedAt)
 * @method string getTotalValue()
 * @method void setTotalValue(string $totalValue)
 * @method string getCash()
 * @method void setCash(string $cash)
 */
class AccountSnapshot extends Entity {
	protected $userId;
	protected $capturedOn;
	protected $accountKey;
	protected $capturedAt;
	protected $totalValue;
	protected $cash;
}
