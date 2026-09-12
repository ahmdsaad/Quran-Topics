'use client';

import { useEffect, useState } from 'react';
import type { Category, TranslationLanguage } from '@/lib/types';
import { categoryTitles } from '@/lib/categories/titles';
import CategoryTitle from './CategoryTitle';

export type QuestionLanguage = 'ar' | TranslationLanguage;

const CACHE_PREFIX = 'qc.question-translation.';

function decodeHtml(value: string) {
  const box = document.createElement('textarea');
  box.innerHTML = value;
  return box.value;
}

export default function QuestionTitle({ category, language, countLabel }: {
  category: Category;
  language: QuestionLanguage;
  countLabel?: string;
}) {
  const arabic = categoryTitles(category).arabic || category.name;
  const [translation, setTranslation] = useState('');

  useEffect(() => {
    if (language === 'ar' || !arabic.trim()) {
      setTranslation('');
      return;
    }
    const key = `${CACHE_PREFIX}${language}.${encodeURIComponent(arabic)}`;
    const cached = localStorage.getItem(key);
    if (cached) {
      setTranslation(cached);
      return;
    }
    let live = true;
    setTranslation('…');
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: arabic, target: language }),
    })
      .then(async (response) => {
        const body = await response.json() as { translation?: string; error?: string };
        if (!response.ok || !body.translation) throw new Error(body.error || 'Translation failed');
        const translated = decodeHtml(body.translation);
        localStorage.setItem(key, translated);
        if (live) setTranslation(translated);
      })
      .catch(() => {
        if (live) setTranslation('Translation unavailable');
      });
    return () => { live = false; };
  }, [arabic, language]);

  return (
    language === 'ar' ? (
      <CategoryTitle category={category} arabicOnly countLabel={countLabel} />
    ) : (
      <span dir="ltr" lang={language} className="block min-w-0 truncate text-left"
        style={{ fontSize: 'var(--category-title-font-size, 14px)' }}>
        {translation}{countLabel ? ` ${countLabel}` : ''}
      </span>
    )
  );
}

export function QuestionLanguageSelect({ value, onChange }: {
  value: QuestionLanguage;
  onChange: (language: QuestionLanguage) => void;
}) {
  return (
    <select className="field h-8 min-h-0 w-auto py-0 text-xs" value={value}
      aria-label="Question translation language"
      onChange={(event) => onChange(event.target.value as QuestionLanguage)}>
      <option value="ar">العربية</option>
      <option value="en">English</option>
      <option value="ru">Русский</option>
      <option value="it">Italiano</option>
      <option value="fr">Français</option>
      <option value="es">Español</option>
    </select>
  );
}
