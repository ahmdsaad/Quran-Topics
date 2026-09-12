import type { Category, Meta, Verse } from '@/lib/types';
import { getNote, getVersesByKeys, orderedVersesInCategory } from '@/lib/db/repo';
import { categoryTitles } from '@/lib/categories/titles';

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

/** Walks category roots and their descendants, resolving verses and notes in order. */
async function collectRoots(roots: Category[], all: Category[], meta: Meta) {
  const rows: Row[] = [];
  const sections: { cat: Category; depth: number; path: string; rows: Row[] }[] = [];
  const surahByNumber = new Map(meta.surahs.map((s) => [s.number, s]));

  const walk = async (cat: Category, depth: number, parentPath: string) => {
    const title = categoryTitles(cat).combined;
    const path = parentPath ? `${parentPath} › ${title}` : title;
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
        categoryName: title,
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

  for (const root of roots) await walk(root, 0, '');
  return { rows, sections };
}

const collect = (root: Category, all: Category[], meta: Meta) =>
  collectRoots([root], all, meta);

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
  s.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'topic';

// ---------------------------------------------------------------------- Word

export async function exportCategoryDocx(root: Category, all: Category[], meta: Meta) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import('docx');
  const { sections } = await collect(root, all, meta);

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      text: categoryTitles(root).combined,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.RIGHT,
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
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
          text: categoryTitles(section.cat).combined,
          heading:
            section.depth === 0
              ? HeadingLevel.HEADING_1
              : section.depth === 1
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 120 },
          alignment: AlignmentType.RIGHT,
        })
      );
    }

    if (!section.rows.length) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
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
          alignment: AlignmentType.RIGHT,
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
            alignment: AlignmentType.RIGHT,
            spacing: { before: 60, after: 60 },
            indent: { right: 360 },
            children: [new TextRun({ text: r.note, size: 20, italics: true })],
          })
        );
      }
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  download(blob, `${safeName(categoryTitles(root).combined)}.docx`);
}

export async function exportAllCategoriesDocx(all: Category[], meta: Meta) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import('docx');
  const roots = all.filter((category) => category.parentId === null);
  const { sections } = await collectRoots(roots, all, meta);
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      text: 'Quran Topics',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.RIGHT,
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: `All topics · Exported ${new Date().toLocaleDateString()}`,
          size: 18,
          color: '888888',
        }),
      ],
    }),
  ];

  if (!sections.length) {
    children.push(new Paragraph({ text: 'No topics.', alignment: AlignmentType.RIGHT }));
  }
  for (const section of sections) {
    children.push(
      new Paragraph({
        text: section.path,
        heading:
          section.depth === 0
            ? HeadingLevel.HEADING_1
            : section.depth === 1
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
        spacing: { before: 300, after: 120 },
        alignment: AlignmentType.RIGHT,
      })
    );
    if (!section.rows.length) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'No verses.', italics: true, size: 20, color: '999999' })],
        })
      );
      continue;
    }
    for (const row of section.rows) {
      children.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { before: 160, after: 40, line: 400 },
          children: [
            new TextRun({ text: row.arabic, rightToLeft: true, size: 30, font: 'Traditional Arabic' }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              text: `${row.surahName} ${row.surahNumber}:${row.ayah} · Juz ${row.juz} · Page ${row.page}`,
              size: 18,
              color: '8a6d3b',
            }),
          ],
        })
      );
      if (row.note) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 60, after: 60 },
            indent: { right: 360 },
            children: [new TextRun({ text: row.note, size: 20, italics: true })],
          })
        );
      }
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  download(await Packer.toBlob(doc), 'Quran-Topics.docx');
}

// --------------------------------------------------------------------- Excel

export async function exportCategoryXlsx(root: Category, all: Category[], meta: Meta) {
  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  const { rows } = await collect(root, all, meta);
  const data = rows.length ? rows : [emptyRow(categoryTitles(root).combined)];

  // write-excel-file v4 replaced `schema` with `columns` and, instead of varying
  // its return type by option, always returns { toBlob, toFile }. The previous
  // call here still used the v3 `schema` shape and was cast to
  // `(...) => Promise<Blob>`, so TypeScript could not see that it now resolves to
  // an object — `URL.createObjectURL` then threw at run time on every export.
  // Keep it typed: the cast is what let this ship broken.
  const header = { fontWeight: 'bold', backgroundColor: '#F3EAD7' } as const;
  const text = (value: string, wrap = false) => ({ value, type: String, wrap });

  const columns = [
    { header: { value: 'Topic', ...header }, width: 30, cell: (r: Row) => text(r.categoryPath) },
    { header: { value: 'Surah', ...header }, width: 18, cell: (r: Row) => text(r.surahName) },
    { header: { value: 'Verse', ...header }, width: 10, cell: (r: Row) => text(r.verseKey) },
    { header: { value: 'Ayah', ...header }, width: 8, cell: (r: Row) => ({ value: r.ayah, type: Number }) },
    { header: { value: 'Juz', ...header }, width: 6, cell: (r: Row) => ({ value: r.juz, type: Number }) },
    { header: { value: 'Page', ...header }, width: 7, cell: (r: Row) => ({ value: r.page, type: Number }) },
    { header: { value: 'Arabic', ...header }, width: 60, cell: (r: Row) => ({ ...text(r.arabic, true), align: 'right' as const }) },
    { header: { value: 'Note', ...header }, width: 50, cell: (r: Row) => text(r.note, true) },
  ];

  const blob = await writeXlsxFile(data, { columns, sheet: 'Verses' }).toBlob();
  download(blob, `${safeName(categoryTitles(root).combined)}.xlsx`);
}

export async function exportAllCategoriesXlsx(all: Category[], meta: Meta) {
  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  const roots = all.filter((category) => category.parentId === null);
  const { rows } = await collectRoots(roots, all, meta);
  const data = rows.length ? rows : [emptyRow('No topics')];
  const header = { fontWeight: 'bold', backgroundColor: '#F3EAD7' } as const;
  const text = (value: string, wrap = false) => ({ value, type: String, wrap });
  const columns = [
    { header: { value: 'Topic', ...header }, width: 35, cell: (row: Row) => text(row.categoryPath) },
    { header: { value: 'Surah', ...header }, width: 18, cell: (row: Row) => text(row.surahName) },
    { header: { value: 'Verse', ...header }, width: 10, cell: (row: Row) => text(row.verseKey) },
    { header: { value: 'Ayah', ...header }, width: 8, cell: (row: Row) => ({ value: row.ayah, type: Number }) },
    { header: { value: 'Juz', ...header }, width: 6, cell: (row: Row) => ({ value: row.juz, type: Number }) },
    { header: { value: 'Page', ...header }, width: 7, cell: (row: Row) => ({ value: row.page, type: Number }) },
    { header: { value: 'Arabic', ...header }, width: 60, cell: (row: Row) => ({ ...text(row.arabic, true), align: 'right' as const }) },
    { header: { value: 'Note', ...header }, width: 50, cell: (row: Row) => text(row.note, true) },
  ];
  const blob = await writeXlsxFile(data, { columns, sheet: 'All Topics' }).toBlob();
  download(blob, 'Quran-Topics.xlsx');
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
