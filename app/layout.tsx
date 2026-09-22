import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'LLM Escape Room',
  description: 'Two models race through an identical, freshly generated escape room.',
};

/**
 * Intentionally bare. TICKET-8 (#5) owns the replay route and brings its own
 * scene, so nothing here should grow a styling system, font loading or
 * providers before that ticket decides what it needs.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
