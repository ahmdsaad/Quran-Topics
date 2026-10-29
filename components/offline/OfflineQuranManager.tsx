'use client';

import { useEffect } from 'react';

export const OFFLINE_QURAN_VERSION = 'quran-pages-v1';
export const OFFLINE_STATUS_KEY = 'qc.offline-quran-status';

const PAGE_CACHE = 'quran-pages-v1';
const TOTAL_PAGES = 604;
const DOWNLOAD_CONCURRENCY = 3;

export type OfflineStatus = {
  state: 'idle' | 'downloading' | 'complete' | 'error';
  completed: number;
  total: number;
  message?: string;
  version?: string;
};

let activeDownload: Promise<void> | null = null;

function publishStatus(status: OfflineStatus) {
  localStorage.setItem(OFFLINE_STATUS_KEY, JSON.stringify(status));
  window.dispatchEvent(new CustomEvent('quran-offline-status', { detail: status }));
}

function pageRequest(page: number) {
  return new Request(new URL(`/api/mushaf-page/${page}`, window.location.origin));
}

async function cachePage(cache: Cache, page: number) {
  const request = pageRequest(page);
  if (await cache.match(request)) return;

  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(request, { cache: 'reload' });
      lastStatus = response.status;
      if (response.ok) {
        // Explicitly store the response here. The service worker also understands
        // this cache, but the foreground app must own download progress on mobile.
        await cache.put(request, response.clone());
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, attempt * 700));
  }
  throw new Error(`Page ${page} could not be downloaded${lastStatus ? ` (HTTP ${lastStatus})` : ''}.`);
}

async function downloadInForeground() {
  if (!('caches' in window)) {
    throw new Error('Offline storage is not supported by this browser.');
  }

  try { await navigator.storage?.persist?.(); } catch {}
  const cache = await caches.open(PAGE_CACHE);
  const missing: number[] = [];
  let completed = 0;

  // CacheStorage is the source of truth, so progress survives app restarts.
  for (let page = 1; page <= TOTAL_PAGES; page += 1) {
    if (await cache.match(pageRequest(page))) completed += 1;
    else missing.push(page);
  }

  publishStatus({
    state: completed === TOTAL_PAGES ? 'complete' : 'downloading',
    completed,
    total: TOTAL_PAGES,
    version: OFFLINE_QURAN_VERSION,
  });
  if (!missing.length) return;

  let cursor = 0;
  const failed: string[] = [];
  const worker = async () => {
    while (cursor < missing.length) {
      const page = missing[cursor++];
      try {
        await cachePage(cache, page);
        completed += 1;
        publishStatus({
          state: 'downloading',
          completed,
          total: TOTAL_PAGES,
          version: OFFLINE_QURAN_VERSION,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          throw new Error('This device has run out of browser storage. Free some storage, then tap Resume download.');
        }
        failed.push(error instanceof Error ? error.message : `Page ${page} could not be downloaded.`);
      }
    }
  };

  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, () => worker()));
  if (failed.length) {
    throw new Error(`${completed} of ${TOTAL_PAGES} pages saved. ${failed[0]} Tap Resume to retry the remaining pages.`);
  }
  publishStatus({
    state: 'complete',
    completed: TOTAL_PAGES,
    total: TOTAL_PAGES,
    version: OFFLINE_QURAN_VERSION,
  });
}

export function requestOfflineQuranDownload() {
  if (!navigator.onLine) {
    publishStatus({
      state: 'error',
      completed: 0,
      total: TOTAL_PAGES,
      version: OFFLINE_QURAN_VERSION,
      message: 'Connect to the internet, then tap Resume download.',
    });
    return;
  }
  if (activeDownload) return;

  publishStatus({
    state: 'downloading',
    completed: 0,
    total: TOTAL_PAGES,
    version: OFFLINE_QURAN_VERSION,
  });
  activeDownload = downloadInForeground()
    .catch((error) => {
      let current: OfflineStatus | null = null;
      try { current = JSON.parse(localStorage.getItem(OFFLINE_STATUS_KEY) || 'null'); } catch {}
      publishStatus({
        state: 'error',
        completed: current?.completed || 0,
        total: TOTAL_PAGES,
        version: OFFLINE_QURAN_VERSION,
        message: error instanceof Error ? error.message : 'Offline download was interrupted.',
      });
    })
    .finally(() => { activeDownload = null; });
}

export default function OfflineQuranManager() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let retryTimer = 0;
    const startIfNeeded = () => {
      let current: OfflineStatus | null = null;
      try { current = JSON.parse(localStorage.getItem(OFFLINE_STATUS_KEY) || 'null'); } catch {}
      if (current?.state === 'complete' && current.version === OFFLINE_QURAN_VERSION) return;
      requestOfflineQuranDownload();
    };

    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(() => {
      retryTimer = window.setTimeout(startIfNeeded, 1_000);
    });
    window.addEventListener('online', startIfNeeded);
    window.addEventListener('quran-request-offline-download', startIfNeeded);
    return () => {
      window.clearTimeout(retryTimer);
      window.removeEventListener('online', startIfNeeded);
      window.removeEventListener('quran-request-offline-download', startIfNeeded);
    };
  }, []);

  return null;
}
