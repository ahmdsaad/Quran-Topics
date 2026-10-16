import type { TranslationLanguage } from '@/lib/types';

const LANGUAGES: { id: TranslationLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Русский' },
  { id: 'it', label: 'Italiano' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
];

export default function TranslationLanguageSelect({ value, onChange }: {
  value: TranslationLanguage;
  onChange: (language: TranslationLanguage) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs" style={{ color: 'var(--ink-soft)' }}>
      <span className="hidden sm:inline">Translation</span>
      <select
        className="field h-8 min-h-0 w-auto py-0 pe-7 ps-2 text-xs"
        value={value}
        aria-label="Verse translation language"
        onChange={(event) => onChange(event.target.value as TranslationLanguage)}
      >
        {LANGUAGES.map((language) => (
          <option key={language.id} value={language.id}>{language.label}</option>
        ))}
      </select>
    </label>
  );
}
