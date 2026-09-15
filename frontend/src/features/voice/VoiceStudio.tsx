import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechVoiceControl } from '../../shared/speech/SpeechVoiceControl';
import { updateAccountPreferences } from '../../shared/auth/preferencesClient';
import {
  createVoiceConversation,
  deleteVoiceConversation,
  getVoiceConversation,
  listVoiceConversations,
  saveVoiceFeedback,
  saveVoiceTurn,
  type VoiceConversationEntry,
} from '../../shared/history/historyClient';
import {
  loadSpeechProvider,
  loadSpeechVoice,
  saveSpeechProvider,
  saveSpeechVoice,
} from '../../shared/speech/storage';
import type { EdgeVoiceId } from '../../shared/speech/types';
import {
  BrowserSpeechCoordinator,
  type BrowserSpeechSegment,
} from '../../shared/speech/browserSpeech';
import { AudioRecorder } from './audioCapture';
import { AudioScheduler } from './audioScheduler';
import type {
  AudioBeginMessage,
  ErrorMessage,
  ScenarioType,
  SpeechProviderType,
  VoiceFeedback,
} from './protocol';
import { VoiceSocketClient } from './voiceSocket';
import {
  ACCESSIBLE_INPUT_LABELS,
  SCENARIO_LABELS,
  loadVoicePreferences,
  saveVoicePreferences,
  type InputSubstate,
  type TurnRecord,
} from './voiceState';

export type VoiceState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'recording'
  | 'transcribing'
  | 'error'
  | 'closed';

