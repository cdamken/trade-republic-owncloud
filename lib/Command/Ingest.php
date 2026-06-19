<?php
/**
 * occ tr_next:ingest <user>
 *
 * Normalises the user's TR fetch JSON (data dir) into the gbm_* tables.
 * Idempotent — safe to re-run. Reused by the Fase 3 background job.
 */

namespace OCA\TradeRepublicNext\Command;

use OCA\TradeRepublicNext\Service\IngestService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class Ingest extends Command {
	/** @var IngestService */
	private $ingest;

	public function __construct(IngestService $ingest) {
		parent::__construct();
		$this->ingest = $ingest;
	}

	protected function configure() {
		$this->setName('tr_next:ingest')
			->setDescription('Ingest TR fetch JSON into the gbm_* DB tables')
			->addArgument('user', InputArgument::REQUIRED, 'ownCloud user id to ingest');
	}

	protected function execute(InputInterface $input, OutputInterface $output) {
		$uid = (string) $input->getArgument('user');
		try {
			$counts = $this->ingest->ingestForUser($uid);
		} catch (\Throwable $e) {
			$output->writeln('<error>' . $uid . ': ' . $e->getMessage() . '</error>');
			return 1;
		}
		$parts = [];
		foreach ($counts as $k => $v) {
			$parts[] = "$k=$v";
		}
		$output->writeln('<info>' . $uid . '</info> ingested: ' . implode('  ', $parts));
		return 0;
	}
}
