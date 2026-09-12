'use client';

import { useCallback, useEffect, useRef } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { syncNow } from '@/lib/supabase/sync';
import { useUI } from '@/lib/store';

const CHECK_INTERVAL_MS = 30_000;

/** Reloads an open browser/PWA when the production alias moves to a new build. */
export default function AutoUpdate({ currentPage }: { currentPage: number }) {
  const reloading = useRef(false);
  const showToast = useUI((state) => state.showToast);

  const checkForUpdate = useCallback(async () => {
    if (reloading.current || document.visibilityState === 'hidden') return;
    try {
      const response = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const { version } = await response.json() as { version?: string };
      const current = process.env.NEXT_PUBLIC_APP_VERSION;
      if (!version || !current || version === current) return;

      reloading.current = true;
      showToast('A new version is available. Updating…');
      window.dispatchEvent(new CustomEvent('quran-before-auto-refresh'));
      // Give IndexedDB time to commit the final page state, then drain the
      // resulting outbox before replacing this build.
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session?.user) await syncNow(data.session.user);
        } catch (syncError) {
          // The page state is safely in IndexedDB/outbox even if the device is
          // temporarily offline; the new build will retry that upload on boot.
          console.error('[sync before auto update]', syncError);
        }
      }
      // A normal reload can reuse an installed mobile app's cached HTML and
      // start an endless old-build/new-endpoint loop. A versioned navigation
      // forces a fresh document request. Carry the visible page in the URL as
      // a synchronous hand-off: mobile browsers can suspend IndexedDB/cloud
      // writes during navigation, but the next build can always restore this.
      const freshUrl = new URL('/', location.origin);
      freshUrl.searchParams.set('appVersion', version);
      freshUrl.searchParams.set('page', String(currentPage));
      location.replace(freshUrl.toString());
    } catch (error) {
      reloading.current = false;
      console.error('[auto update]', error);
    }
  }, [currentPage, showToast]);

  useEffect(() => {
    const timer = window.setInterval(() => { void checkForUpdate(); }, CHECK_INTERVAL_MS);
    const onFocus = () => { void checkForUpdate(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    // Check once shortly after boot without competing with initial data sync.
    const initial = window.setTimeout(() => { void checkForUpdate(); }, 3_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checkForUpdate]);

  return null;
}
