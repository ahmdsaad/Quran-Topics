/* Complete offline Quran cache. Keep page cache stable: these 604 SVG pages are immutable. */
const SHELL_CACHE = 'quran-shell-v1';
const DATA_CACHE = 'quran-data-v8';
const PAGE_CACHE = 'quran-pages-v1';
const TOTAL_PAGES = 604;
const CORE_DATA = [
  '/data/meta.json',
  '/data/verses.json',
  '/data/translations/en.json',
  '/data/translations/en-sarwar.json',
  '/data/translations/en-wahiduddin.json',
  '/data/translations/ru.json',
  '/data/translations/it.json',
  '/data/translations/fr.json',
  '/data/translations/es.json',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      if (name === PAGE_CACHE || name === SHELL_CACHE || name === DATA_CACHE) return undefined;
      if (!name.startsWith('quran-')) return undefined;
      return caches.delete(name);
    }));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match('/')) || new Response('Quran is not downloaded for offline use yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function mushafPage(page) {
  const key = new Request(`/api/mushaf-page/${page}`);
  const cache = await caches.open(PAGE_CACHE);
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const response = await fetch(key);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    return new Response(`Quran page ${page} is not available offline yet.`, {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api/version') return;

  const apiPage = url.pathname.match(/^\/api\/mushaf-page\/(\d+)$/);
  const staticPage = url.pathname.match(/^\/mushaf-svg\/(\d{3})\.svg$/);
  if (apiPage || staticPage) {
    const page = Number((apiPage || staticPage)[1]);
    event.respondWith(mushafPage(page));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
  if (url.pathname.startsWith('/data/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/icon.svg') {
    event.respondWith(cacheFirst(request, DATA_CACHE));
  }
});

async function notify(payload) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: 'QURAN_OFFLINE_STATUS', ...payload }));
}

async function cacheShellAndData() {
  const shell = await caches.open(SHELL_CACHE);
  const response = await fetch('/', { cache: 'reload' });
  if (!response.ok) throw new Error('Could not download the app for offline use.');
  await shell.put('/', response.clone());
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/_next/static/'));
  await Promise.all([...new Set(assets)].map(async (path) => {
    const asset = await fetch(path);
    if (asset.ok) await shell.put(path, asset);
  }));

  const data = await caches.open(DATA_CACHE);
  await Promise.all(CORE_DATA.map(async (path) => {
    const item = await fetch(path, { cache: 'reload' });
    if (!item.ok) throw new Error(`Could not download ${path}.`);
    await data.put(path, item);
  }));
}

let downloadPromise = null;
async function downloadCompleteQuran() {
  if (downloadPromise) return downloadPromise;
  downloadPromise = (async () => {
    try {
      await notify({ state: 'downloading', completed: 0, total: TOTAL_PAGES });
      await cacheShellAndData();
      const cache = await caches.open(PAGE_CACHE);
      let completed = 0;
      const pages = Array.from({ length: TOTAL_PAGES }, (_, index) => index + 1);
      let cursor = 0;
      const worker = async () => {
        while (cursor < pages.length) {
          const page = pages[cursor++];
          const key = new Request(`/api/mushaf-page/${page}`);
          if (!await cache.match(key)) {
            let response = null;
            for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
              try {
                const candidate = await fetch(key, { cache: 'reload' });
                if (candidate.ok) response = candidate;
              } catch {}
              if (!response) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
            }
            if (!response) throw new Error(`Could not download Quran page ${page}.`);
            await cache.put(key, response);
          }
          completed += 1;
          if (completed === TOTAL_PAGES || completed % 4 === 0) {
            await notify({ state: 'downloading', completed, total: TOTAL_PAGES });
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      await notify({ state: 'complete', completed: TOTAL_PAGES, total: TOTAL_PAGES });
    } catch (error) {
      await notify({
        state: 'error',
        completed: 0,
        total: TOTAL_PAGES,
        message: error instanceof Error ? error.message : 'Offline download was interrupted.',
      });
    } finally {
      downloadPromise = null;
    }
  })();
  return downloadPromise;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'DOWNLOAD_COMPLETE_QURAN') {
    event.waitUntil(downloadCompleteQuran());
  }
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
