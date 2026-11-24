import type { TafsirEditionId } from '@/lib/types';

export const TAFSIR_EDITIONS: ReadonlyArray<{
  id: TafsirEditionId;
  label: string;
  description: string;
  slug: string;
}> = [
  {
    id: 'arabic-words',
    label: 'معاني الكلمات — الميسر في غريب القرآن',
    description: 'Brief meanings for difficult Arabic words',
    slug: 'al-muyassar-fi-al-gharib',
  },
  {
    id: 'muyassar',
    label: 'التفسير الميسر',
    description: 'A clear, accessible explanation',
    slug: 'ar-tafsir-muyassar',
  },
  {
    id: 'mukhtasar',
    label: 'المختصر في التفسير',
    description: 'A concise verse explanation',
    slug: 'ar-tafsir-al-mukhtasar',
  },
  {
    id: 'saadi',
    label: 'تفسير السعدي',
    description: 'A readable, moderately detailed explanation',
    slug: 'ar-tafseer-al-saddi',
  },
];

export function tafsirEdition(id: TafsirEditionId) {
  return TAFSIR_EDITIONS.find((edition) => edition.id === id) ?? TAFSIR_EDITIONS[0];
}