export function VoiceStudio() {
  const [state, setState] = useState<VoiceState>('idle');
  const [inputState, setInputState] = useState<InputSubstate>('idle');
  const [speechVoice, setSpeechVoice] = useState<EdgeVoiceId>(loadSpeechVoice);
  const [isTapRecording, setIsTapRecording] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [scenario, setScenario] = useState<ScenarioType>(loadVoicePreferences);
  const [speechProvider, setSpeechProvider] = useState<SpeechProviderType>(loadSpeechProvider);
  const [generation, setGeneration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Turn states
  const [turnHistory, setTurnHistory] = useState<TurnRecord[]>([]);
  const [userTranscript, setUserTranscript] = useState('');
  const [streamingAssistant, setStreamingAssistant] = useState('');
  const [isAssistantStreaming, setIsAssistantStreaming] = useState(false);
  const [isFeedbackPending, setIsFeedbackPending] = useState(false);
  const [activeFeedback, setActiveFeedback] = useState<VoiceFeedback | null>(null);
  const [feedbackErrorMsg, setFeedbackErrorMsg] = useState<string | null>(null);
  const [savedConversations, setSavedConversations] = useState<VoiceConversationEntry[] | null>(null);

  const socketRef = useRef<VoiceSocketClient | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const schedulerRef = useRef<AudioScheduler | null>(null);
  const browserSpeechRef = useRef<BrowserSpeechCoordinator | null>(null);
  const browserFallbackGenerationRef = useRef<number | null>(null);
  const speechSegmentsRef = useRef<Map<number, BrowserSpeechSegment>>(new Map());
  const pendingAudioRef = useRef<{ begin: AudioBeginMessage; received: boolean } | null>(null);
  const nextAudioIndexRef = useRef(0);
  const configRevisionRef = useRef(0);
  /** Last scenario confirmed by session.configured; used to clear UI history only on scenario change. */
  const configuredScenarioRef = useRef<ScenarioType | null>(null);
  const captureOwnerRef = useRef<'ptt' | null>(null);
  const speechVoiceRef = useRef<EdgeVoiceId>(speechVoice);
  const conversationRef = useRef<Promise<{ id: string } | null> | null>(null);
  const persistedTurnsRef = useRef<Map<string, Promise<{ id: string }>>>(new Map());

  const currentTurnIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const accumulatedAssistantRef = useRef('');
  const userTranscriptRef = useRef('');
  const scenarioRef = useRef<ScenarioType>(scenario);
  const speechProviderRef = useRef<SpeechProviderType>(speechProvider);
  const isPlayingAudioRef = useRef(false);
  /** True only while PTT reports real speech ("Te escucho"). */
  const speechActiveRef = useRef(false);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(() => {
    speechProviderRef.current = speechProvider;
  }, [speechProvider]);

  useEffect(() => {
    speechVoiceRef.current = speechVoice;
    browserSpeechRef.current?.setVoice(speechVoice);
  }, [speechVoice]);

  useEffect(() => {
    generationRef.current = generation;
  }, [generation]);

  useEffect(() => {
    isPlayingAudioRef.current = isPlayingAudio;
  }, [isPlayingAudio]);

  useEffect(() => {
    if (!isPlayingAudio) {
      setOutputLevel(0);
      return;
    }
    // Ignore residual mic while the assistant reply is playing.
    setInputLevel(0);
    const analyser = schedulerRef.current?.getAnalyserNode();
    if (!analyser) return;

    const samples = new Uint8Array(analyser.frequencyBinCount);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let animationFrame = 0;
    let smoothed = 0;
    const updateLevel = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      let sumSq = 0;
      for (const sample of samples) {
        const v = (sample - 128) / 128;
        peak = Math.max(peak, Math.abs(v));
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / samples.length);
      // TTS decode is quieter than mic RMS; boost so agent bars match user presence.
      const raw = Math.max(rms * 14, (peak - 0.012) * 4.2);
      const target = Math.min(1, Math.max(0, raw));
      smoothed += (target - smoothed) * (target > smoothed ? 0.55 : 0.28);
      if (target === 0 && smoothed < 0.05) smoothed = 0;
      setOutputLevel(smoothed);
      if (!reducedMotion) animationFrame = requestAnimationFrame(updateLevel);
    };
    updateLevel();
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [isPlayingAudio]);

  const cancelCurrentTurn = useCallback((message?: string) => {
    const turnId = currentTurnIdRef.current;
    const captureOwner = captureOwnerRef.current;
    const recorder = recorderRef.current;
    if (recorder) {
      recorderRef.current = null;
      recorder.cleanup();
    }
    if (captureOwner === 'ptt') {
      setState('ready');
      setInputState('fallback_ptt');
      setIsTapRecording(false);
    }
    if (!turnId) {
      captureOwnerRef.current = null;
      pendingAudioRef.current = null;
      browserFallbackGenerationRef.current = null;
      browserSpeechRef.current?.stop();
      schedulerRef.current?.stopAll();
      setIsAssistantStreaming(false);
      setIsFeedbackPending(false);
      setIsPlayingAudio(false);
      if (message) setErrorMessage(message);
      return;
    }

    socketRef.current?.sendMessage({
      type: 'response.cancel',
      turn_id: turnId,
      generation: generationRef.current,
    });
    currentTurnIdRef.current = null;
    captureOwnerRef.current = null;
    pendingAudioRef.current = null;
    browserFallbackGenerationRef.current = null;
    browserSpeechRef.current?.cancelBefore(generationRef.current + 1);
    schedulerRef.current?.stopAll();
    setIsAssistantStreaming(false);
    setIsFeedbackPending(false);
    setIsPlayingAudio(false);
    if (message) setErrorMessage(message);
  }, []);

  const readyInputState = useCallback((): InputSubstate => 'fallback_ptt', []);

  const beginTurn = useCallback(() => {
    const client = socketRef.current;
    if (!client) return null;

    const previousTurnId = currentTurnIdRef.current;
    const previousGeneration = generationRef.current;
    if (previousTurnId) {
      client.sendMessage({
        type: 'response.cancel',
        turn_id: previousTurnId,
        generation: previousGeneration,
      });
    }

    const nextGeneration = previousGeneration + 1;
    const turnId = crypto.randomUUID();
    generationRef.current = nextGeneration;
    currentTurnIdRef.current = turnId;
    nextAudioIndexRef.current = 0;
    pendingAudioRef.current = null;
    speechSegmentsRef.current.clear();
    browserFallbackGenerationRef.current = null;
    setGeneration(nextGeneration);
    setUserTranscript('');
    userTranscriptRef.current = '';
    setStreamingAssistant('');
    accumulatedAssistantRef.current = '';
    schedulerRef.current?.cancelBefore(nextGeneration);

    schedulerRef.current?.stopAll();
    browserSpeechRef.current?.cancelBefore(nextGeneration);
    setIsPlayingAudio(false);
    client.sendMessage({
      type: 'speech.started',
      turn_id: turnId,
      generation: nextGeneration,
    });
    return { turnId, generation: nextGeneration };
  }, []);

  const messageIsCurrent = useCallback(
    (message: { generation: number; turn_id?: string }) =>
      message.generation === generationRef.current &&
      (!message.turn_id || message.turn_id === currentTurnIdRef.current),
    [],
  );

  const startBrowserFallback = useCallback((fallbackGeneration: number, fromIndex: number) => {
    const coordinator = browserSpeechRef.current;
    if (!coordinator || fallbackGeneration !== generationRef.current) {
      setErrorMessage('La voz no está disponible, pero la respuesta queda en texto.');
      return;
    }
    schedulerRef.current?.stopAll();
    browserFallbackGenerationRef.current = fallbackGeneration;
    for (const [index, segment] of [...speechSegmentsRef.current.entries()].sort((a, b) => a[0] - b[0])) {
      if (index >= fromIndex) coordinator.queue(segment);
    }
    setErrorMessage('Usando la voz del navegador.');
  }, []);

  const cleanupLocalResources = useCallback(() => {
    configRevisionRef.current = 0;
    configuredScenarioRef.current = null;
    captureOwnerRef.current = null;
    pendingAudioRef.current = null;
    browserFallbackGenerationRef.current = null;
    browserSpeechRef.current?.stop();
    browserSpeechRef.current = null;
    if (recorderRef.current) {
      recorderRef.current.cleanup();
      recorderRef.current = null;
    }
    if (schedulerRef.current) {
      void schedulerRef.current.close();
      schedulerRef.current = null;
    }
    setIsPlayingAudio(false);
    setInputLevel(0);
    setOutputLevel(0);
  }, []);

  const handleConnect = async () => {
    setState('connecting');
    setInputState('fallback_ptt');
    setErrorMessage(null);
    try {
      const scheduler = new AudioScheduler({
        onPlaybackStart: (playbackGeneration, index) => {
          setIsPlayingAudio(true);
          const playback = speechSegmentsRef.current.get(index);
          if (playback && playbackGeneration === generationRef.current) {
            socketRef.current?.sendMessage({
              type: 'playback.started',
              turn_id: playback.turnId,
              generation: playback.generation,
              segment_id: playback.segmentId,
              segment_index: playback.index,
              engine: 'edge_tts',
            });
          }
        },
        onIdle: () => setIsPlayingAudio(false),
        onError: (err, playbackGeneration, index) => {
          console.warn('Audio scheduler error:', err);
          startBrowserFallback(playbackGeneration, index);
        },
      });
      schedulerRef.current = scheduler;

      if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
        browserSpeechRef.current = new BrowserSpeechCoordinator(window.speechSynthesis, {
          onStarted: (playback) => {
            setIsPlayingAudio(true);
            socketRef.current?.sendMessage({
              type: 'playback.started',
              turn_id: playback.turnId,
              generation: playback.generation,
              segment_id: playback.segmentId,
              segment_index: playback.index,
              engine: 'browser',
            });
          },
          onCompleted: () => setIsPlayingAudio(false),
          onFailed: () => {
            setIsPlayingAudio(false);
            setErrorMessage('No hay síntesis disponible. Puedes continuar leyendo la respuesta.');
          },
        });
        browserSpeechRef.current.setVoice(speechVoiceRef.current);
      }

      const client = new VoiceSocketClient();
      socketRef.current = client;

      client.onStatusChange((connected) => {
        if (!connected) {
          if (socketRef.current === client) socketRef.current = null;
          cleanupLocalResources();
          setState('closed');
          setInputState('idle');
        }
      });

      client.onBinary((arrayBuffer) => {
        const pending = pendingAudioRef.current;
        if (!pending) {
          setErrorMessage('Se recibió audio sin un audio.begin válido.');
          cancelCurrentTurn();
          return;
        }
        if (!messageIsCurrent(pending.begin)) {
          pending.received = true;
          return;
        }
        if (browserFallbackGenerationRef.current === pending.begin.generation) {
          // Once a turn moves to browser speech, every late MP3 frame is discarded.
          pending.received = true;
          return;
        }
        if (pending.received || arrayBuffer.byteLength !== pending.begin.byte_length) {
          setErrorMessage('La respuesta de audio no coincide con el protocolo esperado.');
          cancelCurrentTurn();
          return;
        }

        pending.received = true;
        void schedulerRef.current?.enqueue({
          generation: pending.begin.generation,
          index: pending.begin.segment_index,
          bytes: arrayBuffer,
        });
      });

      client.onMessage((msg) => {
        switch (msg.type) {
          case 'session.ready': {
            const initGen = msg.generation;
            generationRef.current = initGen;
            setGeneration(initGen);
            setState('ready');
            setInputState('fallback_ptt');

            client.sendMessage({
              type: 'session.config',
              scenario: scenarioRef.current,
              speech_provider: speechProviderRef.current,
              speech_voice: speechVoiceRef.current,
            });

            break;
          }

          case 'session.configured':
            if (msg.config_revision <= configRevisionRef.current) break;
            configRevisionRef.current = msg.config_revision;
            // Match backend: history.reset only when scenario changes (provider-only keeps memory).
            const scenarioChanged =
              configuredScenarioRef.current !== null &&
              configuredScenarioRef.current !== msg.scenario;
            configuredScenarioRef.current = msg.scenario;
            scenarioRef.current = msg.scenario;
            speechProviderRef.current = msg.speech_provider;
            setScenario(msg.scenario);
            setSpeechProvider(msg.speech_provider);
            setSpeechVoice(msg.speech_voice);
            speechVoiceRef.current = msg.speech_voice;
            saveVoicePreferences(msg.scenario);
            saveSpeechProvider(msg.speech_provider);
            if (scenarioChanged) {
              conversationRef.current = createVoiceConversation(msg.scenario).catch(() => {
                setErrorMessage('La práctica funciona, pero el historial no está disponible.');
                return null;
              });
              persistedTurnsRef.current.clear();
              setTurnHistory([]);
              setUserTranscript('');
              userTranscriptRef.current = '';
              setStreamingAssistant('');
              accumulatedAssistantRef.current = '';
              setIsAssistantStreaming(false);
              setIsFeedbackPending(false);
              setActiveFeedback(null);
              setFeedbackErrorMsg(null);
            }
            break;

          case 'transcript.final':
            if (!messageIsCurrent(msg)) break;
            setUserTranscript(msg.text);
            userTranscriptRef.current = msg.text;
            setIsAssistantStreaming(true);
            setIsFeedbackPending(true);
            setStreamingAssistant('');
            accumulatedAssistantRef.current = '';
            setActiveFeedback(null);
            setFeedbackErrorMsg(null);
            setState('ready');
            setInputState(readyInputState());
            break;

          case 'assistant.delta':
            if (!messageIsCurrent(msg)) break;
            accumulatedAssistantRef.current += msg.delta;
            setStreamingAssistant(accumulatedAssistantRef.current);
            break;

          case 'assistant.done':
            if (!messageIsCurrent(msg)) break;
            setIsAssistantStreaming(false);
            setStreamingAssistant(msg.text);
            const currentUserText = userTranscriptRef.current;
            setTurnHistory((prev) => {
              const updated = [
                ...prev,
                {
                  turnId: msg.turn_id,
                  userText: currentUserText,
                  assistantText: msg.text,
                },
              ];
              return updated.slice(-6);
            });
            setUserTranscript('');
            userTranscriptRef.current = '';
            if (conversationRef.current) {
              const persisted = conversationRef.current.then((conversation) => {
                if (!conversation) throw new Error('History unavailable');
                return saveVoiceTurn(conversation.id, {
                  operation_id: msg.turn_id,
                  user_text: currentUserText,
                  assistant_text: msg.text,
                });
              });
              persistedTurnsRef.current.set(msg.turn_id, persisted);
              void persisted.catch(() => {
                setErrorMessage('La respuesta sigue visible, pero no pudo guardarse en el historial.');
              });
            }
            break;

          case 'assistant.segment': {
            if (!messageIsCurrent(msg)) break;
            const segment: BrowserSpeechSegment = {
              turnId: msg.turn_id,
              generation: msg.generation,
              segmentId: msg.segment_id,
              index: msg.segment_index,
              text: msg.text,
            };
            speechSegmentsRef.current.set(msg.segment_index, segment);
            if (browserFallbackGenerationRef.current === msg.generation) {
              browserSpeechRef.current?.queue(segment);
            }
            break;
          }



          case 'audio.begin': {
            if (pendingAudioRef.current) {
              setErrorMessage('Se recibió audio.begin antes de cerrar el segmento anterior.');
              cancelCurrentTurn();
              break;
            }
            if (messageIsCurrent(msg) && msg.segment_index !== nextAudioIndexRef.current) {
              setErrorMessage('Los segmentos de audio llegaron fuera de orden.');
              cancelCurrentTurn();
              break;
            }
            pendingAudioRef.current = { begin: msg, received: false };
            break;
          }

          case 'audio.end': {
            const pending = pendingAudioRef.current;
            const matches =
              pending &&
              pending.received &&
              pending.begin.turn_id === msg.turn_id &&
              pending.begin.generation === msg.generation &&
              pending.begin.segment_id === msg.segment_id &&
              pending.begin.segment_index === msg.segment_index;
            if (!matches) {
              setErrorMessage('El cierre del segmento de audio no coincide con audio.begin.');
              cancelCurrentTurn();
              break;
            }
            if (messageIsCurrent(msg)) nextAudioIndexRef.current += 1;
            pendingAudioRef.current = null;
            break;
          }

          case 'feedback.ready':
            if (!messageIsCurrent(msg)) break;
            setIsFeedbackPending(false);
            setActiveFeedback(msg.feedback);
            setTurnHistory((prev) =>
              prev.map((t) => (t.turnId === msg.turn_id ? { ...t, feedback: msg.feedback } : t))
            );
            void persistedTurnsRef.current.get(msg.turn_id)?.then((turn) =>
              saveVoiceFeedback(turn.id, msg.feedback),
            ).catch(() => {
              setFeedbackErrorMsg('El feedback está visible, pero no pudo sincronizarse.');
            });
            break;

          case 'response.cancelled':
            if (msg.generation !== generationRef.current) break;
            if (currentTurnIdRef.current && msg.turn_id !== currentTurnIdRef.current) break;
            if (msg.turn_id === currentTurnIdRef.current) currentTurnIdRef.current = null;
            setIsAssistantStreaming(false);
            setIsFeedbackPending(false);
            setState('ready');
            setInputState(readyInputState());
            break;

          case 'metrics.stage':
            // Operational metrics stay out of the learner-facing interface.
            break;

          case 'error':
            if (msg.generation !== undefined && msg.generation !== generationRef.current) break;
            if (msg.code === 'feedback_unavailable') {
              setIsFeedbackPending(false);
              setFeedbackErrorMsg('La conversación continúa, pero el feedback no está disponible.');
            } else if (msg.code === 'conversation_unavailable') {
              setIsAssistantStreaming(false);
              setIsFeedbackPending(false);
              setErrorMessage('La conversación no está disponible.');
            } else if (msg.code === 'history_not_found') {
              setIsAssistantStreaming(false);
              setIsFeedbackPending(false);
              setErrorMessage('Esta conversación ya no existe o pertenece a otra cuenta.');
              handleServerError(msg);
            } else if (msg.code === 'history_unavailable') {
              setIsAssistantStreaming(false);
              setIsFeedbackPending(false);
              setErrorMessage('No pudimos recuperar el historial. Inténtalo de nuevo.');
              handleServerError(msg);
            } else if (msg.code === 'speech_unavailable') {
              startBrowserFallback(msg.generation ?? generationRef.current, msg.segment_index ?? 0);
            } else if (msg.code === 'provider_busy') {
              setErrorMessage('El proveedor está ocupado. Inténtalo de nuevo en unos instantes.');
              handleServerError(msg);
            } else {
              setIsAssistantStreaming(false);
              setIsFeedbackPending(false);
              cancelCurrentTurn();
              handleServerError(msg);
            }
            break;
        }
      });

      if (!conversationRef.current) {
        conversationRef.current = createVoiceConversation(scenarioRef.current).catch(() => {
          setErrorMessage('La práctica funciona, pero el historial no está disponible.');
          return null;
        });
      }
      const conversation = await conversationRef.current;
      await client.connect(conversation?.id);
    } catch (err) {
      console.error('Connection failed:', err);
      setErrorMessage('No se pudo conectar con el servicio de voz.');
      setState('error');
      setInputState('input_error');
    }
  };

  const handleDisconnect = () => {
    cancelCurrentTurn();
    const client = socketRef.current;
    socketRef.current = null;
    client?.disconnect();
    cleanupLocalResources();
    conversationRef.current = null;
    persistedTurnsRef.current.clear();
    setState('idle');
    setInputState('idle');
  };

  const handleStopPlayback = () => {
    cancelCurrentTurn();
    setInputState('interrupted');
  };

  const handleServerError = (msg: ErrorMessage) => {
    if (msg.code !== 'history_not_found' && msg.code !== 'history_unavailable') {
      setErrorMessage(`Error [${msg.code}]: ${msg.message}`);
    }
    if (msg.fatal) {
      conversationRef.current = null;
      setState('error');
      setInputState('input_error');
      const client = socketRef.current;
      socketRef.current = null;
      client?.disconnect();
      cleanupLocalResources();
    } else {
      setState('ready');
      setInputState(readyInputState());
    }
  };

  const applyConfiguration = useCallback(
    (newScenario: ScenarioType, newProvider: SpeechProviderType, newVoice: EdgeVoiceId) => {
      const scenarioChanged = newScenario !== scenarioRef.current;
      scenarioRef.current = newScenario;
      speechProviderRef.current = newProvider;
      speechVoiceRef.current = newVoice;
      setScenario(newScenario);
      setSpeechProvider(newProvider);
      setSpeechVoice(newVoice);
      saveVoicePreferences(newScenario);
      saveSpeechProvider(newProvider);
      saveSpeechVoice(newVoice);

      if (scenarioChanged) cancelCurrentTurn();
      socketRef.current?.sendMessage({
        type: 'session.config',
        scenario: newScenario,
        speech_provider: newProvider,
        speech_voice: newVoice,
      });
      // Conversation UI is cleared only when session.configured confirms a scenario change.
    },
    [cancelCurrentTurn],
  );

  const handleScenarioChange = (newScenario: ScenarioType) => {
    applyConfiguration(newScenario, speechProviderRef.current, speechVoiceRef.current);
  };

  const handleSpeechVoiceChange = (newVoice: EdgeVoiceId) => {
    applyConfiguration(scenarioRef.current, speechProviderRef.current, newVoice);
    void updateAccountPreferences({ speech_voice: newVoice }).catch(() => {
      setErrorMessage('La voz cambió en este dispositivo, pero no pudo sincronizarse.');
    });
  };

  const startRecording = useCallback(async (tapMode = false) => {
    if (state !== 'ready' || !socketRef.current || captureOwnerRef.current) return;

    captureOwnerRef.current = 'ptt';
    schedulerRef.current?.stopAll();
    setIsPlayingAudio(false);
    const recorder = new AudioRecorder({
      onFrameLevel: (level) => {
        if (isPlayingAudioRef.current || captureOwnerRef.current !== 'ptt') return;
        const reducedMotion =
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        setInputLevel(reducedMotion ? (level > 0.12 ? 0.45 : 0) : level);
      },
    });
    recorderRef.current = recorder;

    try {
      await recorder.start();
      if (captureOwnerRef.current !== 'ptt' || recorderRef.current !== recorder) {
        recorder.cleanup();
        return;
      }
      beginTurn();
      setState('recording');
      setIsTapRecording(tapMode);
      speechActiveRef.current = true;
      setInputLevel(0);
      setInputState('speech');
    } catch (err) {
      recorder.cleanup();
      if (recorderRef.current === recorder) recorderRef.current = null;
      captureOwnerRef.current = null;
      speechActiveRef.current = false;
      setInputLevel(0);
      console.error('Failed to start microphone:', err);
      setErrorMessage('No se pudo acceder al micrófono. Revisa el permiso e inténtalo de nuevo.');
      setState('ready');
      setIsTapRecording(false);
      setInputState('fallback_ptt');
    }
  }, [beginTurn, state]);

  const stopRecording = useCallback(() => {
    if (captureOwnerRef.current !== 'ptt' || !recorderRef.current || !socketRef.current) return;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    captureOwnerRef.current = null;
    setIsTapRecording(false);
    speechActiveRef.current = false;
    setInputLevel(0);
    try {
      const turnId = currentTurnIdRef.current;
      const turnGeneration = generationRef.current;
      const { wavBytes, durationMs } = recorder.stop();

      if (!turnId || durationMs < 100 || durationMs > 60000 || wavBytes.length <= 44) {
        cancelCurrentTurn('Mantén pulsado al menos un instante y vuelve a hablar.');
        setState('ready');
        setInputState('fallback_ptt');
        return;
      }

      setState('transcribing');
      setInputState('encoding');
      socketRef.current.sendMessage({
        type: 'utterance.begin',
        turn_id: turnId,
        generation: turnGeneration,
        media_type: 'audio/wav',
        byte_length: wavBytes.length,
        duration_ms: durationMs,
      });
      socketRef.current.sendBinary(wavBytes);
    } catch (err) {
      recorder.cleanup();
      cancelCurrentTurn('Error procesando la grabación de audio.');
      console.error('Error stopping recording:', err);
      setState('ready');
      setInputState('fallback_ptt');
    }
  }, [cancelCurrentTurn]);

  useEffect(() => {
    return () => {
      const turnId = currentTurnIdRef.current;
      if (turnId) {
        socketRef.current?.sendMessage({
          type: 'response.cancel',
          turn_id: turnId,
          generation: generationRef.current,
        });
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
      recorderRef.current?.cleanup();
      recorderRef.current = null;
      browserSpeechRef.current?.stop();
      browserSpeechRef.current = null;
      void schedulerRef.current?.close();
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const releaseMicrophone = () => {
      if (captureOwnerRef.current === 'ptt') cancelCurrentTurn();
    };
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') releaseMicrophone();
    };
    window.addEventListener('blur', releaseMicrophone);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', releaseMicrophone);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [cancelCurrentTurn]);

  const isSessionOff = state === 'idle' || state === 'closed' || state === 'error';
  const powerMode: 'off' | 'active' | 'pause' = isPlayingAudio
    ? 'pause'
    : isSessionOff
      ? 'off'
      : 'active';
  const statusDotClass =
    state === 'ready' || state === 'recording' || state === 'transcribing'
      ? 'is-ready'
      : state === 'connecting'
        ? 'is-working'
        : inputState === 'speech'
          ? 'is-ready'
          : '';

  const handlePowerClick = () => {
    if (powerMode === 'pause') {
      handleStopPlayback();
      return;
    }
    if (powerMode === 'off') {
      void handleConnect();
      return;
    }
    handleDisconnect();
  };

  return (
    <section className="voice-studio" aria-labelledby="voice-title">
      <div className="sr-only" aria-live="polite">
        {ACCESSIBLE_INPUT_LABELS[inputState]} {isPlayingAudio ? '— Respondiendo' : ''}
      </div>

      <h2 className="sr-only" id="voice-title">
        Hablar
      </h2>

      <div className="history-toolbar">
        <button
          className="writing-btn writing-btn-ghost writing-btn-sm"
          onClick={() => {
            if (savedConversations) {
              setSavedConversations(null);
              return;
            }
            void listVoiceConversations().then(setSavedConversations).catch(() => {
              setErrorMessage('No se pudo cargar el historial de conversaciones.');
            });
          }}
          type="button"
        >
          {savedConversations ? 'Ocultar historial' : 'Ver historial'}
        </button>
      </div>
      {savedConversations ? (
        <ul className="history-list" aria-label="Historial de conversaciones">
          {savedConversations.length ? savedConversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                onClick={() => void getVoiceConversation(conversation.id).then((reopened) => {
                  conversationRef.current = Promise.resolve({ id: reopened.id });
                  if (reopened.scenario in SCENARIO_LABELS) {
                    const restoredScenario = reopened.scenario as ScenarioType;
                    scenarioRef.current = restoredScenario;
                    configuredScenarioRef.current = restoredScenario;
                    setScenario(restoredScenario);
                  }
                  setTurnHistory((reopened.turns ?? []).map((turn) => ({
                    turnId: turn.operation_id,
                    userText: turn.user_text,
                    assistantText: turn.assistant_text,
                    ...(turn.feedback ? { feedback: turn.feedback } : {}),
                  })));
                  setSavedConversations(null);
                }).catch(() => setErrorMessage('No se pudo reabrir la conversación.'))}
                type="button"
              >
                <strong>{conversation.title}</strong>
                <span>{new Date(conversation.updated_at).toLocaleDateString('es')}</span>
              </button>
              <button
                aria-label={`Eliminar ${conversation.title}`}
                onClick={() => void deleteVoiceConversation(conversation.id).then(() => {
                  setSavedConversations((current) => current?.filter((item) => item.id !== conversation.id) ?? []);
                }).catch(() => setErrorMessage('No se pudo eliminar la conversación.'))}
                type="button"
              >
                Eliminar
              </button>
            </li>
          )) : <li className="history-empty">Aún no hay conversaciones guardadas.</li>}
        </ul>
      ) : null}

      <div className="voice-split">
        <div className="voice-pane voice-pane-control">
          <div className="voice-pane-tabs">
            <span className="voice-pane-tab is-active">Tu práctica</span>
            <div
              aria-label={`Estado: ${ACCESSIBLE_INPUT_LABELS[inputState]}${isPlayingAudio ? ', respondiendo' : ''}`}
              className="voice-header-status"
              role="status"
            >
              <span
                aria-hidden="true"
                className={`voice-status-dot ${statusDotClass}${isPlayingAudio ? ' is-playing' : ''}`}
              />
              <span className="voice-header-status-label">
                {isPlayingAudio ? 'Respondiendo' : ACCESSIBLE_INPUT_LABELS[inputState]}
              </span>
            </div>
          </div>

          <section className="voice-setup" aria-label="Preparar práctica de voz">
            <div className="voice-settings">
              <div className="flex items-center gap-2">
                <label htmlFor="voice-scenario" className="text-xs font-semibold text-slate-300">
                  Escenario
                </label>
                <select
                  id="voice-scenario"
                  value={scenario}
                  onChange={(event) => handleScenarioChange(event.target.value as ScenarioType)}
                  disabled={state === 'connecting'}
                  className="h-[2.15rem] rounded border border-[#3b4d60] bg-[#18212c] px-3 text-[0.82rem] font-medium text-[#f1f5f9] outline-none transition-colors hover:border-slate-500 focus:border-[#22d3ee] focus:ring-1 focus:ring-[#22d3ee] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((key) => (
                    <option key={key} value={key} className="bg-[#18212c] text-[#f1f5f9]">
                      {SCENARIO_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
              <SpeechVoiceControl
                id="voice-speech-voice"
                voice={speechVoice}
                onChange={handleSpeechVoiceChange}
                disabled={state === 'connecting'}
              />
            </div>
          </section>

          <div className="voice-power-wrap">
            <button
              type="button"
              className={`voice-power is-${powerMode}`}
              onClick={handlePowerClick}
              aria-label={
                powerMode === 'off'
                  ? 'Activar micrófono'
                  : powerMode === 'pause'
                    ? 'Detener respuesta'
                    : 'Terminar práctica'
              }
              title={
                powerMode === 'off'
                  ? 'Activar micrófono'
                  : powerMode === 'pause'
                    ? 'Detener respuesta'
                    : 'Terminar práctica'
              }
            >
              <span className="voice-power-ring" aria-hidden="true" />
              <span className="voice-power-label">
                {powerMode === 'off'
                  ? 'Activar micrófono'
                  : powerMode === 'pause'
                    ? 'Detener respuesta'
                    : 'Terminar práctica'}
              </span>
            </button>
          </div>

          <p className="voice-instruction">
            Mantén pulsado para hablar y suelta para enviar. Cada intervención puede durar hasta 60 segundos.
          </p>

          <div
            aria-label={`Señal de audio: ${isPlayingAudio ? 'salida' : 'entrada'}`}
            className="voice-signal"
            role="img"
          >
            <span className="voice-signal-label">{isPlayingAudio ? 'respuesta' : 'tu voz'}</span>
            {Array.from({ length: 18 }, (_, index) => {
              const level = isPlayingAudio ? outputLevel : inputLevel;
              const centerWeight = 0.45 + 0.55 * (1 - Math.abs(index - 8.5) / 8.5);
              const scale = Math.max(0.14, Math.min(1, 0.14 + level * centerWeight * 0.86));
              return (
                <span
                  aria-hidden="true"
                  className="voice-signal-bar"
                  key={index}
                  style={{ transform: `scaleY(${scale})` }}
                />
              );
            })}
          </div>

          {errorMessage && <p className="voice-error" role="alert">{errorMessage}</p>}

          <div className="voice-ptt-wrap">
              <button
                type="button"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  void startRecording();
                }}
                onPointerUp={(event) => {
                  stopRecording();
                  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
                onPointerCancel={stopRecording}
                onLostPointerCapture={stopRecording}
                onKeyDown={(event) => {
                  if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) {
                    event.preventDefault();
                    void startRecording();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    stopRecording();
                  }
                }}
                disabled={state !== 'ready' && state !== 'recording'}
                className={`voice-ptt ${
                  state === 'recording' ? 'is-recording' : state === 'ready' ? 'is-ready' : ''
                }`}
              >
                {state === 'recording' && !isTapRecording
                  ? 'Grabando… suelta para enviar'
                  : 'Mantén pulsado para hablar'}
              </button>
              <button
                className="voice-tap-toggle"
                disabled={state !== 'ready' && state !== 'recording'}
                onClick={() => {
                  if (state === 'recording') stopRecording();
                  else void startRecording(true);
                }}
                type="button"
              >
                {state === 'recording' && isTapRecording ? 'Toca para enviar' : 'O toca para empezar'}
              </button>
            </div>
        </div>

        <div className="voice-pane voice-pane-session">
          <div className="voice-workspace">
            <section className="voice-panel" aria-labelledby="voice-conversation-title">
              <div className="voice-pane-tabs" aria-hidden="true">
                <span className="voice-pane-tab is-active">Conversación</span>
              </div>
              <div className="voice-panel-body">
                <h2 className="sr-only" id="voice-conversation-title">Conversación</h2>
                <div className="voice-scroll">
                  {turnHistory.length === 0 && !userTranscript && !isAssistantStreaming && (
                    <p className="voice-empty">Activa el micrófono y cuéntame algo de tu día. La conversación aparecerá aquí.</p>
                  )}
                  {turnHistory.map((turn, index) => (
                    <div className="voice-turn" key={turn.turnId || `turn-${index}`}>
                      <div className="voice-message user"><strong>Tú</strong>{turn.userText}</div>
                      <div className="voice-message assistant"><strong>Tutor</strong>{turn.assistantText}</div>
                    </div>
                  ))}
                  {userTranscript && <div className="voice-message user"><strong>Tú</strong>{userTranscript}</div>}
                  {isAssistantStreaming && (
                    <div className="voice-message assistant"><strong>Tutor</strong>{streamingAssistant || 'Preparando una respuesta…'}</div>
                  )}
                </div>
              </div>
            </section>

            <section className="voice-panel" aria-labelledby="voice-feedback-title">
              <div className="voice-pane-tabs" aria-hidden="true">
                <span className="voice-pane-tab is-active">Tu mejora</span>
              </div>
              <div className="voice-panel-body">
                <h2 className="sr-only" id="voice-feedback-title">Feedback</h2>
                {isFeedbackPending && (
                  <div className="voice-panel-status-banner">
                    <span className="voice-panel-status">Preparando tu recomendación</span>
                  </div>
                )}
                <div className="voice-scroll">
                  {feedbackErrorMsg && <p className="voice-error" role="alert">{feedbackErrorMsg}</p>}
                  {activeFeedback ? (
                    <>
                      <div className="voice-feedback-block">
                        <h3 className="voice-feedback-heading">Resumen</h3>
                        <p className="voice-feedback-summary">{activeFeedback.summary_es}</p>
                      </div>
                      {activeFeedback.corrections.length > 0 && (
                        <div className="voice-feedback-block">
                          <h3 className="voice-feedback-heading">Tu mejora prioritaria</h3>
                          {activeFeedback.corrections.slice(0, 1).map((correction, index) => (
                            <div className="voice-feedback-item" key={`corr-${index}-${correction.original}`}>
                              <del>{correction.original}</del>
                              <ins>{correction.corrected}</ins>
                              <details>
                                <summary>Ver explicación</summary>
                                <em>{correction.explanation_es}</em>
                              </details>
                            </div>
                          ))}
                        </div>
                      )}
                      {activeFeedback.vocabulary.length > 0 && (
                        <div className="voice-feedback-block">
                          <h3 className="voice-feedback-heading">Vocabulario sólido · {activeFeedback.vocabulary.length}</h3>
                          {activeFeedback.vocabulary.map((vocabulary, index) => (
                            <div className="voice-feedback-summary" key={`vocab-${index}-${vocabulary.term}`}>
                              <strong>{vocabulary.term}</strong><br />
                              {vocabulary.meaning_es}<br />
                              <em>{vocabulary.example_en}</em>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="voice-empty">Después de hablar verás un resumen, correcciones y vocabulario útil. La conversación puede continuar aunque el feedback tarde un poco más.</p>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
