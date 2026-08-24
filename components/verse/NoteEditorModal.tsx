'use client';

import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Youtube from '@tiptap/extension-youtube';
import type { Meta, Verse } from '@/lib/types';
import { deleteNote, getNote, getVerseByKey, saveNote } from '@/lib/db/repo';
import { useUI } from '@/lib/store';

export default function NoteEditorModal({ meta }: { meta: Meta }) {
  const { noteVerse, closeNote, showToast } = useUI();
  const [verse, setVerse] = useState<Verse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // StarterKit v3 bundles Link, so configure it there — registering the
      // extension separately triggers a duplicate-name warning and can drop marks.
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Youtube.configure({ controls: true, nocookie: true, width: 560, height: 315 }),
    ],
    editorProps: {
      attributes: { class: 'tiptap', 'aria-label': 'Note content' },
    },
    onUpdate: () => setDirty(true),
  });

  useEffect(() => {
    if (!noteVerse || !editor) return;
    let live = true;
    setLoaded(false);
    setDirty(false);
    Promise.all([getVerseByKey(noteVerse), getNote(noteVerse)]).then(([v, n]) => {
      if (!live) return;
      setVerse(v ?? null);
      const content = n && n.deletedAt === null ? n.contentJson : null;
      editor.commands.setContent((content as never) ?? '');
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [noteVerse, editor]);

  if (!noteVerse) return null;
  const surah = verse ? meta.surahs.find((s) => s.number === verse.surah) : null;

  const save = async () => {
    if (!editor) return;
    const text = editor.getText().trim();
    if (!text && editor.isEmpty) {
      await deleteNote(noteVerse);
      showToast('Note removed');
    } else {
      await saveNote(noteVerse, editor.getJSON(), text);
      showToast('Note saved');
    }
    closeNote();
  };

  const addYoutube = () => {
    const url = prompt('YouTube URL');
    if (!url) return;
    editor?.commands.setYoutubeVideo({ src: url });
  };

  const addLink = () => {
    const prev = editor?.getAttributes('link').href as string | undefined;
    const url = prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor?.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / 0.4)' }}
        onClick={() => (dirty ? confirm('Discard unsaved changes?') && closeNote() : closeNote())}
      />
      <div className="panel relative flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden">
        <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                Note on {surah?.nameSimple} {verse?.ayah}
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                Juz {verse?.juz} · Page {verse?.page} · {noteVerse}
              </p>
            </div>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={closeNote}>
              ✕
            </button>
          </div>
          {verse ? (
            <p
              dir="rtl"
              className="mt-2 max-h-20 overflow-y-auto text-[15px] leading-loose"
              style={{ fontFamily: "'Scheherazade New', serif", color: 'var(--ink-soft)' }}
            >
              {verse.text}
            </p>
          ) : null}
        </header>

        <div
          className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1.5"
          style={{ borderColor: 'var(--border)' }}
        >
          <Tool active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <b>B</b>
          </Tool>
          <Tool active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <i>I</i>
          </Tool>
          <Tool
            active={editor?.isActive('heading', { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H
          </Tool>
          <Tool active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            •
          </Tool>
          <Tool
            active={editor?.isActive('orderedList')}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            1.
          </Tool>
          <Tool active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
            ❝
          </Tool>
          <span className="mx-1 w-px" style={{ background: 'var(--border)' }} />
          <Tool active={editor?.isActive('link')} onClick={addLink}>
            🔗 Link
          </Tool>
          <Tool onClick={addYoutube}>▶ YouTube</Tool>
        </div>

        <div className="scroll-y flex-1 p-4">
          {loaded ? (
            <EditorContent editor={editor} />
          ) : (
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              Loading…
            </p>
          )}
        </div>

        <footer
          className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            className="btn btn-ghost text-xs"
            style={{ color: '#b4483f' }}
            onClick={async () => {
              if (!confirm('Delete this note?')) return;
              await deleteNote(noteVerse);
              showToast('Note removed');
              closeNote();
            }}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button className="btn" onClick={closeNote}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save}>
              Save note
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Tool({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost min-h-8 px-2 py-1 text-xs"
      style={active ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
