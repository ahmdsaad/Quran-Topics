import { normalizeArabic } from '@/lib/search/normalize';

/** Compare letters, not vowel marks, spacing, or the inserted Quranic alif. */
export const compactRecitation = (value: string) => normalizeArabic(value)
  .replace(/ة/g, 'ه')
  .replace(/[^ء-ي\s]/g, ' ')
  .replace(/[\sا]/g, '');
