import { NextResponse } from 'next/server';

const TARGETS = new Set(['en', 'ru', 'it', 'fr', 'es']);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { text?: unknown; target?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const target = typeof body?.target === 'string' ? body.target : '';
  // MyMemory's anonymous endpoint accepts at most 500 UTF-8 bytes per segment.
  if (!text || new TextEncoder().encode(text).length > 500 || !TARGETS.has(target)) {
    return NextResponse.json({ error: 'Invalid translation request' }, { status: 400 });
  }

  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `ar|${target}`);
  url.searchParams.set('mt', '1');
  const response = await fetch(url, { next: { revalidate: 60 * 60 * 24 * 30 } });
  const result = await response.json() as {
    responseData?: { translatedText?: string };
    responseStatus?: number | string;
    responseDetails?: string;
  };
  const translation = result.responseData?.translatedText;
  if (!response.ok || Number(result.responseStatus ?? 200) >= 400 || !translation) {
    return NextResponse.json({ error: result.responseDetails || 'Translation failed' }, { status: 502 });
  }
  return NextResponse.json({ translation });
}
