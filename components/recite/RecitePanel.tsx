'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Meta, Verse } from '@/lib/types';
import { db } from '@/lib/db/schema';
import { normalizeArabic } from '@/lib/search/normalize';

export interface RecitationPosition {
  verseKey: string;
  page: number;
  wordIndex: number;
  word: string;
  surah: number;
  ayah: number;
  accuracy: 'correct' | 'error';
}

interface CorpusWord extends Omit<RecitationPosition, 'accuracy'> {
  compactStart: number;
  compactEnd: number;
}

interface RecitationCorpus {
  compact: string;
  charToWord: number[];
  words: CorpusWord[];
}

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
}

interface RecognitionEventLike extends Event {
  readonly results: {
    readonly length: number;
    [index: number]: RecognitionResultLike;
  };
}

interface RecognitionErrorLike extends Event {
  readonly error: string;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

const recitationText = (value: string) =>
  normalizeArabic(value)
    .replace(/ة/g, 'ه')
    .replace(/[^ء-ي\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Speech services usually transcribe modern Arabic spelling while the Mushaf
// corpus preserves Quranic orthography (for example العالمين vs العلمين after
// diacritics are removed). Ignore spacing and alif insertion for matching only;
// the displayed Quran text remains untouched.
const compactRecitation = (value: string) => recitationText(value).replace(/[\sا]/g, '');

function buildCorpus(verses: Verse[]): RecitationCorpus {
  let compact = '';
  const charToWord: number[] = [];
  const words: CorpusWord[] = [];

  for (const verse of verses) {
    const tokens = recitationText(verse.simple || verse.text).split(' ').filter(Boolean);
    tokens.forEach((word, index) => {
      const compactWord = compactRecitation(word);
      if (!compactWord) return;
      const wordOffset = words.length;
      const compactStart = compact.length;
      compact += compactWord;
      for (let character = 0; character < compactWord.length; character += 1) {
        charToWord.push(wordOffset);
      }
      words.push({
        verseKey: verse.key,
        page: verse.page,
        wordIndex: index + 1,
        word,
        surah: verse.surah,
        ayah: verse.ayah,
        compactStart,
        compactEnd: compact.length - 1,
      });
    });
  }

  return { compact, charToWord, words };
}

function findRecitationPosition(
  spoken: string,
  corpus: RecitationCorpus,
) {
  const compactSpoken = compactRecitation(spoken);
  if (compactSpoken.length < 8) return null;

  const maxLength = Math.min(56, compactSpoken.length);
  for (let length = maxLength; length >= 4; length -= 1) {
    const needle = compactSpoken.slice(-length);
    const candidates: number[] = [];
    let from = 0;
    while (from < corpus.compact.length) {
      const start = corpus.compact.indexOf(needle, from);
      if (start === -1) break;
      const end = start + length - 1;
      if (candidates.length < 3) candidates.push(end);
      from = start + 1;
      if (candidates.length >= 3) break;
    }

    if (!candidates.length) continue;
    if (candidates.length > 1) continue;
    return { endCharacter: candidates[0], matchedCharacters: length };
  }
  return null;
}

function continuingMatch(spoken: string, corpus: RecitationCorpus, startCharacter: number) {
  const heard = compactRecitation(spoken);
  let matched = 0;
  while (
    matched < heard.length
    && startCharacter + matched + 1 < corpus.compact.length
    && heard[matched] === corpus.compact[startCharacter + matched + 1]
  ) matched += 1;
  return matched;
}

function expectedWordAfter(character: number, corpus: RecitationCorpus) {
  const currentOffset = corpus.charToWord[Math.min(character, corpus.charToWord.length - 1)];
  const current = corpus.words[currentOffset];
  if (!current) return null;
  const expectedOffset = character >= current.compactEnd ? currentOffset + 1 : currentOffset;
  return corpus.words[Math.min(expectedOffset, corpus.words.length - 1)] ?? null;
}

export default function RecitePanel({
  meta,
  compact = false,
  active = true,
  onPosition,
  onCorrectWords,
  onReset,
  onClose,
  revealOnly = false,
  onRevealOnlyChange,
}: {
  meta: Meta;
  compact?: boolean;
  active?: boolean;
  onPosition: (position: RecitationPosition) => void;
  onCorrectWords: (keys: string[]) => void;
  onReset: () => void;
  onClose?: () => void;
  revealOnly?: boolean;
  onRevealOnlyChange: (value: boolean) => void;
}) {
  const [corpus, setCorpus] = useState<RecitationCorpus | null>(null);
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('Preparing Quran text…');
  const [transcript, setTranscript] = useState('');
  const [position, setPosition] = useState<RecitationPosition | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const shouldListen = useRef(false);
  const currentCharacter = useRef<number | null>(null);
  const firstRevealedWord = useRef<number | null>(null);
  const activeResultIndex = useRef(0);
  const resultStartCharacter = useRef<number | null>(null);
  const locatingFinalSpeech = useRef('');
  const currentWordKey = useRef('');
  const currentAccuracy = useRef<'correct' | 'error' | null>(null);
  const lastErrorSound = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    let live = true;
    void db().verses.orderBy('id').toArray().then((verses) => {
      if (!live) return;
      setCorpus(buildCorpus(verses));
      setStatus('Ready to listen');
    });
    return () => { live = false; };
  }, []);

  const surah = useMemo(
    () => position ? meta.surahs.find((item) => item.number === position.surah) : null,
    [meta.surahs, position],
  );

  const playError = useCallback(() => {
    if (Date.now() - lastErrorSound.current < 1200) return;
    lastErrorSound.current = Date.now();
    const AudioContextClass = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = audioContext.current ?? new AudioContextClass();
    audioContext.current = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(185, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.21);
  }, []);

  const handleTranscript = useCallback((spoken: string, isFinal: boolean, resultIndex: number) => {
    if (!corpus) return;
    setTranscript(spoken);
    if (resultIndex !== activeResultIndex.current) {
      activeResultIndex.current = resultIndex;
      resultStartCharacter.current = currentCharacter.current;
    }
    const match = resultStartCharacter.current == null
      ? findRecitationPosition(`${locatingFinalSpeech.current} ${spoken}`, corpus)
      : (() => {
          const matchedCharacters = continuingMatch(spoken, corpus, resultStartCharacter.current!);
          return matchedCharacters
            ? { endCharacter: resultStartCharacter.current! + matchedCharacters, matchedCharacters }
            : null;
        })();
    const advancing = match && (currentCharacter.current == null || match.endCharacter > currentCharacter.current);

    if (match && advancing) {
      const matchedStart = match.endCharacter - match.matchedCharacters + 1;
      const firstWord = firstRevealedWord.current ?? corpus.charToWord[matchedStart];
      const lastWord = corpus.charToWord[match.endCharacter];
      firstRevealedWord.current = firstWord;
      const correctWords: string[] = [];
      for (let offset = firstWord; offset <= lastWord; offset += 1) {
        const candidate = corpus.words[offset];
        if (candidate) {
          correctWords.push(`${candidate.verseKey}:${candidate.wordIndex}`);
        }
      }
      if (correctWords.length) onCorrectWords(correctWords);
      currentCharacter.current = match.endCharacter;
      if (resultStartCharacter.current == null) {
        resultStartCharacter.current = matchedStart - 1;
      }
      const wordOffset = corpus.charToWord[currentCharacter.current];
      const word = corpus.words[wordOffset];
      if (word) {
        const nextPosition: RecitationPosition = {
          verseKey: word.verseKey,
          page: word.page,
          wordIndex: word.wordIndex,
          word: word.word,
          surah: word.surah,
          ayah: word.ayah,
          accuracy: 'correct',
        };
        const wordKey = `${word.verseKey}:${word.wordIndex}`;
        if (wordKey !== currentWordKey.current || currentAccuracy.current === 'error') {
          currentWordKey.current = wordKey;
          currentAccuracy.current = 'correct';
          setPosition(nextPosition);
          onPosition(nextPosition);
        }
        setStatus(`Following ${word.verseKey}`);
      }
      return;
    }

    if (isFinal && currentCharacter.current != null && recitationText(spoken).length >= 2
      && resultStartCharacter.current === currentCharacter.current) {
      const expected = expectedWordAfter(currentCharacter.current, corpus);
      if (expected) {
        const errorPosition: RecitationPosition = {
          verseKey: expected.verseKey,
          page: expected.page,
          wordIndex: expected.wordIndex,
          word: expected.word,
          surah: expected.surah,
          ayah: expected.ayah,
          accuracy: 'error',
        };
        currentWordKey.current = `${expected.verseKey}:${expected.wordIndex}:error`;
        currentAccuracy.current = 'error';
        setPosition(errorPosition);
        onPosition(errorPosition);
      }
      setStatus('Please check the last words and repeat');
      playError();
    } else if (currentCharacter.current == null) {
      setStatus('Listening — keep reciting so I can find your place…');
    }
    if (isFinal && currentCharacter.current == null) {
      locatingFinalSpeech.current = `${locatingFinalSpeech.current} ${spoken}`.trim().slice(-160);
    }
  }, [corpus, onCorrectWords, onPosition, playError]);

  const stop = useCallback(() => {
    shouldListen.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setStatus(position ? `Paused at ${position.verseKey}` : 'Stopped');
  }, [position]);

  useEffect(() => {
    if (!active && shouldListen.current) stop();
  }, [active, stop]);

  const start = useCallback(() => {
    if (!corpus) return;
    const speechWindow = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      setStatus('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'ar-SA';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      activeResultIndex.current = 0;
      resultStartCharacter.current = currentCharacter.current;
      setListening(true);
      setStatus(currentCharacter.current == null ? 'Listening — start reciting…' : 'Listening…');
    };
    recognition.onresult = (event) => {
      // Web Speech repeats all earlier final segments in every event. Only
      // process the current segment; otherwise the old recitation is matched
      // against the next verse and can make the page jump or beep.
      for (let index = activeResultIndex.current; index < event.results.length; index += 1) {
        const result = event.results[index];
        handleTranscript(result[0]?.transcript?.trim() ?? '', result.isFinal, index);
        if (!result.isFinal) break;
        activeResultIndex.current = index + 1;
        resultStartCharacter.current = currentCharacter.current;
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        setStatus('Listening — no speech heard yet');
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        shouldListen.current = false;
        setListening(false);
        setStatus('Microphone permission is required. Allow it in browser settings and try again.');
        return;
      }
      setStatus(event.error === 'network'
        ? 'Speech recognition needs an internet connection.'
        : `Speech recognition error: ${event.error}`);
    };
    recognition.onend = () => {
      setListening(false);
      if (!shouldListen.current) return;
      window.setTimeout(() => {
        if (!shouldListen.current) return;
        try {
          recognition.start();
        } catch {
          setStatus('Tap Start to continue listening.');
        }
      }, 250);
    };

    shouldListen.current = true;
    recognitionRef.current = recognition;
    const AudioContextClass = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioContext.current ??= new AudioContextClass();
      void audioContext.current.resume();
    }
    try {
      recognition.start();
    } catch {
      shouldListen.current = false;
      setStatus('Could not start the microphone. Please try again.');
    }
  }, [corpus, handleTranscript]);

