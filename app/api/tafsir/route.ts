import type { TafsirEditionId } from '@/lib/types';
import { TAFSIR_EDITIONS } from '@/lib/tafsir';

const CDN_ROOT = 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@v1.2.3/tafsir';

function plainArabic(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const editionId = params.get('edition') as TafsirEditionId | null;
  const surah = Number(params.get('surah'));
  const ayah = Number(params.get('ayah'));
  const edition = TAFSIR_EDITIONS.find((item) => item.id === editionId);

  if (!edition || !Number.isInteger(surah) || surah < 1 || surah > 114
    || !Number.isInteger(ayah) || ayah < 1 || ayah > 286) {
    return Response.json({ error: 'Invalid tafsir request' }, { status: 400 });
  }

  const response = await fetch(`${CDN_ROOT}/${edition.slug}/${surah}/${ayah}.json`, {
    next: { revalidate: 60 * 60 * 24 * 30 },
  });
  if (response.status === 404) {
    return Response.json({ text: '', edition: edition.label });
  }
  if (!response.ok) {
    return Response.json({ error: 'Tafsir is temporarily unavailable' }, { status: 502 });
  }

  const data = await response.json() as { text?: string };
  return Response.json(
    { text: plainArabic(data.text ?? ''), edition: edition.label },
    { headers: { 'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=86400' } },
  );
}
