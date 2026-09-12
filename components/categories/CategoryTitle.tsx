import type { Category } from '@/lib/types';
import { categoryTitles } from '@/lib/categories/titles';

export default function CategoryTitle({ category, arabicOnly = false, countLabel }: {
  category: Category;
  arabicOnly?: boolean;
  countLabel?: string;
}) {
  const { arabic, english } = categoryTitles(category);
  if (arabicOnly) {
    return (
      <span dir="rtl" lang="ar" className="block min-w-0 truncate text-right"
        style={{ fontSize: 'var(--category-title-font-size, 14px)' }}>
        {arabic || category.name || '—'}{countLabel ? ` ${countLabel}` : ''}
      </span>
    );
  }
  return (
    <span
      className="grid min-w-0 grid-cols-2 items-center gap-3"
      style={{ fontSize: 'var(--category-title-font-size, 14px)' }}
    >
      <span dir="ltr" lang="en" className="truncate text-left">
        {english || '—'}{countLabel ? ` ${countLabel}` : ''}
      </span>
      <span dir="rtl" lang="ar" className="truncate text-right">{arabic || '—'}</span>
    </span>
  );
}
