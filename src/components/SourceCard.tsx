'use client';

import type { CompositeIndex, SeverityBand } from '@/lib/types';
import { STATUS_LABEL, friendlyError } from '@/lib/error_messages';

interface Props {
  c: CompositeIndex['contributors'][number];
}

const categoryLabel: Record<string, string> = {
  markets: 'Markets',
  conflicts: 'Conflicts',
  sentiment: 'Sentiment',
  military: 'Military',
  diplomacy: 'Diplomacy',
};

const STATUS_TONE: Record<string, { bg: string; ink: string }> = {
  'awaiting-credentials': { bg: 'rgba(31, 93, 138, 0.18)', ink: '#1f5d8a' },
  'rate-limited': { bg: 'rgba(196, 106, 35, 0.18)', ink: '#8a4513' },
  activating: { bg: 'rgba(212, 168, 67, 0.22)', ink: '#7a5b13' },
  'upstream-down': { bg: 'rgba(168, 51, 26, 0.18)', ink: '#7a2516' },
  parsing: { bg: 'rgba(106, 74, 38, 0.22)', ink: '#4a3522' },
  unknown: { bg: 'rgba(106, 74, 38, 0.15)', ink: '#4a3522' },
};

export function SourceCard({ c }: Props) {
  const bandBg =
    c.band === 'red' ? 'bg-band-red' : c.band === 'yellow' ? 'bg-band-yellow' : 'bg-band-green';

  if (!c.ok) {
    return <DormantCard c={c} />;
  }

  return (
    <div className="parchment rounded-md p-4 flex flex-col gap-3 relative">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-[0.65rem] tracking-[0.25em] uppercase text-ink/60">
            {categoryLabel[c.category] ?? c.category}
          </div>
          <div className="font-display text-base tracking-wide leading-tight">{c.name}</div>
        </div>
        <span className={`font-display text-xs tracking-widest px-2 py-1 rounded ${bandBg}`}>
          {c.band.toUpperCase()}
        </span>
      </div>
      <div className="flex items-baseline gap-3 dashed-rule pt-2">
        <div>
          <div className="text-[0.6rem] uppercase tracking-widest text-ink/60">Value</div>
          <div className="font-mono text-lg">
            {c.raw == null ? '—' : typeof c.raw === 'number' ? formatNum(c.raw) : c.raw}
            {c.rawUnit && <span className="ml-1 text-[0.65rem] text-ink/60">{c.rawUnit}</span>}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[0.6rem] uppercase tracking-widest text-ink/60">Score</div>
          <div className="font-mono text-lg">{c.score.toFixed(1)}</div>
        </div>
        <div className="text-right">
          <div className="text-[0.6rem] uppercase tracking-widest text-ink/60">Weight</div>
          <div className="font-mono text-lg">{(c.weight * 100).toFixed(1)}%</div>
        </div>
      </div>
      <div className="text-sm italic">{c.rationale}</div>
      <div className="mt-auto flex items-center justify-between text-[0.65rem] text-ink/60">
        <span>contribution → {c.contribution.toFixed(1)} pts</span>
        <span>{formatTime(c.measuredAt)}</span>
      </div>
    </div>
  );
}

function DormantCard({ c }: Props) {
  const fe = friendlyError(c.error);
  const tone = STATUS_TONE[fe.status] ?? STATUS_TONE.unknown;
  return (
    <div className="parchment rounded-md p-4 flex flex-col gap-3 relative opacity-90">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-[0.65rem] tracking-[0.25em] uppercase text-ink/60">
            {categoryLabel[c.category] ?? c.category}
          </div>
          <div className="font-display text-base tracking-wide leading-tight">{c.name}</div>
        </div>
        <span
          className="font-display text-[0.6rem] tracking-[0.25em] px-2 py-1 rounded uppercase"
          style={{ background: tone.bg, color: tone.ink }}
        >
          {STATUS_LABEL[fe.status]}
        </span>
      </div>
      <div className="dashed-rule pt-3 flex gap-3 items-start">
        <StatusIcon status={fe.status} color={tone.ink} />
        <div className="flex-1">
          <div className="font-display text-sm" style={{ color: tone.ink }}>
            {fe.message}
          </div>
          {fe.hint && <div className="text-xs italic text-ink/60 mt-1">{fe.hint}</div>}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between text-[0.65rem] text-ink/50">
        <span>weight on standby · {(c.weight * 100 || 0).toFixed(1)}%</span>
        <span>weight redistributed across healthy sources</span>
      </div>
    </div>
  );
}

function StatusIcon({ status, color }: { status: string; color: string }) {
  // Stamp-style icon set, all in SVG so they print well on parchment.
  const common = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.4 };
  if (status === 'awaiting-credentials') {
    return (
      <svg {...common} aria-hidden>
        <rect x="6" y="11" width="12" height="9" rx="1.5" />
        <path d="M9 11V8a3 3 0 0 1 6 0v3" />
      </svg>
    );
  }
  if (status === 'rate-limited') {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (status === 'activating') {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      </svg>
    );
  }
  if (status === 'upstream-down') {
    return (
      <svg {...common} aria-hidden>
        <path d="M3 17l9-12 9 12" />
        <path d="M12 11v4M12 17.5v.5" />
      </svg>
    );
  }
  if (status === 'parsing') {
    return (
      <svg {...common} aria-hidden>
        <path d="M9 4 5 8l4 4M15 4l4 4-4 4M14 14l-4 6" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5M12 16v.5" />
    </svg>
  );
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function bandTone(band: SeverityBand): string {
  return band === 'red' ? 'band-red' : band === 'yellow' ? 'band-yellow' : 'band-green';
}
