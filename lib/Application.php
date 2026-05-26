<?php
/**
 * Application class — registers the navigation entry.
 *
 * TrService is NOT registered as a custom binding here: the ownCloud 10 DI
 * container auto-wires it from its IUserSession + IConfig + ICrypto
 * constructor. Registering a closure with `registerService(TrService::class,
 * ...)` doesn't override that auto-wiring reliably — the container resolves
 * by class name first and only consults closures for non-class service ids.
 * To keep per-user isolation, TrService resolves the userId lazily from
 * IUserSession (see TrService::userId()).
 */

namespace OCA\TradeRepublic;

use OCP\AppFramework\App;
use OCP\INavigationManager;
use OCP\IURLGenerator;

class Application extends App {

	const APPID = 'trade_republic';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APPID, $urlParams);

		$container = $this->getContainer();

		$container->query(INavigationManager::class)->add(function () use ($container) {
			$url = $container->query(IURLGenerator::class);
			return [
				'id'    => self::APPID,
				'order' => 80,
				'href'  => $url->linkToRoute('trade_republic.page.index'),
				'icon'  => $url->imagePath(self::APPID, 'app.svg'),
				'name'  => 'Trade Republic',
			];
		});
	}
}
