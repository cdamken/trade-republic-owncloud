<?php
/**
 * Renders the HTML pages (portfolio + analytics).
 *
 * No data is inlined — both pages fetch JSON via the api#data route, which
 * is what isolates one user from another at request time.
 */

namespace OCA\TradeRepublic\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;

class PageController extends Controller {

	private $urlGenerator;
	private $userSession;

	public function __construct(
		string $appName,
		IRequest $request,
		IURLGenerator $urlGenerator,
		IUserSession $userSession
	) {
		parent::__construct($appName, $request);
		$this->urlGenerator = $urlGenerator;
		$this->userSession = $userSession;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function index() {
		return $this->renderTemplate('main');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function analytics() {
		return $this->renderTemplate('analytics');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function settings() {
		return $this->renderTemplate('settings');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function glossary() {
		return $this->renderTemplate('glossary');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function dividends() {
		return $this->renderTemplate('dividends');
	}

	/**
	 * Render the page, or redirect to ownCloud login if the visitor is not
	 * authenticated. Without this guard ownCloud sometimes returns a bare
	 * 403 "Access forbidden" page instead of a friendly redirect to login.
	 */
	private function renderTemplate(string $template) {
		if (!$this->userSession->isLoggedIn()) {
			$here = $this->urlGenerator->linkToRoute(
				'trade_republic.page.' . ($template === 'analytics' ? 'analytics' : 'index')
			);
			$login = $this->urlGenerator->linkToRoute('core.login.showLoginForm')
			       . '?redirect_url=' . rawurlencode($here);
			return new RedirectResponse($login);
		}
		\OCP\Util::addStyle($this->appName, 'dashboard');
		// Analytics page needs Chart.js. Loaded BEFORE the page script so
		// `new Chart(...)` is available when analytics.js runs.
		// NOTE: ownCloud's JSResourceLocator auto-appends ".js"; pass the
		// path WITHOUT the suffix or it becomes "...js.js" → 404.
		if ($template === 'analytics' || $template === 'dividends') {
			\OCP\Util::addScript($this->appName, 'vendor/chart.umd.min');
		}
		$scriptMap = [
			'main'      => 'dashboard',
			'analytics' => 'analytics',
			'settings'  => 'settings',
			'glossary'  => 'glossary',
			'dividends' => 'dividends',
		];
		// Shared "🔄 Update Now" flow — loaded BEFORE the per-page script so the
		// in-place update button works on every page (Analytics/Dividends/
		// Settings/Glossary previously had a static link that bounced the user
		// to Portfolio). Main (Portfolio) opts out via data-update-flow-owner
		// because dashboard.js still owns the button there (verbatim port).
		\OCP\Util::addScript($this->appName, 'update_flow');
		\OCP\Util::addScript($this->appName, $scriptMap[$template] ?? 'dashboard');

		$params = [
			'routes' => [
				'index'        => $this->urlGenerator->linkToRoute('trade_republic.page.index'),
				'analytics'    => $this->urlGenerator->linkToRoute('trade_republic.page.analytics'),
				'settings'     => $this->urlGenerator->linkToRoute('trade_republic.page.settings'),
				'glossary'     => $this->urlGenerator->linkToRoute('trade_republic.page.glossary'),
				'dividends'    => $this->urlGenerator->linkToRoute('trade_republic.page.dividends'),
				'data'         => $this->urlGenerator->linkToRoute('trade_republic.api.data', ['type' => '__TYPE__']),
				'config'       => $this->urlGenerator->linkToRoute('trade_republic.api.getConfig'),
				'update'       => $this->urlGenerator->linkToRoute('trade_republic.api.update'),
				'reset'        => $this->urlGenerator->linkToRoute('trade_republic.api.reset'),
				'downloadDocs' => $this->urlGenerator->linkToRoute('trade_republic.api.downloadDocs'),
				'docsFolder'   => $this->urlGenerator->linkToRoute('trade_republic.api.getDocsFolder'),
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
