/**
 * Headless-browser helper for scraping JS-rendered pages.
 *
 * This is wired up but not used by any source yet. When a publisher's page
 * stops working with plain fetch (Vision-of-Humanity, dynamic dashboards,
 * Cloudflare-protected pages), import `fetchRenderedHtml` from this module
 * and use it like fetchText:
 *
 *   const html = await fetchRenderedHtml('https://example.com', {
 *     waitFor: '.chart-data',
 *     timeoutMs: 20_000,
 *   });
 *
 * Setup:
 *   1. `playwright` is already in package.json.
 *   2. Run `npx playwright install chromium` once to download the browser
 *      (~150MB). This is intentionally NOT done by `npm install` so server
 *      builds without scraping needs stay slim.
 *   3. Set HEADLESS_ENABLED=1 in the environment (so the import is lazy
 *      and missing browsers don't crash a non-scraping deploy).
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

let _browser: Browser | null = null;
let _bootingPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser;
  if (_bootingPromise) return _bootingPromise;
  _bootingPromise = (async () => {
    const b = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    _browser = b;
    return b;
  })();
  return _bootingPromise;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => undefined);
    _browser = null;
    _bootingPromise = null;
  }
}

export interface RenderOptions {
  /** CSS selector that must appear before we read the HTML. */
  waitFor?: string;
  /** Network-idle wait (default true). */
  waitForNetworkIdle?: boolean;
  /** Hard cap on the whole operation. */
  timeoutMs?: number;
  /** UA string override. */
  userAgent?: string;
  /** Custom viewport. */
  viewport?: { width: number; height: number };
  /** Inject extra request headers. */
  headers?: Record<string, string>;
  /** Block heavy resource types to keep crawls light. */
  blockResources?: Array<'image' | 'font' | 'media' | 'stylesheet'>;
}

/**
 * Open a fresh ephemeral context, navigate to `url`, wait for either
 * `waitFor` or network idle, and return the rendered HTML.
 *
 * Each call uses a fresh context (cookies isolated) so concurrent scrapes
 * don't pollute each other.
 */
export async function fetchRenderedHtml(
  url: string,
  opts: RenderOptions = {},
): Promise<string> {
  if (process.env.HEADLESS_ENABLED !== '1') {
    throw new Error(
      'Headless browser disabled. Set HEADLESS_ENABLED=1 and run `npx playwright install chromium` first.',
    );
  }
  const browser = await getBrowser();
  const context: BrowserContext = await browser.newContext({
    userAgent:
      opts.userAgent ??
      'Mozilla/5.0 (compatible; WW3IndicatorBot/0.1; +https://github.com/ww3-indicator) Playwright',
    viewport: opts.viewport ?? { width: 1366, height: 900 },
    extraHTTPHeaders: opts.headers,
  });
  const blocked = new Set(opts.blockResources ?? ['image', 'font', 'media']);
  if (blocked.size > 0) {
    await context.route('**/*', (route) => {
      if (blocked.has(route.request().resourceType() as 'image')) {
        return route.abort();
      }
      return route.continue();
    });
  }
  const page: Page = await context.newPage();
  try {
    const timeout = opts.timeoutMs ?? 30_000;
    await page.goto(url, {
      waitUntil: opts.waitForNetworkIdle === false ? 'load' : 'networkidle',
      timeout,
    });
    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor, { timeout });
    }
    return await page.content();
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Like fetchRenderedHtml, but returns whatever value the function passed in
 * `extract` returns from inside the page context. Use this when you'd rather
 * read structured data than re-parse HTML.
 */
export async function fetchRenderedData<T>(
  url: string,
  extract: () => T | Promise<T>,
  opts: RenderOptions = {},
): Promise<T> {
  if (process.env.HEADLESS_ENABLED !== '1') {
    throw new Error('Headless browser disabled. Set HEADLESS_ENABLED=1 to use this helper.');
  }
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: opts.userAgent,
    viewport: opts.viewport ?? { width: 1366, height: 900 },
    extraHTTPHeaders: opts.headers,
  });
  const page = await context.newPage();
  try {
    const timeout = opts.timeoutMs ?? 30_000;
    await page.goto(url, {
      waitUntil: opts.waitForNetworkIdle === false ? 'load' : 'networkidle',
      timeout,
    });
    if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout });
    return (await page.evaluate(extract)) as T;
  } finally {
    await context.close().catch(() => undefined);
  }
}
