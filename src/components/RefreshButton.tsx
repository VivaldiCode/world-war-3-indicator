'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshButton() {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function go() {
    setBusy(true);
    try {
      await fetch('/api/refresh?force=1', { method: 'POST' });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }
  const isBusy = busy || pending;
  return (
    <button
      onClick={go}
      disabled={isBusy}
      className="font-display tracking-[0.2em] text-xs px-4 py-2 rounded border border-parchment text-parchment hover:bg-parchment hover:text-ink transition disabled:opacity-50"
    >
      {isBusy ? '· crawling sources ·' : 'Roll the Dice → Refresh'}
    </button>
  );
}
