'use client';

import { fetchPage } from '@/lib/db/bootstrap';
import { fontFamily, glyphOf, loadPageFont } from '@/lib/mushaf/fonts';
import type { PageDoc } from '@/lib/types';

type VerseImageVerse = {
  arabic: string;
  translation: string;
  page: number;
  verseKey: string;
};

type VerseImageInput = {
  verses: VerseImageVerse[];
  arabicReference: string;
  translationReference: string;
  filename: string;
};

type TextRun = {
  text: string;
  family: string;
};

type TextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  family: string;
  weight: string;
  maxSize: number;
  minSize: number;
  lineHeight: number;
  direction: CanvasDirection;
  color: string;
};

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create image'))),
      type,
      quality,
    );
  });

function wrappedLines(context: CanvasRenderingContext2D, text: string, width: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawFittedRuns(context: CanvasRenderingContext2D, runs: TextRun[], box: TextBox) {
  let size = box.maxSize;
  let laidOut: Array<{ family: string; lines: string[] }> = [];
  let contentHeight = 0;
  while (size >= box.minSize) {
    laidOut = runs.map((run) => {
      context.font = `${box.weight} ${size}px ${run.family}`;
      return { family: run.family, lines: wrappedLines(context, run.text, box.width) };
    });
    const lineCount = laidOut.reduce((total, run) => total + run.lines.length, 0);
    const gaps = Math.max(0, laidOut.length - 1) * size * 0.55;
    contentHeight = lineCount * size * box.lineHeight + gaps;
    if (contentHeight <= box.height) break;
    size -= 2;
  }

  context.save();
  context.direction = box.direction;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = box.color;
  const step = size * box.lineHeight;
  let y = box.y + (box.height - contentHeight) / 2 + step / 2;
  laidOut.forEach((run, runIndex) => {
    context.font = `${box.weight} ${size}px ${run.family}`;
    run.lines.forEach((line) => {
      context.fillText(line, box.x + box.width / 2, y);
      y += step;
    });
    if (runIndex < laidOut.length - 1) y += size * 0.55;
  });
  context.restore();
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Creates a presentation-ready 16:9 verse card and returns whether it was copied. */
export async function exportVerseImage(input: VerseImageInput): Promise<boolean> {
  if (!input.verses.length) throw new Error('No verses selected');
  const pages = [...new Set(input.verses.map((verse) => verse.page))];
  const pageDocs = new Map<number, PageDoc>();
  await Promise.all(pages.map(async (page) => {
    const [doc] = await Promise.all([fetchPage<PageDoc>(page), loadPageFont(page)]);
    pageDocs.set(page, doc);
  }));
  const arabicRuns = input.verses.map((verse) => {
    const family = fontFamily(verse.page);
    const glyphs = pageDocs.get(verse.page)?.lines
      .flatMap((line) => line.t === 'ayah' ? line.w : [])
      .filter((word) => word.k === verse.verseKey)
      .map(glyphOf)
      .join(' ') ?? '';
    return {
      text: glyphs || verse.arabic,
      family: glyphs ? `"${family}"` : '"Scheherazade New", "Traditional Arabic", serif',
    };
  });
  const translationRuns = input.verses.map((verse) => ({
    text: verse.translation,
    family: 'Arial, sans-serif',
  }));

  await Promise.all([
    ...arabicRuns.map((run) => document.fonts?.load(`400 72px ${run.family}`, run.text)),
    document.fonts?.ready,
  ].filter(Boolean));

  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  context.fillStyle = '#fffdf8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#8a6d3b';
  context.fillRect(0, 0, canvas.width, 14);
  context.fillStyle = '#e3dac4';
  // Translation receives 65% of the frame; the original Arabic occupies the
  // right-hand 35%.
  context.fillRect(1247, 110, 2, 860);

  drawFittedRuns(context, translationRuns, {
    x: 90,
    y: 130,
    width: 1068,
    height: 730,
    family: 'Arial, sans-serif',
    weight: '400',
    maxSize: 54,
    minSize: 30,
    lineHeight: 1.35,
    direction: 'ltr',
    color: '#3f392f',
  });
  drawFittedRuns(context, arabicRuns, {
    x: 1318,
    y: 115,
    width: 512,
    height: 760,
    family: arabicRuns[0].family,
    weight: '400',
    // Keep the authentic Mushaf weight while rendering the Arabic ayah at 50%
    // of the previous export size.
    maxSize: 63,
    minSize: 11,
    lineHeight: 1.55,
    direction: 'rtl',
    color: '#1f1b16',
  });

  context.fillStyle = '#8a6d3b';
  context.font = '600 28px Arial, sans-serif';
  context.textBaseline = 'middle';
  context.direction = 'ltr';
  context.textAlign = 'center';
  context.fillText(input.translationReference, 624, 960);
  context.direction = 'rtl';
  context.font = '400 34px "Scheherazade New", "Traditional Arabic", serif';
  context.fillText(input.arabicReference, 1584, 960);

  const jpg = await canvasBlob(canvas, 'image/jpeg', 0.95);
  download(jpg, input.filename.endsWith('.jpg') ? input.filename : `${input.filename}.jpg`);

  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    // Chromium and mobile WebViews generally accept PNG clipboard images even
    // when their clipboard implementation rejects image/jpeg.
    const png = await canvasBlob(canvas, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
