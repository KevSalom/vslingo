import { useCallback, useEffect, useRef, useState } from 'react';

import { synthesizeSpeech, SpeechClientError } from './speechClient';
import { loadSpeechProvider, saveSpeechProvider } from './storage';
import { loadSpeechVoice, saveSpeechVoice } from './storage';
import type { EdgeVoiceId, SpeechProvider, SpeechState } from './types';

export function useSpeechPlayer() {
  const [provider, setProviderState] = useState<SpeechProvider>(() => loadSpeechProvider());
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [voice, setVoiceState] = useState<EdgeVoiceId>(loadSpeechVoice);
  const [isBrowserFallback, setIsBrowserFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAbortController = useRef<AbortController | null>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const activeObjectUrl = useRef<string | null>(null);
  const playGeneration = useRef(0);

  const cleanupAudio = useCallback(() => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
      activeAbortController.current = null;
    }
    if (activeAudio.current) {
      activeAudio.current.pause();
      activeAudio.current.onended = null;
      activeAudio.current.onerror = null;
      activeAudio.current = null;
    }
    if (activeObjectUrl.current) {
      URL.revokeObjectURL(activeObjectUrl.current);
      activeObjectUrl.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    playGeneration.current += 1;
    cleanupAudio();
    window.speechSynthesis?.cancel();
    setSpeechState('idle');
  }, [cleanupAudio]);

  const setProvider = useCallback(
    (newProvider: SpeechProvider) => {
      stop();
      setError(null);
      setProviderState(newProvider);
      saveSpeechProvider(newProvider);
    },
    [stop],
  );

  const setVoice = useCallback((newVoice: EdgeVoiceId) => {
    stop();
    setVoiceState(newVoice);
    saveSpeechVoice(newVoice);
  }, [stop]);

  const playInBrowser = useCallback((text: string, currentGen: number) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return false;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice.startsWith('en-GB') ? 'en-GB' : 'en-US';
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((item) => item.name === voice)
      ?? voices.find((item) => item.lang === utterance.lang && item.localService)
      ?? voices.find((item) => item.lang.startsWith('en'))
      ?? null;
    utterance.onstart = () => {
      if (currentGen === playGeneration.current) {
        setIsBrowserFallback(true);
        setSpeechState('playing');
      }
    };
    utterance.onend = () => {
      if (currentGen === playGeneration.current) setSpeechState('idle');
    };
    utterance.onerror = () => {
      if (currentGen === playGeneration.current) setSpeechState('error');
    };
    window.speechSynthesis.speak(utterance);
    return true;
  }, [voice]);

  const play = useCallback(
    async (text: string) => {
      stop();
      setError(null);
      setIsBrowserFallback(false);

      if (!text.trim()) {
        return;
      }

      const currentGen = playGeneration.current;
      const controller = new AbortController();
      activeAbortController.current = controller;
      setSpeechState('synthesizing');

      try {
        const blob = await synthesizeSpeech({
          text,
          provider,
          voice,
          signal: controller.signal,
        });

        if (currentGen !== playGeneration.current) {
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrl.current = objectUrl;

        const audio = new Audio(objectUrl);
        activeAudio.current = audio;

        audio.onended = () => {
          if (currentGen === playGeneration.current) {
            cleanupAudio();
            setSpeechState('idle');
          }
        };

        audio.onerror = () => {
          if (currentGen === playGeneration.current) {
            cleanupAudio();
            setError('Error durante la reproducción de audio.');
            setSpeechState('error');
          }
        };

        await audio.play();
        if (currentGen === playGeneration.current) {
          setSpeechState('playing');
        }
      } catch (cause) {
        if (currentGen !== playGeneration.current) {
          return;
        }
        if (cause instanceof Error && cause.name === 'AbortError') {
          return;
        }
        cleanupAudio();
        if (playInBrowser(text, currentGen)) {
          setError('Usando la voz del navegador.');
          return;
        }
        const msg =
          cause instanceof SpeechClientError
            ? cause.message
            : 'Error inesperado al generar la síntesis de voz.';
        setError(msg);
        setSpeechState('error');
      }
    },
    [cleanupAudio, playInBrowser, provider, stop, voice],
  );

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    provider,
    setProvider,
    voice,
    setVoice,
    isBrowserFallback,
    speechState,
    error,
    play,
    stop,
    isBusy: speechState === 'synthesizing' || speechState === 'playing',
  };
}
