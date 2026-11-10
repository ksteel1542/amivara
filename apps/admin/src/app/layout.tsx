import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './rose-tokens.css';
import './globals.css';

const display = Playfair_Display({ subsets: ['latin'], weight: ['600'], variable: '--font-display' });
const body = Inter({ subsets: ['latin'], variable: '--font-body' });

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
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
