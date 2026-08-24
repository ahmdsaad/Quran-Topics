import type { Category, Meta, Verse } from '@/lib/types';
import { getNote, getVersesByKeys, orderedVersesInCategory } from '@/lib/db/repo';

interface Row {
  depth: number;
  categoryPath: string;
  categoryName: string;
  verseKey: string;
  surahName: string;
  surahNumber: number;
  ayah: number;
  juz: number;
  page: number;
  arabic: string;
  note: string;
}

/** Walks a category and its descendants, resolving verses and notes in order. */
async function collect(root: Category, all: Category[], meta: Meta) {
  const rows: Row[] = [];
  const sections: { cat: Category; depth: number; path: string; rows: Row[] }[] = [];
  const surahByNumber = new Map(meta.surahs.map((s) => [s.number, s]));

  const walk = async (cat: Category, depth: number, parentPath: string) => {
    const path = parentPath ? `${parentPath} › ${cat.name}` : cat.name;
    const links = await orderedVersesInCategory(cat);
    const verses = await getVersesByKeys(links.map((l) => l.verseKey));
    const byKey = new Map(verses.map((v: Verse) => [v.key, v]));

    const own: Row[] = [];
    for (const link of links) {
      const v = byKey.get(link.verseKey);
      if (!v) continue;
      const note = await getNote(link.verseKey);
      const row: Row = {
        depth,
        categoryPath: path,
        categoryName: cat.name,
        verseKey: v.key,
        surahName: surahByNumber.get(v.surah)?.nameSimple ?? String(v.surah),
        surahNumber: v.surah,
        ayah: v.ayah,
        juz: v.juz,
        page: v.page,
        arabic: v.text,
        note: note && note.deletedAt === null ? note.contentText : '',
      };
      own.push(row);
      rows.push(row);
    }
    sections.push({ cat, depth, path, rows: own });

    for (const child of all.filter((c) => c.parentId === cat.id)) {
      await walk(child, depth + 1, path);
    }
  };

  await walk(root, 0, '');
  return { rows, sections };
}

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const safeName = (s: string) =>
  s.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'category';

// ---------------------------------------------------------------------- Word

export async function exportCategoryDocx(root: Category, all: Category[], meta: Meta) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import('docx');
  const { sections } = await collect(root, all, meta);

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      text: root.name,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Exported ${new Date().toLocaleDateString()} · Quran Classification`,
          size: 18,
          color: '888888',
        }),
      ],
    }),
  ];

  for (const section of sections) {
    if (section.depth > 0 || sections.length > 1) {
      children.push(
        new Paragraph({
          text: section.cat.name,
          heading:
            section.depth === 0
              ? HeadingLevel.HEADING_1
              : section.depth === 1
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 120 },
        })
      );
    }

    if (!section.rows.length) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: 'No verses.', italics: true, size: 20, color: '999999' })],
        })
      );
      continue;
    }

    for (const r of section.rows) {
      children.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { before: 160, after: 40, line: 400 },
          children: [
            new TextRun({ text: r.arabic, rightToLeft: true, size: 30, font: 'Traditional Arabic' }),
          ],
        })
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${r.surahName} ${r.surahNumber}:${r.ayah} · Juz ${r.juz} · Page ${r.page}`,
              size: 18,
              color: '8a6d3b',
            }),
          ],
        })
      );
      if (r.note) {
        children.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            indent: { left: 360 },
            children: [new TextRun({ text: r.note, size: 20, italics: true })],
          })
        );
      }
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  download(blob, `${safeName(root.name)}.docx`);
}

// --------------------------------------------------------------------- Excel

export async function exportCategoryXlsx(root: Category, all: Category[], meta: Meta) {
  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  const { rows } = await collect(root, all, meta);
  const data = rows.length ? rows : [emptyRow(root.name)];

  // write-excel-file v4 replaced `schema` with `columns` and, instead of varying
  // its return type by option, always returns { toBlob, toFile }. The previous
  // call here still used the v3 `schema` shape and was cast to
  // `(...) => Promise<Blob>`, so TypeScript could not see that it now resolves to
  // an object — `URL.createObjectURL` then threw at run time on every export.
  // Keep it typed: the cast is what let this ship broken.
  const header = { fontWeight: 'bold', backgroundColor: '#F3EAD7' } as const;
  const text = (value: string, wrap = false) => ({ value, type: String, wrap });

  const columns = [
    { header: { value: 'Category', ...header }, width: 30, cell: (r: Row) => text(r.categoryPath) },
    { header: { value: 'Surah', ...header }, width: 18, cell: (r: Row) => text(r.surahName) },
    { header: { value: 'Verse', ...header }, width: 10, cell: (r: Row) => text(r.verseKey) },
    { header: { value: 'Ayah', ...header }, width: 8, cell: (r: Row) => ({ value: r.ayah, type: Number }) },
    { header: { value: 'Juz', ...header }, width: 6, cell: (r: Row) => ({ value: r.juz, type: Number }) },
    { header: { value: 'Page', ...header }, width: 7, cell: (r: Row) => ({ value: r.page, type: Number }) },
    { header: { value: 'Arabic', ...header }, width: 60, cell: (r: Row) => ({ ...text(r.arabic, true), align: 'right' as const }) },
    { header: { value: 'Note', ...header }, width: 50, cell: (r: Row) => text(r.note, true) },
  ];

  const blob = await writeXlsxFile(data, { columns, sheet: 'Verses' }).toBlob();
  download(blob, `${safeName(root.name)}.xlsx`);
}

const emptyRow = (name: string): Row => ({
  depth: 0,
  categoryPath: name,
  categoryName: name,
  verseKey: '',
  surahName: '',
  surahNumber: 0,
  ayah: 0,
  juz: 0,
  page: 0,
  arabic: '',
  note: '',
});