  useEffect(() => () => {
    shouldListen.current = false;
    recognitionRef.current?.abort();
    void audioContext.current?.close();
  }, []);

  const reset = () => {
    currentCharacter.current = null;
    firstRevealedWord.current = null;
    locatingFinalSpeech.current = '';
    activeResultIndex.current = 0;
    resultStartCharacter.current = null;
    currentWordKey.current = '';
    currentAccuracy.current = null;
    setPosition(null);
    setTranscript('');
    setStatus(listening ? 'Listening — start reciting…' : 'Ready to listen');
    onReset();
    if (shouldListen.current) recognitionRef.current?.abort();
  };

  return (
    <section
      className={compact
        ? 'rounded-full border px-1 py-0.5 shadow-sm'
        : 'flex h-full flex-col overflow-hidden'}
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface)',
      }}
      aria-label="Recitation checker"
    >
      {!compact ? <header className="border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold">Recite</h2>
        <div className="flex items-center gap-2">
          {onClose ? (
            <button className="btn btn-ghost h-8 w-8 p-0 text-lg" onClick={onClose} aria-label="Close recitation test">
              ×
            </button>
          ) : null}
        </div>
      </header> : null}

      {compact ? (
        <div className="flex items-center gap-0.5" role="group" aria-label="Test recitation controls">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-base"
            style={{ color: listening ? '#b42318' : 'var(--accent)', background: listening ? '#fee4e2' : undefined }}
            disabled={!corpus || !supported}
            onClick={listening ? stop : start}
            aria-label={listening ? 'Stop listening' : 'Start listening'}
            title={listening ? 'Stop listening' : 'Start listening'}
          >
            {listening ? '■' : '●'}
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-base"
            style={{ color: revealOnly ? 'var(--accent)' : 'var(--ink-soft)', background: revealOnly ? 'var(--accent-soft)' : undefined }}
            onClick={() => onRevealOnlyChange(!revealOnly)}
            aria-label={revealOnly ? 'Show full Quran text' : 'Reveal Quran word by word'}
            aria-pressed={revealOnly}
            title={revealOnly ? 'Show full Quran text' : 'Reveal Quran word by word'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.7-5.5 10-5.5S22 12 22 12s-3.7 5.5-10 5.5S2 12 2 12Z" />
              <circle cx="12" cy="12" r="2.5" />
              {revealOnly ? <path d="M3 21 21 3" /> : null}
            </svg>
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm"
            style={{ color: 'var(--ink-soft)' }}
            onClick={reset}
            aria-label="Reset recitation test"
            title="Reset recitation test"
          >
            ↺
          </button>
          <span role="status" className="sr-only">{status}</span>
        </div>
      ) : <div className="scroll-y flex-1 space-y-4 p-4">
        {!compact ? (
          <div className="rounded-lg border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--border)', color: 'var(--ink-soft)' }}>
            I find your starting place once, then follow the next words and verses in order. Reset to start somewhere else. Vowel marks and tajwīd are not graded; speech recognition may still mishear a word.
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            className={`btn flex-1 ${listening ? 'btn-secondary' : 'btn-primary'}`}
            disabled={!corpus || !supported}
            onClick={listening ? stop : start}
          >
            <span aria-hidden>{listening ? '■' : '●'}</span>
            {listening ? 'Stop' : 'Start listening'}
          </button>
          <button className="btn btn-ghost px-3" onClick={reset} title="Find a different Quran location">
            Reset
          </button>
        </div>

        <button
          className="btn btn-secondary w-full justify-start gap-2"
          onClick={() => onRevealOnlyChange(!revealOnly)}
          aria-pressed={revealOnly}
        >
          <span aria-hidden>👁</span>
          {revealOnly ? 'Reveal words only · On' : 'Reveal words only · Off'}
        </button>

        <div className={compact ? 'mt-2' : ''}>
          <p className="text-xs font-medium" style={{ color: listening ? '#258147' : 'var(--ink-soft)' }}>
            {status}
          </p>
          {position && !compact ? (
            <p className="mt-1 text-sm">
              {surah?.nameSimple ?? `Surah ${position.surah}`} {position.ayah} · page {position.page}
            </p>
          ) : null}
          {transcript && !compact ? (
            <p dir="rtl" className="mt-3 rounded-lg border p-3 text-right text-xl leading-loose"
              style={{ borderColor: 'var(--border)', fontFamily: "'Scheherazade New', serif" }}>
              {transcript}
            </p>
          ) : null}
        </div>
      </div>}
    </section>
  );
}
