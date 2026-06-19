<?php
/** Register occ console commands with full DI (oC 10 pattern). */

$app = new \OCA\TradeRepublicNext\Application();
$container = $app->getContainer();

/** @var \Symfony\Component\Console\Application $application */
$application->add($container->query(\OCA\TradeRepublicNext\Command\Ingest::class));
