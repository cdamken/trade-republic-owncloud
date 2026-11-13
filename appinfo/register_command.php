<?php
/** Register occ console commands with full DI (oC 10 pattern). */

$app = new \OCA\TradeRepublic\Application();
$container = $app->getContainer();

/** @var \Symfony\Component\Console\Application $application */
$application->addCommand($container->query(\OCA\TradeRepublic\Command\Ingest::class));
$application->addCommand($container->query(\OCA\TradeRepublic\Command\Analyze::class));
$application->addCommand($container->query(\OCA\TradeRepublic\Command\Lots::class));
