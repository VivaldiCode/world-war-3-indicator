import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cinzel"', 'serif'],
        body: ['"IM Fell English"', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        parchment: {
          DEFAULT: '#e8d9b0',
          dark: '#c9b489',
          deeper: '#a48d5e',
        },
        ink: {
          DEFAULT: '#2b1d10',
          soft: '#4a3522',
        },
        war: {
          green: '#3b6e3a',
          yellow: '#d4a843',
          red: '#a8331a',
          blood: '#6b1d10',
        },
        risk: {
          'north-america': '#d4a843',
          'south-america': '#3b6e3a',
          europe: '#1f5d8a',
          africa: '#a8331a',
          asia: '#6b1d10',
          oceania: '#7a4ea3',
        },
      },
      boxShadow: {
        'parchment': 'inset 0 0 80px rgba(75, 50, 20, 0.35), 0 0 0 1px rgba(75, 50, 20, 0.25)',
        'stamp': '0 0 0 2px #6b1d10, 0 0 0 3px #e8d9b0, 0 0 0 4px #6b1d10',
      },
      backgroundImage: {
        'parchment-tex': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.6 0 0 0 0 0.45 0 0 0 0 0.2 0 0 0 0.12 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};

export default config;
