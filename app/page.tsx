'use client';

import dynamic from 'next/dynamic';

// The whole app is client-side: it reads IndexedDB and the FontFace API, neither
// of which exist during SSR. One dynamic boundary keeps that out of the server
// bundle instead of scattering `typeof window` checks through the tree.
const App = dynamic(() => import('@/components/App'), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center" style={{ background: 'var(--surface-2)' }}>
      <div className="text-center">
        <div
          className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-transparent"
          style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)' }}
        />
        <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>Loading…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <App />;
}
