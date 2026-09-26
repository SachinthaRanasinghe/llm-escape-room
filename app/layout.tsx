import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'LLM Escape Room',
  description: 'Two models race through an identical, freshly generated escape room.',
};

export const viewport: Viewport = {
  themeColor: '#07080b',
};

/**
 * `app/globals.css` holds the design tokens and page background only; every
 * component's styles stay module-scoped beside it. The system font stack means
 * there is no font download and no provider here.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
