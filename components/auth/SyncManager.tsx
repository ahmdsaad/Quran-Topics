'use client';

import { useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { syncNow } from '@/lib/supabase/sync';
import { getReadingState } from '@/lib/db/repo';
import { useUI } from '@/lib/store';

/** Keeps the offline-first database mirrored whenever an authenticated session exists. */
export default function SyncManager() {
  const showToast = useUI((state) => state.showToast);
  const jumpTo = useUI((state) => state.jumpTo);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let disposed = false;
    let activeUserId: string | null = null;
    let stopActive: (() => void) | undefined;

    const activate = async (user: NonNullable<Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user']>) => {
      if (disposed || activeUserId === user.id) return;
      stopActive?.();
      activeUserId = user.id;
      const run = () => syncNow(user).catch((error) => {
        console.error('[sync]', error);
        showToast('Cloud sync will retry automatically');
      });
      const restoreLatestPage = async () => {
        const before = await getReadingState();
        await run();
        const after = await getReadingState();
        if (after?.page && after.updatedAt !== before?.updatedAt) {
          // Tell the reader that the upcoming scroll came from cloud state.
          // Otherwise its scroll handler treats the programmatic jump as a new
          // local reading action and sends it back, making devices bounce pages
          // between one another indefinitely.
          window.dispatchEvent(new CustomEvent('quran-remote-page-will-apply'));
          jumpTo(after.page);
        }
      };
      await run();
      if (disposed || activeUserId !== user.id) return;
      // Realtime is normally instant. A short visible-app poll is the fallback
      // for mobile WebViews that suspend or silently drop websocket channels.
      const timer = window.setInterval(() => { void restoreLatestPage(); }, 5_000);
      window.addEventListener('online', run);
      window.addEventListener('focus', restoreLatestPage);
      const onReadingStateSaved = () => { void run(); };
      const onSyncRequested = () => { void run(); };
      const onPageHide = () => { void run(); };
      window.addEventListener('quran-reading-state-saved', onReadingStateSaved);
      window.addEventListener('quran-sync-requested', onSyncRequested);
      window.addEventListener('pagehide', onPageHide);
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') void restoreLatestPage();
        else void run();
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      // Supabase was already publishing this table, but without a client
      // subscription other browsers could only discover changes by polling.
      // Realtime invalidates the local mirror immediately in every signed-in
      // device; visibility restore controls when the reader itself navigates.
      const channel = supabase
        .channel(`user-records-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_records',
            filter: `user_id=eq.${user.id}`,
          },
          () => { void restoreLatestPage(); },
        )
        .subscribe();
      stopActive = () => {
        window.clearInterval(timer);
        window.removeEventListener('online', run);
        window.removeEventListener('focus', restoreLatestPage);
        window.removeEventListener('quran-reading-state-saved', onReadingStateSaved);
        window.removeEventListener('quran-sync-requested', onSyncRequested);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        void supabase.removeChannel(channel);
      };
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) void activate(data.session.user);
    });
    const { data: auth } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        stopActive?.();
        activeUserId = null;
        location.reload();
      }
      if (event === 'SIGNED_IN' && session?.user) {
        void activate(session.user);
      }
    });
    return () => {
      disposed = true;
      stopActive?.();
      auth.subscription.unsubscribe();
    };
  }, [jumpTo, showToast]);

  return null;
}
