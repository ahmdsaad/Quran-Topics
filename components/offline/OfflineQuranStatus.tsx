'use client';

import { useEffect, useState } from 'react';
import {
  OFFLINE_QURAN_VERSION,
  OFFLINE_STATUS_KEY,
  requestOfflineQuranDownload,
  type OfflineStatus,
} from './OfflineQuranManager';

const initialStatus: OfflineStatus = { state: 'idle', completed: 0, total: 604 };

export default function OfflineQuranStatus() {
  const [status, setStatus] = useState<OfflineStatus>(initialStatus);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(OFFLINE_STATUS_KEY) || 'null') as OfflineStatus | null;
      if (stored) setStatus(stored);
    } catch {}
    const update = (event: Event) => setStatus((event as CustomEvent<OfflineStatus>).detail);
    window.addEventListener('quran-offline-status', update);
    return () => window.removeEventListener('quran-offline-status', update);
  }, []);

  const complete = status.state === 'complete' && status.version === OFFLINE_QURAN_VERSION;
  const progress = Math.round((status.completed / Math.max(1, status.total)) * 100);

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
        Offline Quran
      </h3>
      <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
        {complete
          ? 'All 604 Quran pages and translations are saved on this device and can be read without internet.'
          : status.state === 'downloading'
            ? `Downloading the complete Quran… ${status.completed} of ${status.total} pages (${progress}%). You can keep using the app.`
            : status.state === 'error'
              ? status.message || 'The offline download was interrupted. Tap Resume when connected.'
              : 'Download all 604 page-perfect Quran pages for reading without internet. This is a large one-time download.'}
      </p>
      {status.state === 'downloading' && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full transition-[width]" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
      )}
      <button
        className="btn"
        disabled={status.state === 'downloading'}
        onClick={() => {
          requestOfflineQuranDownload();
          window.dispatchEvent(new Event('quran-request-offline-download'));
        }}
      >
        {complete ? 'Downloaded' : status.state === 'error' ? 'Resume download' : status.state === 'downloading' ? 'Downloading…' : 'Download complete Quran'}
      </button>
    </section>
  );
}
