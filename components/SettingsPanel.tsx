'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/db/schema';
import { exportAll, importAll, outboxSize, rebuildMarkers, saveSettings } from '@/lib/db/repo';
import { useUI } from '@/lib/store';

const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
] as const;

export default function SettingsPanel({
  scale,
  onScale,
  onClose,
}: {
  scale: number;
  onScale: (v: number) => void;
  onClose: () => void;
}) {
  const showToast = useUI((s) => s.showToast);
  const [theme, setTheme] = useState<string>('light');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'light');
    outboxSize().then(setPending);
  }, []);

  const applyTheme = (t: string) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('qc.theme', t);
    } catch {}
    void saveSettings({ theme: t as 'light' | 'dark' | 'sepia' });
  };

  const doExport = async () => {
    const dump = await exportAll();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quran-classification-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Backup downloaded');
  };

  const doImport = async (file: File) => {
    try {
      const dump = JSON.parse(await file.text());
      await importAll(dump);
      showToast('Backup restored');
    } catch {
      showToast('That file could not be read');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Settings" onClose={onClose} />
      <div className="scroll-y flex-1 space-y-6 p-4">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
            Appearance
          </h3>
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className="btn flex-1"
                style={
                  theme === t.id
                    ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                    : undefined
                }
                onClick={() => applyTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
            Text size
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>A</span>
            <input
              type="range"
              min={0.8}
              max={1.35}
              step={0.05}
              value={scale}
              onChange={(e) => {
                const v = Number(e.target.value);
                onScale(v);
                void saveSettings({ pageScale: v });
              }}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="text-lg" style={{ color: 'var(--ink-soft)' }}>A</span>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
            Your data
          </h3>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            Everything you write lives on this device only — there is no account yet. Take a backup
            before clearing your browser data or switching devices.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={doExport}>Download backup</button>
            <label className="btn cursor-pointer">
              Restore backup
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void doImport(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
            {pending} change{pending === 1 ? '' : 's'} queued for sync when accounts arrive.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
            Maintenance
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn"
              onClick={async () => {
                await rebuildMarkers();
                showToast('Verse markers rebuilt');
              }}
            >
              Rebuild markers
            </button>
            <button
              className="btn"
              onClick={async () => {
                if (!confirm('Delete all local data on this device? Take a backup first.')) return;
                await db().delete();
                location.reload();
              }}
              style={{ color: '#b4483f' }}
            >
              Erase local data
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export function PanelHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <header
      className="flex shrink-0 items-center justify-between border-b px-4 py-3"
      style={{ borderColor: 'var(--border)' }}
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {onClose ? (
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      ) : null}
    </header>
  );
}
