'use client';

import { useEffect } from 'react';

export const OFFLINE_QURAN_VERSION = 'quran-pages-v1';
export const OFFLINE_STATUS_KEY = 'qc.offline-quran-status';

export type OfflineStatus = {
  state: 'idle' | 'downloading' | 'complete' | 'error';
  completed: number;
  total: number;
  message?: string;
  version?: string;
};

export function requestOfflineQuranDownload() {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return;
  void navigator.serviceWorker.ready.then((registration) => {
    (registration.active || navigator.serviceWorker.controller)?.postMessage({
      type: 'DOWNLOAD_COMPLETE_QURAN',
    });
  });
}

export default function OfflineQuranManager() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let retryTimer = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'QURAN_OFFLINE_STATUS') return;
      const status: OfflineStatus = {
        state: event.data.state,
        completed: Number(event.data.completed || 0),
        total: Number(event.data.total || 604),
        message: event.data.message,
        version: OFFLINE_QURAN_VERSION,
      };
      localStorage.setItem(OFFLINE_STATUS_KEY, JSON.stringify(status));
      window.dispatchEvent(new CustomEvent('quran-offline-status', { detail: status }));
    };
    const startIfNeeded = () => {
      let current: OfflineStatus | null = null;
      try { current = JSON.parse(localStorage.getItem(OFFLINE_STATUS_KEY) || 'null'); } catch {}
      if (current?.state === 'complete' && current.version === OFFLINE_QURAN_VERSION) return;
      requestOfflineQuranDownload();
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(async () => {
      try { await navigator.storage?.persist?.(); } catch {}
      retryTimer = window.setTimeout(startIfNeeded, 4_000);
    });
    window.addEventListener('online', startIfNeeded);
    window.addEventListener('quran-request-offline-download', startIfNeeded);
    return () => {
      window.clearTimeout(retryTimer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.removeEventListener('online', startIfNeeded);
      window.removeEventListener('quran-request-offline-download', startIfNeeded);
    };
  }, []);

  return null;
}
