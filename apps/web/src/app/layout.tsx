import type { Metadata, Viewport } from 'next';
import { Inter, Playfair } from 'next/font/google';
import type { ReactNode } from 'react';

import './rose-tokens.css';
import './globals.css';

// Self-hosted at build time by next/font (AMIVARA_ROSE.md §3.1).
// 'vietnamese' is required for Yoruba/Igbo: ẹ ọ ị ụ and the combining dot
// below (U+0323) are only in that Google Fonts subset; Hausa ɓ ɗ ƙ ƴ and ₦
// are in 'latin-ext'.
// next/font arguments must be literals (they are read at compile time).
const display = Playfair({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  axes: ['opsz', 'wdth'],
  variable: '--font-display',
});
const body = Inter({ subsets: ['latin', 'latin-ext', 'vietnamese'], variable: '--font-body' });

export const metadata: Metadata = {
  title: { default: 'AMIVARA: real connections between verified adults', template: '%s · AMIVARA' },
  description:
    'AMIVARA is an 18+ dating and connection platform for verified adults in Nigeria. Every member is identity-verified, and you only chat when it is mutual.',
  applicationName: 'AMIVARA',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FDFBF7' },
    { media: '(prefers-color-scheme: dark)', color: '#1A0B12' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
