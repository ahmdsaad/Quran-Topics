'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

type GoogleCredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: {
            type?: 'standard' | 'icon';
            theme?: 'outline' | 'filled_blue' | 'filled_black';
            size?: 'large' | 'medium' | 'small';
            text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
            shape?: 'rectangular' | 'pill' | 'circle' | 'square';
            width?: number;
          }) => void;
        };
      };
    };
  }
}

let googleScript: Promise<void> | null = null;

function loadGoogleIdentity() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (googleScript) return googleScript;
  googleScript = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    const script = existing ?? document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
    if (!existing) document.head.appendChild(script);
  });
  return googleScript;
}

export default function AccountButton({ compact = false }: { compact?: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLoading(false); return; }
    const params = new URLSearchParams(location.search);
    const callbackError = params.get('error_description') ?? params.get('error');
    if (callbackError) setAuthError(callbackError);
    supabase.auth.getSession()
      .then(({ data, error }) => {
        setUser(data.session?.user ?? null);
        if (error) setAuthError(error.message);
      })
      .catch(() => setAuthError('Could not check the login session.'))
      .finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        setAuthError(null);
        const clean = new URL(location.href);
        ['code', 'error', 'error_code', 'error_description', 'sb_flow_id'].forEach((key) => {
          clean.searchParams.delete(key);
        });
        history.replaceState(history.state, '', `${clean.pathname}${clean.search}${clean.hash}`);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (!configured || loading || user || !googleButtonRef.current) return;
    let active = true;
    const parent = googleButtonRef.current;
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      setAuthError('Google sign-in is not configured.');
      return;
    }
    void loadGoogleIdentity().then(() => {
      if (!active || !window.google?.accounts.id) return;
      parent.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: false,
        callback: (response) => {
          if (!response.credential) {
            setAuthError('Google did not return a login credential.');
            return;
          }
          setAuthError(null);
          const supabase = getSupabaseBrowserClient();
          if (!supabase) {
            setAuthError('Cloud login is not configured.');
            return;
          }
          void supabase.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
          }).then(({ data, error }) => {
            if (!active) return;
            if (error) {
              console.error('[auth] Google ID-token sign-in failed', error);
              setAuthError(error.message);
              return;
            }
            setUser(data.user);
          }).catch((error: unknown) => {
            if (!active) return;
            console.error('[auth] Google sign-in failed', error);
            setAuthError(error instanceof Error ? error.message : 'Google sign-in failed.');
          });
        },
      });
      window.google.accounts.id.renderButton(parent, compact ? {
        type: 'icon',
        theme: 'outline',
        size: 'medium',
        shape: 'circle',
      } : {
        type: 'standard',
        theme: 'outline',
        size: 'medium',
        text: 'signin_with',
        shape: 'pill',
        width: 112,
      });
    }).catch((error: unknown) => {
      if (!active) return;
      console.error('[auth] Google Identity Services failed to load', error);
      setAuthError(error instanceof Error ? error.message : 'Could not load Google sign-in.');
    });
    return () => { active = false; };
  }, [configured, loading, user, compact]);

  if (!configured) {
    return <button className="btn btn-ghost px-2 text-xs" disabled title="Add Supabase environment variables to enable Google login">{compact ? <GoogleMark /> : 'Google login'}</button>;
  }
  if (!user) {
    return (
      <div className="relative">
        {loading ? (
          <button className="btn px-2 text-xs" disabled><GoogleMark />{compact ? null : 'Checking…'}</button>
        ) : (
          <div ref={googleButtonRef} className={compact
            ? 'h-8 w-10 overflow-hidden rounded-full'
            : 'h-8 min-w-28 overflow-hidden rounded-full'} title="Sign in with Google" />
        )}
        {authError ? (
          <div className="absolute end-0 top-full z-[90] mt-1 w-64 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 shadow-lg">
            {authError}
          </div>
        ) : null}
      </div>
    );
  }

  const avatar = user.user_metadata.avatar_url as string | undefined;
  const name = (user.user_metadata.full_name as string | undefined) || user.email || 'Account';
  return (
    <div className="relative" ref={menuRef}>
      <button className="btn btn-ghost h-8 min-h-0 gap-1.5 px-1.5" onClick={() => setOpen((value) => !value)}>
        {avatar ? <img src={avatar} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" /> : <GoogleMark />}
        <span className="hidden max-w-28 truncate text-xs lg:block">{name}</span>
      </button>
      {open ? (
        <div className="panel absolute end-0 top-full z-[80] mt-1 w-60 p-2 shadow-xl">
          <p className="truncate px-2 py-1 text-xs font-medium">{name}</p>
          <p className="truncate px-2 pb-2 text-[11px]" style={{ color: 'var(--ink-soft)' }}>{user.email}</p>
          <button className="btn btn-ghost w-full justify-start text-xs" onClick={async () => {
            await getSupabaseBrowserClient()?.auth.signOut();
            setOpen(false);
          }}>Sign out</button>
        </div>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
      <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34a853" d="M12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.54c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.05v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.39 13.86A6 6 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.48l3.34-2.62Z" />
      <path fill="#ea4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.95 5.52l3.34 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
    </svg>
  );
}
