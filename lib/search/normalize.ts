/**
 * Arabic normalization — the single source of truth.
 *
 * The corpus is normalized with this function at BUILD time (scripts/build-corpus.mjs
 * carries an identical copy) and every query is normalized with it at search time.
 * If the two ever diverge, search silently returns nothing rather than erroring,
 * so lib/search/normalize.test.ts asserts the fixtures below.
 *
 * Use \uXXXX escapes, never literal Arabic inside character classes — literal
 * ranges are unreviewable in a diff. An early draft of this used ۪-ۼ,
 * which silently deletes real Arabic letters from U+06EE onward.
 */
export const normalizeArabic = (s: string): string =>
  s
    .normalize('NFC')
    // Combining marks, three blocks:
    //   U+0610-U+061A  honorific signs
    //   U+064B-U+065F  tashkeel + additional Arabic marks
    //   U+06D6-U+06ED  Quranic annotation signs (incl. U+06DD end-of-ayah)
    .replace(/[ؐ-ًؚ-ٟۖ-ۭ]/g, '')
    // U+0670 dagger alif (outside the range above); U+0640 tatweel, which is a
    // letter MODIFIER not a combining mark — a "strip category Mn" rule misses it
    .replace(/[ٰـ]/g, '')
    .replace(/[ٱآأإ]/g, 'ا') // alef variants -> alef
    .replace(/[ؤئ]/g, 'ء') // hamza carriers -> hamza
    .replace(/ى/g, 'ي') // alef maqsura -> ya
    .replace(/[٠-٩]/g, '') // Arabic-Indic digits (verse numbers)
    .replace(/\s+/g, ' ')
    .trim();

/** True when the string contains any Arabic letter — used to pick the search field. */
export const hasArabic = (s: string) => /[ء-ي]/.test(s);
