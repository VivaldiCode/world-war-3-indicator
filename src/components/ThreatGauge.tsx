'use client';

import type { SeverityBand } from '@/lib/types';

interface Props {
  score: number;
  band: SeverityBand;
  label?: string;
}

/**
 * Half-circle "Risk threat dial" — needle sweeps from green (left) through
 * yellow into red (right). Numeric readout below.
 */
export function ThreatGauge({ score, band, label = 'WW3 Indicator' }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  // -90deg = pointing left, +90deg = pointing right
  const angle = -90 + (clamped / 100) * 180;
  const bandColor =
    band === 'red' ? '#a8331a' : band === 'yellow' ? '#b78a1f' : '#3b6e3a';
  const bandLabel = band === 'red' ? 'TOTAL WAR' : band === 'yellow' ? 'TENSION' : 'PEACE';

  return (
    <div className="flex flex-col items-center select-none">
      <div className="relative" style={{ width: 360, height: 200 }}>
        {/* Arc */}
        <svg viewBox="0 0 360 200" width="360" height="200">
          <defs>
            <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b6e3a" />
              <stop offset="33%" stopColor="#d4a843" />
              <stop offset="66%" stopColor="#c46a23" />
              <stop offset="100%" stopColor="#6b1d10" />
            </linearGradient>
          </defs>
          {/* Outer parchment ring */}
          <path
            d="M 30 180 A 150 150 0 0 1 330 180"
            stroke="#6b4a26"
            strokeWidth="22"
            fill="none"
            strokeLinecap="round"
          />
          {/* Color arc */}
          <path
            d="M 36 180 A 144 144 0 0 1 324 180"
            stroke="url(#arcGrad)"
            strokeWidth="18"
            fill="none"
            strokeLinecap="round"
          />
          {/* Tick marks — arc sweeps clockwise from 180° (left) to 360° (right). */}
          {[0, 25, 50, 75, 100].map((t) => {
            const a = 180 + (t / 100) * 180;
            const rad = (a * Math.PI) / 180;
            const x1 = 180 + Math.cos(rad) * 130;
            const y1 = 180 + Math.sin(rad) * 130;
            const x2 = 180 + Math.cos(rad) * 158;
            const y2 = 180 + Math.sin(rad) * 158;
            const lx = 180 + Math.cos(rad) * 108;
            const ly = 180 + Math.sin(rad) * 108;
            return (
              <g key={t}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2b1d10" strokeWidth="2" />
                <text
                  x={lx}
                  y={ly + 4}
                  textAnchor="middle"
                  fill="#e8d9b0"
                  fontFamily="Cinzel, serif"
                  fontSize="12"
                  fontWeight="700"
                >
                  {t}
                </text>
              </g>
            );
          })}
          {/* Needle */}
          <g transform={`rotate(${angle} 180 180)`} style={{ transition: 'transform 800ms cubic-bezier(.2,.8,.2,1)' }}>
            <polygon points="180,40 175,180 185,180" fill="#2b1d10" />
            <circle cx="180" cy="180" r="10" fill="#2b1d10" stroke="#e8d9b0" strokeWidth="2" />
          </g>
        </svg>
      </div>
      <div className="-mt-4 flex flex-col items-center">
        <div
          className="font-display text-7xl tracking-tight"
          style={{ color: bandColor, textShadow: '0 2px 0 rgba(0,0,0,0.5)' }}
        >
          {clamped.toFixed(1)}
        </div>
        <div className="font-display text-sm tracking-[0.3em] mt-1" style={{ color: bandColor }}>
          {bandLabel}
        </div>
        <div className="font-display text-xs tracking-[0.3em] mt-1 text-parchment/70">{label}</div>
      </div>
    </div>
  );
}
