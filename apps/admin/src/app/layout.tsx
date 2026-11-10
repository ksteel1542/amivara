import type { Metadata } from 'next';
import { Inter, Playfair } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './rose-tokens.css';
import './globals.css';

// Moderators read member names in Yoruba, Igbo and Hausa: same subsets as the public web app.
// next/font arguments must be literals (they are read at compile time).
const display = Playfair({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  axes: ['opsz', 'wdth'],
  variable: '--font-display',
});
const body = Inter({ subsets: ['latin', 'latin-ext', 'vietnamese'], variable: '--font-body' });

export const metadata: Metadata = {
  title: { default: 'AMIVARA Admin', template: '%s · AMIVARA Admin' },
  robots: { index: false, follow: false, nocache: true },
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/reports', label: 'Reports' },
  { href: '/verification-reviews', label: 'Verification reviews' },
  { href: '/photos', label: 'Photo moderation' },
  { href: '/members', label: 'Member lookup' },
  { href: '/audit-log', label: 'Audit log' },
] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" className={`${display.variable} ${body.variable}`}>
      <body>
        <div className="shell">
          <nav className="sidebar" aria-label="Admin">
            <div className="brand">
              AMIVARA <span>Admin</span>
            </div>
            <ul>
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
            <form action="/auth/logout" method="post" className="signout">
              <button type="submit">Sign out</button>
            </form>
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
