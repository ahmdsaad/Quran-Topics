'use client';

import { useUI } from '@/lib/store';

export default function Toast() {
  const toast = useUI((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
      role="status"
      aria-live="polite"
    >
      <div
        className="rounded-full px-4 py-2 text-sm shadow-lg"
        style={{ background: 'var(--ink)', color: 'var(--paper)' }}
      >
        {toast}
      </div>
    </div>
  );
}
