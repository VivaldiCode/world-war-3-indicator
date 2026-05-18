import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WW3 Indicator — Probability of the Next Great Global Conflict',
  description:
    'A modular, data-driven indicator (0–100) of how close the world is to a global conflict. Inspired by the board game RISK.',
  openGraph: {
    title: 'WW3 Indicator',
    description: 'Real-time, weighted composite of conflict, market, sentiment, and military signals.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
