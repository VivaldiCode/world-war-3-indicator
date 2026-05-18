/**
 * Next.js `instrumentation.ts` is called once per server runtime boot.
 * We use it to kick off the scheduled refresher when running on Node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/scheduler');
    startScheduler();
  }
}
