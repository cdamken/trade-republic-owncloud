<?php
/** Per-position daily snapshot (layer 2 · history). One row per security
 *  per day per user, so we can chart each asset's quantity/value over time. */

namespace OCA\TradeRepublic\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getCapturedOn()
 * @method void setCapturedOn(string $capturedOn)
 * @method string getCapturedAt()
 * @method void setCapturedAt(string $capturedAt)
 * @method int getSecurityId()
 * @method void setSecurityId(int $securityId)
 * @method string getQuantity()
 * @method void setQuantity(string $quantity)
 * @method string getPrice()
 * @method void setPrice(string $price)
 * @method string getMarketValue()
 * @method void setMarketValue(string $marketValue)
 * @method string getAvgCost()
 * @method void setAvgCost(string $avgCost)
 */
class HoldingSnapshot extends Entity {
	protected $userId;
	protected $capturedOn;
	protected $capturedAt;
	protected $securityId;
	protected $quantity;
	protected $price;
	protected $marketValue;
	protected $avgCost;

	public function __construct() {
		$this->addType('securityId', 'integer');
	}
}
