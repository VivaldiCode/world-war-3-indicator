/** ntfy publisher. Never throws: a notification problem must not break a refresh. */
export async function ntfy(
  title: string,
  message: string,
  priority: 'default' | 'high' | 'urgent' = 'default',
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  const token = process.env.NTFY_TOKEN;
  const base = process.env.NTFY_URL ?? 'https://ntfy.guilhermepinto.pt';
  const topic = process.env.WW3_NTFY_TOPIC ?? 'homelab-ww3';
  if (!token) {
    console.warn(`[ww3.ntfy] NTFY_TOKEN not set; would send: ${title}`);
    return false;
  }
  try {
    const res = await doFetch(`${base.replace(/\/$/, '')}/${topic}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Title: title, Priority: priority, Tags: 'zap' },
      body: message,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`[ww3.ntfy] HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    console.warn('[ww3.ntfy] failed:', (err as Error).message);
    return false;
  }
}
