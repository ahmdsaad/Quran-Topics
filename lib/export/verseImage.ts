'use client';

import { fetchPage } from '@/lib/db/bootstrap';
import { fontFamily, glyphOf, loadPageFont } from '@/lib/mushaf/fonts';
import type { PageDoc } from '@/lib/types';

type VerseImageInput = {
  arabic: string;
  translation: string;
  arabicReference: string;
  translationReference: string;
  filename: string;
  page: number;
  verseKey: string;
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

function drawFittedText(context: CanvasRenderingContext2D, text: string, box: TextBox) {
  let size = box.maxSize;
  let lines: string[] = [];
  while (size >= box.minSize) {
    context.font = `${box.weight} ${size}px ${box.family}`;
    lines = wrappedLines(context, text, box.width);
    if (lines.length * size * box.lineHeight <= box.height) break;
    size -= 2;
  }

  context.save();
  context.direction = box.direction;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = box.color;
  context.font = `${box.weight} ${size}px ${box.family}`;
  const step = size * box.lineHeight;
  const firstY = box.y + box.height / 2 - ((lines.length - 1) * step) / 2;
  lines.forEach((line, index) => context.fillText(line, box.x + box.width / 2, firstY + index * step));
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
  const [pageDoc] = await Promise.all([
    fetchPage<PageDoc>(input.page),
    loadPageFont(input.page),
  ]);
  const mushafFamily = fontFamily(input.page);
  const mushafGlyphs = pageDoc.lines
    .flatMap((line) => line.t === 'ayah' ? line.w : [])
    .filter((word) => word.k === input.verseKey)
    .map(glyphOf)
    .join(' ');

  await Promise.all([
    document.fonts?.load(`400 72px "${mushafFamily}"`, mushafGlyphs),
    document.fonts?.load(`400 72px "Scheherazade New"`, input.arabic),
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
  context.fillRect(959, 110, 2, 860);

  drawFittedText(context, input.translation, {
    x: 105,
    y: 130,
    width: 750,
    height: 730,
    family: 'Arial, sans-serif',
    weight: '400',
    maxSize: 54,
    minSize: 30,
    lineHeight: 1.35,
    direction: 'ltr',
    color: '#3f392f',
  });
  drawFittedText(context, mushafGlyphs || input.arabic, {
    x: 1065,
    y: 115,
    width: 750,
    height: 760,
    family: mushafGlyphs
      ? `"${mushafFamily}"`
      : '"Scheherazade New", "Traditional Arabic", serif',
    weight: '400',
    // QPC glyphs have a smaller visual em than ordinary Arabic fonts. This
    // keeps their printed Mushaf weight untouched while giving the verse the
    // same prominence the former (artificially bold) rendering had.
    maxSize: 126,
    minSize: 42,
    lineHeight: 1.55,
    direction: 'rtl',
    color: '#1f1b16',
  });

  context.fillStyle = '#8a6d3b';
  context.font = '600 28px Arial, sans-serif';
  context.textBaseline = 'middle';
  context.direction = 'ltr';
  context.textAlign = 'center';
  context.fillText(input.translationReference, 480, 960);
  context.direction = 'rtl';
  context.font = '400 34px "Scheherazade New", "Traditional Arabic", serif';
  context.fillText(input.arabicReference, 1440, 960);

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
