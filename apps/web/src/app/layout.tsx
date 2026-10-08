import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';
import { plex } from '@/lib/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'kafka-pay-lab', template: '%s · kafka-pay-lab' },
  description: 'Kafka payments lab: producer, consumer, consumer lag and a circuit breaker.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={plex.variable}>
      <body className="min-h-screen font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
