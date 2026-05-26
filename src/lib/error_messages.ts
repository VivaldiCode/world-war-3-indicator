/**
 * Map a raw scraper error string into a short, user-friendly status the UI
 * can render without leaking implementation details (env var names, URLs,
 * stack lines, HTTP codes).
 */
export interface FriendlyError {
  /** Short label shown on the card body (≤ 80 chars). */
  message: string;
  /** Optional hint shown smaller underneath. */
  hint?: string;
  /** Stable status tag — used for icon/colour treatment. */
  status: 'awaiting-credentials' | 'rate-limited' | 'activating' | 'upstream-down' | 'parsing' | 'unknown';
}

const PATTERNS: Array<{
  match: (s: string) => boolean;
  build: () => FriendlyError;
}> = [
  // ---- Awaiting credentials --------------------------------------------
  {
    match: (s) => /ACLED_USERNAME|ACLED_PASSWORD|ACLED_KEY|ACLED_EMAIL/i.test(s),
    build: () => ({
      message: 'Awaiting ACLED registration',
      hint: 'Free account at acleddata.com unlocks 30-day political-violence counts.',
      status: 'awaiting-credentials',
    }),
  },
  {
    match: (s) => /ACLED account awaiting approval/i.test(s),
    build: () => ({
      message: 'ACLED account awaiting approval',
      hint: 'Credentials accepted — ACLED grants data-read scope 1–2 business days after sign-up.',
      status: 'activating',
    }),
  },
  {
    match: (s) => /LIVEUAMAP_API_KEY/i.test(s),
    build: () => ({
      message: 'Awaiting Liveuamap key',
      hint: 'Premium key from me.liveuamap.com/devapi unlocks live geo-tagged conflict events.',
      status: 'awaiting-credentials',
    }),
  },
  {
    match: (s) => /Liveuamap endpoint shape mismatch/i.test(s),
    build: () => ({
      message: 'Liveuamap endpoint pending setup',
      hint: 'Copy the example request from me.liveuamap.com/devapi into LIVEUAMAP_ENDPOINT in the source file.',
      status: 'parsing',
    }),
  },
  {
    match: (s) => /CLOUDFLARE_API_TOKEN/i.test(s),
    build: () => ({
      message: 'Awaiting Cloudflare token',
      hint: 'Free token with radar:read permission unlocks internet attack telemetry.',
      status: 'awaiting-credentials',
    }),
  },
  {
    match: (s) => /N2YO_API_KEY/i.test(s),
    build: () => ({
      message: 'Awaiting n2yo key',
      hint: 'Free account at n2yo.com unlocks satellite tracking.',
      status: 'awaiting-credentials',
    }),
  },
  {
    match: (s) => /ELECTRICITYMAP_TOKEN/i.test(s),
    build: () => ({
      message: 'Awaiting Electricity Maps token',
      hint: 'Token scope determines which grid zones are visible.',
      status: 'awaiting-credentials',
    }),
  },
  {
    match: (s) => /OPENWEATHER_API_KEY/i.test(s) || /key not yet activated/i.test(s),
    build: () => ({
      message: 'OpenWeather key warming up',
      hint: 'Newly created OWM keys can take up to two hours to activate.',
      status: 'activating',
    }),
  },

  // ---- Rate limits / upstream throttling --------------------------------
  {
    match: (s) => /429|Too Many Requests|GDELT rate limit|limit requests/i.test(s),
    build: () => ({
      message: 'Upstream is throttling us',
      hint: 'We will pick this back up on the next scheduled crawl.',
      status: 'rate-limited',
    }),
  },

  // ---- Auth / activation issues ----------------------------------------
  {
    match: (s) => /\b401\b|Unauthorized|Invalid API key/i.test(s),
    build: () => ({
      message: 'Upstream rejected our credentials',
      hint: 'Key may still be activating, expired, or out of quota.',
      status: 'activating',
    }),
  },
  {
    match: (s) => /\b403\b|Forbidden/i.test(s),
    build: () => ({
      message: 'Access denied by source',
      hint: 'The publisher may have changed terms or blocked automated traffic.',
      status: 'upstream-down',
    }),
  },
  {
    match: (s) => /\b404\b|Not Found/i.test(s),
    build: () => ({
      message: 'Source page moved',
      hint: 'Our scraper needs an update to follow the new endpoint.',
      status: 'parsing',
    }),
  },
  {
    match: (s) => /\b5\d\d\b|Service Unavailable|Bad Gateway/i.test(s),
    build: () => ({
      message: 'Source is having a bad day',
      hint: 'We will retry on the next scheduled crawl.',
      status: 'upstream-down',
    }),
  },

  // ---- Parsing / shape issues -------------------------------------------
  {
    match: (s) => /Could not parse|empty timeline|no data|non-JSON|sentence/i.test(s),
    build: () => ({
      message: 'Data shape changed at the source',
      hint: 'The publisher updated their page; the scraper needs a tune-up.',
      status: 'parsing',
    }),
  },

  // ---- Generic network --------------------------------------------------
  {
    match: (s) => /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(s),
    build: () => ({
      message: 'Couldn’t reach the source',
      hint: 'Network glitch — will retry shortly.',
      status: 'upstream-down',
    }),
  },
];

export function friendlyError(raw: string | undefined | null): FriendlyError {
  if (!raw) {
    return {
      message: 'No reading on file yet',
      hint: 'First crawl will populate this card.',
      status: 'unknown',
    };
  }
  for (const p of PATTERNS) {
    if (p.match(raw)) return p.build();
  }
  return {
    message: 'No data this cycle',
    hint: 'The upstream returned something unexpected.',
    status: 'unknown',
  };
}

export const STATUS_LABEL: Record<FriendlyError['status'], string> = {
  'awaiting-credentials': 'standby',
  'rate-limited': 'cooling off',
  activating: 'warming up',
  'upstream-down': 'source down',
  parsing: 'needs tune-up',
  unknown: 'no data',
};
