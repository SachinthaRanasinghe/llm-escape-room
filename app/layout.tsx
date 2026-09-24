import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'LLM Escape Room',
  description: 'Two models race through an identical, freshly generated escape room.',
};

/**
 * Intentionally bare. TICKET-8 (#5) decided against a global styling system:
 * the replay's styles are module-scoped in `components/scene/replay.module.css`
 * and it uses the system font stack, so there is no font loading and no
 * provider here. Only the default body margin goes, so the stage is full-bleed.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
