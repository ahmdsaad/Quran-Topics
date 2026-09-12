import type { Category } from '@/lib/types';

const ARABIC = /[\u0600-\u06ff]/;

/** Resolves bilingual titles while keeping categories created by older versions readable. */
export function categoryTitles(category: Category) {
  const legacy = category.name?.trim() ?? '';
  const arabic = category.nameArabic?.trim() || (ARABIC.test(legacy) ? legacy : '');
  const english = category.nameEnglish?.trim() || (!ARABIC.test(legacy) ? legacy : '');
  return {
    arabic,
    english,
    combined: [english, arabic].filter(Boolean).join(' — ') || legacy || 'Untitled',
  };
}
