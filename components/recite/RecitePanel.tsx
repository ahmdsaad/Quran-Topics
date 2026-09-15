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
}

interface CorpusWord extends RecitationPosition {
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
  nearCharacter: number | null,
) {
  const compactSpoken = compactRecitation(spoken);
  if (compactSpoken.length < 4) return null;

  const maxLength = Math.min(56, compactSpoken.length);
  for (let length = maxLength; length >= 4; length -= 1) {
    const needle = compactSpoken.slice(-length);
    const candidates: number[] = [];
    let from = 0;
    while (from < corpus.compact.length) {
      const start = corpus.compact.indexOf(needle, from);
      if (start === -1) break;
      const end = start + length - 1;
      if (
        nearCharacter == null
          ? candidates.length < 3
          : end >= nearCharacter - 70 && end <= nearCharacter + 360
      ) {
        candidates.push(end);
      }
      from = start + 1;
      if (nearCharacter == null && candidates.length >= 3) break;
    }

    if (!candidates.length) continue;
    if (nearCharacter == null && candidates.length > 1 && length < 14) continue;

    const endCharacter = nearCharacter == null
      ? candidates[0]
      : candidates.sort((a, b) => {
          const aBehind = a < nearCharacter ? 1000 : 0;
          const bBehind = b < nearCharacter ? 1000 : 0;
          return aBehind + Math.abs(a - nearCharacter) - (bBehind + Math.abs(b - nearCharacter));
        })[0];
    return { endCharacter, matchedCharacters: length };
  }

  return null;
}

export default function RecitePanel({
  meta,
  compact = false,
  active = true,
  onPosition,
  onReset,
}: {
  meta: Meta;
  compact?: boolean;
  active?: boolean;
  onPosition: (position: RecitationPosition) => void;
  onReset: () => void;
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
  const currentWordKey = useRef('');
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

  const handleTranscript = useCallback((spoken: string, isFinal: boolean) => {
    if (!corpus) return;
    setTranscript(spoken);
    const match = findRecitationPosition(spoken, corpus, currentCharacter.current);
    const advancing = match && (
      currentCharacter.current == null || match.endCharacter >= currentCharacter.current - 8
    );

    if (match && advancing) {
      currentCharacter.current = Math.max(currentCharacter.current ?? 0, match.endCharacter);
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
        };
        const wordKey = `${word.verseKey}:${word.wordIndex}`;
        if (wordKey !== currentWordKey.current) {
          currentWordKey.current = wordKey;
          setPosition(nextPosition);
          onPosition(nextPosition);
        }
        setStatus(`Following ${word.verseKey}`);
      }
      return;
    }

    if (isFinal && currentCharacter.current != null && compactRecitation(spoken).length >= 4) {
      setStatus('Please check the last words and repeat');
      playError();
    } else if (currentCharacter.current == null) {
      setStatus('Listening — keep reciting so I can find your place…');
    }
  }, [corpus, onPosition, playError]);

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
      setListening(true);
      setStatus(currentCharacter.current == null ? 'Listening — start reciting…' : 'Listening…');
    };
    recognition.onresult = (event) => {
      let spoken = '';
      for (let index = 0; index < event.results.length; index += 1) {
        spoken += ` ${event.results[index][0]?.transcript ?? ''}`;
      }
      const isFinal = event.results[event.results.length - 1]?.isFinal === true;
      handleTranscript(spoken.trim(), isFinal);
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
    currentWordKey.current = '';
    setPosition(null);
    setTranscript('');
    setStatus(listening ? 'Listening — start reciting…' : 'Ready to listen');
    onReset();
  };

  return (
    <section
      className={compact
        ? 'rounded-xl border p-3 shadow-lg backdrop-blur'
        : 'flex h-full flex-col overflow-hidden'}
      style={{
        borderColor: 'var(--border)',
        background: compact ? 'color-mix(in srgb, var(--surface) 94%, transparent)' : 'var(--surface)',
      }}
      aria-label="Recitation checker"
    >
      <header className={compact ? 'mb-2 flex items-center justify-between' : 'border-b px-4 py-3'}
        style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold">Recite</h2>
        {compact && position ? (
          <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{position.verseKey}</span>
        ) : null}
      </header>

      <div className={compact ? '' : 'scroll-y flex-1 space-y-4 p-4'}>
        {!compact ? (
          <div className="rounded-lg border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--border)', color: 'var(--ink-soft)' }}>
            This mode follows recognized Quran words. It can flag a likely word mismatch, but it does not grade tajwīd or subtle pronunciation and may occasionally mishear speech.
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
      </div>
    </section>
  );
}
