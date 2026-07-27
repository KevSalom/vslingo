import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechProviderControl } from '../../shared/speech/SpeechProviderControl';
import { loadSpeechProvider, saveSpeechProvider } from '../../shared/speech/storage';
import { AudioRecorder } from './audioCapture';
import { AudioScheduler } from './audioScheduler';
import type {
  AudioBeginMessage,
  ErrorMessage,
  ScenarioType,
  SpeechProviderType,
  VoiceFeedback,
} from './protocol';
import { createVadClient, type VadController } from './vadClient';
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

type SessionMetrics = {
  sttLatencyMs: number | null;
  firstTokenLatencyMs: number | null;
  firstAudioLatencyMs: number | null;
  knownCostUsd: number;
  hasEstimatedCost: boolean;
};

const INITIAL_SESSION_METRICS: SessionMetrics = {
  sttLatencyMs: null,
  firstTokenLatencyMs: null,
  firstAudioLatencyMs: null,
  knownCostUsd: 0,
  hasEstimatedCost: false,
};

export function VoiceStudio() {
  const [state, setState] = useState<VoiceState>('idle');
  const [inputState, setInputState] = useState<InputSubstate>('idle');
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
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics>(INITIAL_SESSION_METRICS);

  const socketRef = useRef<VoiceSocketClient | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const schedulerRef = useRef<AudioScheduler | null>(null);
  const vadControllerRef = useRef<VadController | null>(null);
  const pendingAudioRef = useRef<{ begin: AudioBeginMessage; received: boolean } | null>(null);
  const nextAudioIndexRef = useRef(0);
  const configRevisionRef = useRef(0);
  const captureOwnerRef = useRef<'vad' | 'ptt' | null>(null);
  const sessionTokenRef = useRef(0);
  const firstPlaybackSegmentRef = useRef<{ turnId: string; generation: number; segmentId: string } | null>(null);
  const playbackStartedGenerationRef = useRef<number | null>(null);

  const currentTurnIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const accumulatedAssistantRef = useRef('');
  const userTranscriptRef = useRef('');
  const scenarioRef = useRef<ScenarioType>(scenario);
  const speechProviderRef = useRef<SpeechProviderType>(speechProvider);
  const isPlayingAudioRef = useRef(false);
  /** True only while VAD/PTT reports real speech ("Te escucho"). */
  const speechActiveRef = useRef(false);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(() => {
    speechProviderRef.current = speechProvider;
  }, [speechProvider]);

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
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      const target = Math.min(1, Math.max(0, (peak - 0.04) * 1.6));
      smoothed += (target - smoothed) * (target > smoothed ? 0.45 : 0.2);
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
      void vadControllerRef.current?.start();
      setState('ready');
      setInputState(vadControllerRef.current ? 'listening' : 'fallback_ptt');
    }
    if (!turnId) {
      captureOwnerRef.current = null;
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
    schedulerRef.current?.stopAll();
    setIsAssistantStreaming(false);
    setIsFeedbackPending(false);
    setIsPlayingAudio(false);
    if (message) setErrorMessage(message);
  }, []);

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
    firstPlaybackSegmentRef.current = null;
    playbackStartedGenerationRef.current = null;
    setGeneration(nextGeneration);
    setUserTranscript('');
    userTranscriptRef.current = '';
    setStreamingAssistant('');
    accumulatedAssistantRef.current = '';
    schedulerRef.current?.cancelBefore(nextGeneration);

    schedulerRef.current?.stopAll();
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

  const cleanupLocalResources = useCallback(() => {
    sessionTokenRef.current += 1;
    captureOwnerRef.current = null;
    pendingAudioRef.current = null;
    if (recorderRef.current) {
      recorderRef.current.cleanup();
      recorderRef.current = null;
    }
    if (vadControllerRef.current) {
      void vadControllerRef.current.destroy();
      vadControllerRef.current = null;
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
    setInputState('initializing_vad');
    setErrorMessage(null);
    try {
      const scheduler = new AudioScheduler({
        onPlaybackStart: () => {
          setIsPlayingAudio(true);
          const playback = firstPlaybackSegmentRef.current;
          if (
            playback &&
            playback.generation === generationRef.current &&
            playbackStartedGenerationRef.current !== playback.generation
          ) {
            playbackStartedGenerationRef.current = playback.generation;
            socketRef.current?.sendMessage({
              type: 'playback.started',
              turn_id: playback.turnId,
              generation: playback.generation,
              segment_id: playback.segmentId,
            });
          }
        },
        onIdle: () => setIsPlayingAudio(false),
        onError: (err) => console.warn('Audio scheduler error:', err),
      });
      schedulerRef.current = scheduler;

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
            setInputState('initializing_vad');

            client.sendMessage({
              type: 'session.config',
              scenario: scenarioRef.current,
              speech_provider: speechProviderRef.current,
            });

            const sessionToken = ++sessionTokenRef.current;
            void (async () => {
              try {
                const vad = await createVadClient({
                  onSpeechStart: () => {
                    if (captureOwnerRef.current === 'ptt') return;
                    captureOwnerRef.current = 'vad';
                    speechActiveRef.current = true;
                    beginTurn();
                    setInputState('speech');
                  },
                  onSpeechEnd: (wavBytes, durationMs) => {
                    if (captureOwnerRef.current !== 'vad') return;
                    captureOwnerRef.current = null;
                    speechActiveRef.current = false;
                    setInputLevel(0);
                    const turnId = currentTurnIdRef.current;
                    if (!turnId || durationMs < 100 || durationMs > 60000 || wavBytes.length <= 44) {
                      cancelCurrentTurn('No se detectó una frase completa. Inténtalo de nuevo.');
                      setInputState('listening');
                      return;
                    }

                    setInputState('encoding');
                    client.sendMessage({
                      type: 'utterance.begin',
                      turn_id: turnId,
                      generation: generationRef.current,
                      media_type: 'audio/wav',
                      byte_length: wavBytes.length,
                      duration_ms: durationMs,
                    });
                    client.sendBinary(wavBytes);
                  },
                  onSpeechCancel: () => {
                    if (captureOwnerRef.current !== 'vad') return;
                    speechActiveRef.current = false;
                    setInputLevel(0);
                    cancelCurrentTurn();
                    setInputState('listening');
                  },
                  onFrameLevel: (level) => {
                    // Only animate mic while real speech is detected, or assistant TTS later.
                    if (isPlayingAudioRef.current || !speechActiveRef.current) return;
                    const reducedMotion =
                      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
                    setInputLevel(reducedMotion ? (level > 0.12 ? 0.45 : 0) : level);
                  },
                  onError: (err) => {
                    console.warn('VAD failed, reverting to fallback PTT:', err);
                  },
                });

                if (sessionToken !== sessionTokenRef.current || socketRef.current !== client) {
                  await vad.destroy();
                  return;
                }
                vadControllerRef.current = vad;
                await vad.start();
                setInputState('listening');
              } catch (cause) {
                if (sessionToken !== sessionTokenRef.current) return;
                const permissionDenied =
                  cause instanceof DOMException && cause.name === 'NotAllowedError';
                setInputState(permissionDenied ? 'permission_denied' : 'fallback_ptt');
                setErrorMessage(
                  permissionDenied
                    ? 'Permite el acceso al micrófono para usar manos libres. El modo manual sigue disponible.'
                    : 'No se pudo iniciar la detección automática. Usa “Mantén pulsado para hablar”.',
                );
              }
            })();
            break;
          }

          case 'session.configured':
            if (msg.config_revision <= configRevisionRef.current) break;
            configRevisionRef.current = msg.config_revision;
            scenarioRef.current = msg.scenario;
            speechProviderRef.current = msg.speech_provider;
            setScenario(msg.scenario);
            setSpeechProvider(msg.speech_provider);
            saveVoicePreferences(msg.scenario);
            saveSpeechProvider(msg.speech_provider);
            setTurnHistory([]);
            setUserTranscript('');
            setStreamingAssistant('');
            setActiveFeedback(null);
            setFeedbackErrorMsg(null);
            setSessionMetrics(INITIAL_SESSION_METRICS);
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
            setInputState(vadControllerRef.current ? 'listening' : 'fallback_ptt');
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
            break;



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
            if (messageIsCurrent(msg) && msg.segment_index === 0) {
              firstPlaybackSegmentRef.current = {
                turnId: msg.turn_id,
                generation: msg.generation,
                segmentId: msg.segment_id,
              };
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
            break;

          case 'response.cancelled':
            if (msg.generation !== generationRef.current) break;
            if (currentTurnIdRef.current && msg.turn_id !== currentTurnIdRef.current) break;
            if (msg.turn_id === currentTurnIdRef.current) currentTurnIdRef.current = null;
            setIsAssistantStreaming(false);
            setIsFeedbackPending(false);
            setState('ready');
            setInputState(vadControllerRef.current ? 'listening' : 'fallback_ptt');
            break;

          case 'metrics.stage':
            if (!messageIsCurrent(msg)) break;
            setSessionMetrics((previous) => ({
              sttLatencyMs: msg.stage === 'stt_final' ? msg.latency_ms : previous.sttLatencyMs,
              firstTokenLatencyMs:
                msg.stage === 'llm_first_token' ? msg.latency_ms : previous.firstTokenLatencyMs,
              firstAudioLatencyMs:
                msg.stage === 'tts_first_byte' ? msg.latency_ms : previous.firstAudioLatencyMs,
              knownCostUsd: previous.knownCostUsd + (msg.cost_usd ?? 0),
              hasEstimatedCost: previous.hasEstimatedCost || msg.estimated,
            }));
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
            } else if (msg.code === 'speech_unavailable') {
              setErrorMessage('La respuesta hablada se interrumpió, pero el texto permanece disponible.');
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

      await client.connect();
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
    setState('idle');
    setInputState('idle');
  };

  const handleStopPlayback = () => {
    cancelCurrentTurn();
    setInputState('interrupted');
  };

  const handleServerError = (msg: ErrorMessage) => {
    setErrorMessage(`Error [${msg.code}]: ${msg.message}`);
    if (msg.fatal) {
      setState('error');
      setInputState('input_error');
      const client = socketRef.current;
      socketRef.current = null;
      client?.disconnect();
      cleanupLocalResources();
    } else {
      setState('ready');
      setInputState(vadControllerRef.current ? 'listening' : 'fallback_ptt');
    }
  };

  const applyConfiguration = useCallback(
    (newScenario: ScenarioType, newProvider: SpeechProviderType) => {
      scenarioRef.current = newScenario;
      speechProviderRef.current = newProvider;
      setScenario(newScenario);
      setSpeechProvider(newProvider);
      saveVoicePreferences(newScenario);
      saveSpeechProvider(newProvider);

      cancelCurrentTurn();
      socketRef.current?.sendMessage({
        type: 'session.config',
        scenario: newScenario,
        speech_provider: newProvider,
      });
      setTurnHistory([]);
      setUserTranscript('');
      setStreamingAssistant('');
      setActiveFeedback(null);
      setFeedbackErrorMsg(null);
    },
    [cancelCurrentTurn],
  );

  const handleScenarioChange = (newScenario: ScenarioType) => {
    applyConfiguration(newScenario, speechProviderRef.current);
  };

  const handleSpeechProviderChange = (newProvider: SpeechProviderType) => {
    applyConfiguration(scenarioRef.current, newProvider);
  };

  const startRecording = useCallback(async () => {
    if (state !== 'ready' || !socketRef.current || captureOwnerRef.current) return;

    captureOwnerRef.current = 'ptt';
    schedulerRef.current?.stopAll();
    setIsPlayingAudio(false);
    const recorder = new AudioRecorder();
    recorderRef.current = recorder;

    try {
      await vadControllerRef.current?.pause();
      await recorder.start();
      if (captureOwnerRef.current !== 'ptt' || recorderRef.current !== recorder) {
        recorder.cleanup();
        return;
      }
      beginTurn();
      setState('recording');
      speechActiveRef.current = true;
      setInputLevel(0.55);
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
      setInputState('fallback_ptt');
      void vadControllerRef.current?.start();
    }
  }, [beginTurn, state]);

  const stopRecording = useCallback(() => {
    if (captureOwnerRef.current !== 'ptt' || !recorderRef.current || !socketRef.current) return;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    captureOwnerRef.current = null;
    speechActiveRef.current = false;
    setInputLevel(0);
    try {
      const turnId = currentTurnIdRef.current;
      const { wavBytes, durationMs } = recorder.stop();

      if (!turnId || durationMs < 100 || durationMs > 60000 || wavBytes.length <= 44) {
        cancelCurrentTurn('Mantén pulsado al menos un instante y vuelve a hablar.');
        setState('ready');
        setInputState(vadControllerRef.current ? 'listening' : 'fallback_ptt');
        return;
      }

      setState('transcribing');
      setInputState('encoding');
      socketRef.current.sendMessage({
        type: 'utterance.begin',
        turn_id: turnId,
        generation: generationRef.current,
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
    } finally {
      void vadControllerRef.current?.start();
    }
  }, [cancelCurrentTurn]);

  useEffect(() => {
    return () => {
      sessionTokenRef.current += 1;
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
      void vadControllerRef.current?.destroy();
      vadControllerRef.current = null;
      void schedulerRef.current?.close();
      schedulerRef.current = null;
    };
  }, []);

  return (
    <section className="voice-studio" aria-labelledby="voice-title">
      <div className="sr-only" aria-live="polite">
        {ACCESSIBLE_INPUT_LABELS[inputState]} {isPlayingAudio ? '— Respondiendo' : ''}
      </div>

      <header className="voice-header">
        <div>
          <p className="voice-eyebrow">Voice Studio · conversación técnica</p>
          <h1 className="voice-title" id="voice-title" tabIndex={-1}>
            Voice Studio: practica una conversación en inglés
          </h1>
          <p className="voice-intro">
            Elige un contexto, inicia la sesión y habla con naturalidad. VSLingo separa la respuesta de las correcciones para que puedas seguir la conversación y aprender de ella.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isPlayingAudio && (
            <button className="voice-session-action is-stop" onClick={handleStopPlayback} type="button">
              Detener respuesta
            </button>
          )}
          {state === 'idle' || state === 'closed' ? (
            <button className="voice-session-action" onClick={handleConnect} type="button">
              Iniciar Sesión
            </button>
          ) : (
            <button className="voice-session-action is-stop" onClick={handleDisconnect} type="button">
              Finalizar Sesión
            </button>
          )}
        </div>
      </header>

      <section className="voice-setup" aria-label="Preparar práctica de voz">
        <div>
          <p className="voice-setup-label">1 · Elige un escenario</p>
          <div className="voice-scenarios">
            {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((key) => (
              <button
                aria-pressed={scenario === key}
                className="voice-scenario"
                key={key}
                onClick={() => handleScenarioChange(key)}
                type="button"
              >
                {SCENARIO_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="voice-settings">
          <SpeechProviderControl
            id="voice-speech-provider"
            provider={speechProvider}
            onChange={handleSpeechProviderChange}
            disabled={state === 'connecting'}
          />
          <span className="voice-status">
            <span
              aria-hidden="true"
              className={`voice-status-dot ${
                state === 'ready' || state === 'recording' || state === 'transcribing'
                  ? 'is-ready'
                  : state === 'connecting'
                    ? 'is-working'
                    : ''
              }`}
            />
            {ACCESSIBLE_INPUT_LABELS[inputState]}
          </span>
        </div>
      </section>

      {(inputState === 'vad_ready' || inputState === 'listening' || inputState === 'speech') && (
        <p className="voice-vad-notice">
          <strong>Escucha automática activa.</strong> Habla cuando estés listo; VSLingo detecta una pausa antes de responder. Puedes usar pulsar para hablar cuando prefieras controlar el inicio.
        </p>
      )}

      <div
        aria-label={`Señal de audio: ${isPlayingAudio ? 'salida' : 'entrada'}`}
        className="voice-signal"
        role="img"
      >
        <span className="voice-signal-label">{isPlayingAudio ? 'respuesta' : 'tu voz'}</span>
        {Array.from({ length: 22 }, (_, index) => {
          const level = isPlayingAudio ? outputLevel : inputLevel;
          const centerWeight = 0.45 + 0.55 * (1 - Math.abs(index - 10.5) / 10.5);
          // Keep a quiet baseline and use full bar height when level≈1.
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

      <section className="voice-metrics" aria-label="Métricas de sesión">
        <p className="voice-panel-label">Observabilidad local · esta sesión</p>
        <dl className="voice-metrics-grid">
          <div><dt>STT</dt><dd>{sessionMetrics.sttLatencyMs === null ? '—' : `${sessionMetrics.sttLatencyMs} ms`}</dd></div>
          <div><dt>Primer token</dt><dd>{sessionMetrics.firstTokenLatencyMs === null ? '—' : `${sessionMetrics.firstTokenLatencyMs} ms`}</dd></div>
          <div><dt>Primer audio</dt><dd>{sessionMetrics.firstAudioLatencyMs === null ? '—' : `${sessionMetrics.firstAudioLatencyMs} ms`}</dd></div>
          <div><dt>Coste conocido</dt><dd>USD {sessionMetrics.knownCostUsd.toFixed(5)}{sessionMetrics.hasEstimatedCost ? ' · estimado' : ''}</dd></div>
        </dl>
      </section>

      <div className="voice-workspace">
        <section className="voice-panel" aria-labelledby="voice-conversation-title">
          <header className="voice-panel-header">
            <div>
              <p className="voice-panel-label">2 · Conversa</p>
              <h2 className="voice-panel-title" id="voice-conversation-title">Conversación</h2>
            </div>
            <span className="voice-panel-status">{isAssistantStreaming ? 'respondiendo' : 'en espera'}</span>
          </header>
          <div className="voice-scroll">
            {turnHistory.length === 0 && !userTranscript && !isAssistantStreaming && (
              <p className="voice-empty">Inicia una sesión y cuenta cómo va tu trabajo. La conversación aparecerá aquí, en el orden en que sucede.</p>
            )}
            {turnHistory.map((turn) => (
              <div className="voice-turn" key={turn.turnId}>
                <div className="voice-message"><strong>Tú</strong>{turn.userText}</div>
                <div className="voice-message assistant"><strong>VSLingo</strong>{turn.assistantText}</div>
              </div>
            ))}
            {userTranscript && <div className="voice-message"><strong>Tú · último turno</strong>{userTranscript}</div>}
            {isAssistantStreaming && (
              <div className="voice-message assistant"><strong>VSLingo · respondiendo</strong>{streamingAssistant || 'Preparando una respuesta…'}</div>
            )}
          </div>
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
              {state === 'recording'
                ? 'Grabando… suelta para enviar'
                : 'Mantén pulsado para hablar (PTT)'}
            </button>
          </div>
        </section>

        <section className="voice-panel" aria-labelledby="voice-feedback-title">
          <header className="voice-panel-header">
            <div>
              <p className="voice-panel-label">3 · Revisa</p>
              <h2 className="voice-panel-title" id="voice-feedback-title">Feedback</h2>
            </div>
            {isFeedbackPending && <span className="voice-panel-status">preparando feedback</span>}
          </header>
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
                    <h3 className="voice-feedback-heading">Correcciones · {activeFeedback.corrections.length}</h3>
                    {activeFeedback.corrections.map((correction, index) => (
                      <div className="voice-feedback-item" key={index}>
                        <del>{correction.original}</del>
                        <ins>{correction.corrected}</ins>
                        <em>{correction.explanation_es}</em>
                      </div>
                    ))}
                  </div>
                )}
                {activeFeedback.vocabulary.length > 0 && (
                  <div className="voice-feedback-block">
                    <h3 className="voice-feedback-heading">Vocabulario sólido · {activeFeedback.vocabulary.length}</h3>
                    {activeFeedback.vocabulary.map((vocabulary, index) => (
                      <div className="voice-feedback-summary" key={index}>
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
        </section>
      </div>
    </section>
  );
}
