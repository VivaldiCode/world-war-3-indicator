/**
 * Same-origin flag proxy. The forces map paints each country with a flag via an
 * SVG <image>; browsers (and headless Chrome especially) refuse to rasterize
 * cross-origin images inside SVG, so we stream flagcdn.com PNGs through our own
 * origin. The alpha-2 code is hard-restricted to two letters — the only thing
 * interpolated into the upstream URL — so this can't be turned into an SSRF.
 */
const UA = 'ww3-indicator-bot/0.1 (+https://github.com/VivaldiCode/world-war-3-indicator)';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const safe = code.toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  if (safe.length !== 2) return new Response('bad code', { status: 400 });

  const upstream = await fetch(`https://flagcdn.com/w320/${safe}.png`, {
    headers: { 'user-agent': UA },
  });
  if (!upstream.ok || !upstream.body) return new Response('not found', { status: 404 });

  return new Response(upstream.body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=604800, immutable',
      'access-control-allow-origin': '*',
    },
  });
}
