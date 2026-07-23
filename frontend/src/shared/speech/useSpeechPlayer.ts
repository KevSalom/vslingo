import { useCallback, useEffect, useRef, useState } from 'react';

import { synthesizeSpeech, SpeechClientError } from './speechClient';
import { loadSpeechProvider, saveSpeechProvider } from './storage';
import type { SpeechProvider, SpeechState } from './types';

export function useSpeechPlayer() {
  const [provider, setProviderState] = useState<SpeechProvider>(() => loadSpeechProvider());
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
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

  const play = useCallback(
    async (text: string) => {
      stop();
      setError(null);

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
        const msg =
          cause instanceof SpeechClientError
            ? cause.message
            : 'Error inesperado al generar la síntesis de voz.';
        setError(msg);
        setSpeechState('error');
      }
    },
    [cleanupAudio, provider, stop],
  );

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    provider,
    setProvider,
    speechState,
    error,
    play,
    stop,
    isBusy: speechState === 'synthesizing' || speechState === 'playing',
  };
}
