const DEFAULT_UA =
  'Mozilla/5.0 (compatible; WW3IndicatorBot/0.1; +https://github.com/ww3-indicator)';

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,text/csv,*/*;q=0.8',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  return res.text();
}

export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  return (await res.json()) as T;
}

/**
 * A flexible OHLC quote shape that all market sources share.
 */
export interface Quote {
  symbol: string;
  date: string;
  close: number;
  /** Previous-day close, if ≥2 rows. */
  prevClose?: number;
  /** Close from ~22 trading days back (≈1 calendar month), if available. */
  monthAgoClose?: number;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        symbol: string;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          close: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose: Array<number | null> }>;
      };
    }>;
    error?: { code: string; description: string };
  };
}

/**
 * Pull a Yahoo Finance daily chart for the symbol and reduce it to a Quote.
 *
 * Yahoo's `chart` JSON endpoint is free and doesn't require auth, but it does
 * 401 anonymous clients sometimes — they accept a `User-Agent` that looks like
 * a real browser.
 */
export interface YahooSeriesPoint {
  date: string; // ISO date (YYYY-MM-DD)
  close: number;
}

/**
 * Fetch a full historical daily series for a Yahoo symbol going back as far
 * as the publisher has it (`range=max`). Returns close-only OHLC reduction —
 * we only use closes downstream and this keeps payloads small.
 */
export async function fetchYahooSeries(symbol: string): Promise<YahooSeriesPoint[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=max`;
  const json = await fetchJson<YahooChartResponse>(url);
  if (json.chart.error) {
    throw new Error(`Yahoo error for ${symbol}: ${json.chart.error.description}`);
  }
  const result = json.chart.result?.[0];
  if (!result) throw new Error(`Yahoo returned no series for ${symbol}`);
  const closes = (result.indicators.adjclose?.[0]?.adjclose ??
    result.indicators.quote[0]?.close ??
    []) as Array<number | null>;
  const ts = result.timestamp ?? [];
  const out: YahooSeriesPoint[] = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const t = ts[i];
    if (c == null || !Number.isFinite(c) || t == null) continue;
    out.push({
      date: new Date(t * 1000).toISOString(),
      close: c,
    });
  }
  return out;
}

export async function fetchYahoo(symbol: string, range = '2mo'): Promise<Quote> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=${encodeURIComponent(range)}`;
  const json = await fetchJson<YahooChartResponse>(url);
  if (json.chart.error) {
    throw new Error(`Yahoo error for ${symbol}: ${json.chart.error.description}`);
  }
  const result = json.chart.result?.[0];
  if (!result) throw new Error(`Yahoo returned no data for ${symbol}`);
  const closes = (result.indicators.adjclose?.[0]?.adjclose ??
    result.indicators.quote[0]?.close ??
    []) as Array<number | null>;
  const cleaned = closes
    .map((c, i) => ({ c, t: result.timestamp?.[i] }))
    .filter((p) => p.c != null && Number.isFinite(p.c)) as Array<{ c: number; t?: number }>;
  if (cleaned.length === 0) throw new Error(`Yahoo close series empty for ${symbol}`);
  const last = cleaned[cleaned.length - 1];
  const prev = cleaned.length >= 2 ? cleaned[cleaned.length - 2] : undefined;
  const monthAgo = cleaned.length >= 22 ? cleaned[cleaned.length - 22] : cleaned[0];
  const close = result.meta.regularMarketPrice ?? last.c;
  const dateIso = last.t ? new Date(last.t * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return {
    symbol,
    date: dateIso,
    close,
    prevClose: prev?.c ?? result.meta.chartPreviousClose,
    monthAgoClose: monthAgo?.c,
  };
}
