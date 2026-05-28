<?php
/**
 * Renders the HTML pages (portfolio + analytics).
 *
 * No data is inlined — both pages fetch JSON via the api#data route, which
 * is what isolates one user from another at request time.
 */

namespace OCA\TradeRepublic\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;

class PageController extends Controller {

	private $urlGenerator;

	public function __construct(string $appName, IRequest $request, IURLGenerator $urlGenerator) {
		parent::__construct($appName, $request);
		$this->urlGenerator = $urlGenerator;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function index(): TemplateResponse {
		return $this->renderTemplate('main');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function analytics(): TemplateResponse {
		return $this->renderTemplate('analytics');
	}

	private function renderTemplate(string $template): TemplateResponse {
		\OCP\Util::addStyle($this->appName, 'dashboard');
		// Analytics page needs Chart.js. Loaded BEFORE the page script so
		// `new Chart(...)` is available when analytics.js runs.
		// NOTE: ownCloud's JSResourceLocator auto-appends ".js"; pass the
		// path WITHOUT the suffix or it becomes "...js.js" → 404.
		if ($template === 'analytics') {
			\OCP\Util::addScript($this->appName, 'vendor/chart.umd.min');
		}
		$scriptMap = [
			'main'      => 'dashboard',
			'analytics' => 'analytics',
		];
		\OCP\Util::addScript($this->appName, $scriptMap[$template] ?? 'dashboard');

		$params = [
			'routes' => [
				'index'      => $this->urlGenerator->linkToRoute('trade_republic.page.index'),
				'analytics'  => $this->urlGenerator->linkToRoute('trade_republic.page.analytics'),
				'data'       => $this->urlGenerator->linkToRoute('trade_republic.api.data', ['type' => '__TYPE__']),
				'config'     => $this->urlGenerator->linkToRoute('trade_republic.api.getConfig'),
				'update'     => $this->urlGenerator->linkToRoute('trade_republic.api.update'),
				'reset'      => $this->urlGenerator->linkToRoute('trade_republic.api.reset'),
				'downloadDocs' => $this->urlGenerator->linkToRoute('trade_republic.api.downloadDocs'),
			],
		];

		$response = new TemplateResponse($this->appName, $template, $params);
		$csp = new ContentSecurityPolicy();
		// Verbatim upstream HTML/JS has many inline `style="..."` attributes
		// and Chart.js draws canvases dynamically — both require relaxed
		// style-src. Inline <script> remains blocked; inline event handlers
		// were re-wired to addEventListener.
		$csp->allowInlineStyle(true);
		$response->setContentSecurityPolicy($csp);
		return $response;
	}
}
