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

  const socketRef = useRef<VoiceSocketClient | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const schedulerRef = useRef<AudioScheduler | null>(null);
  const vadControllerRef = useRef<VadController | null>(null);
  const pendingAudioRef = useRef<{ begin: AudioBeginMessage; received: boolean } | null>(null);
  const nextAudioIndexRef = useRef(0);
  const configRevisionRef = useRef(0);
  const captureOwnerRef = useRef<'vad' | 'ptt' | null>(null);
  const sessionTokenRef = useRef(0);

  const currentTurnIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const accumulatedAssistantRef = useRef('');
  const userTranscriptRef = useRef('');
  const scenarioRef = useRef<ScenarioType>(scenario);
  const speechProviderRef = useRef<SpeechProviderType>(speechProvider);

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
    if (!isPlayingAudio) {
      setOutputLevel(0);
      return;
    }
    const analyser = schedulerRef.current?.getAnalyserNode();
    if (!analyser) return;

    const samples = new Uint8Array(analyser.frequencyBinCount);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let animationFrame = 0;
    const updateLevel = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      setOutputLevel(Math.min(1, peak * 2));
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
    setGeneration(nextGeneration);
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
        onPlaybackStart: () => setIsPlayingAudio(true),
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
                    beginTurn();
                    setInputState('speech');
                  },
                  onSpeechEnd: (wavBytes, durationMs) => {
                    if (captureOwnerRef.current !== 'vad') return;
                    captureOwnerRef.current = null;
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
                    cancelCurrentTurn();
                    setInputState('listening');
                  },
                  onFrameLevel: (level) => {
                    const reducedMotion =
                      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
                    setInputLevel(reducedMotion ? (level > 0.05 ? 0.45 : 0) : level);
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
            setTurnHistory((prev) => {
              const updated = [
                ...prev,
                {
                  turnId: msg.turn_id,
                  userText: userTranscriptRef.current,
                  assistantText: msg.text,
                },
              ];
              return updated.slice(-6);
            });
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
      setInputState('speech');
    } catch (err) {
      recorder.cleanup();
      if (recorderRef.current === recorder) recorderRef.current = null;
      captureOwnerRef.current = null;
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
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto p-6 bg-slate-900/90 text-slate-100 rounded-2xl border border-slate-800 shadow-2xl backdrop-blur-md">
      {/* Accessible Live Region */}
      <div className="sr-only" aria-live="polite">
        {ACCESSIBLE_INPUT_LABELS[inputState]} {isPlayingAudio ? '— Respondiendo' : ''}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              Voice Studio — Hands-free & Feedback
            </h2>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Detección de voz (VAD) interactiva, síntesis fluida por oraciones e interrupción inmediata.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isPlayingAudio && (
            <button
              onClick={handleStopPlayback}
              className="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-xs font-semibold rounded-lg text-white transition-all shadow-md"
            >
              Detener respuesta
            </button>
          )}

          {state === 'idle' || state === 'closed' ? (
            <button
              onClick={handleConnect}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-sm font-semibold rounded-xl text-white transition-all shadow-lg shadow-blue-500/20"
            >
              Iniciar Sesión
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold rounded-xl text-slate-300 transition-all"
            >
              Finalizar Sesión
            </button>
          )}
        </div>
      </div>

      {/* Scenario Selector & Status Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Escenario:
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((key) => (
              <button
                key={key}
                onClick={() => handleScenarioChange(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  scenario === key
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {SCENARIO_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <SpeechProviderControl
            id="voice-speech-provider"
            provider={speechProvider}
            onChange={handleSpeechProviderChange}
            disabled={state === 'connecting'}
          />
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                state === 'ready' || state === 'recording' || state === 'transcribing'
                  ? 'bg-emerald-400 animate-pulse'
                  : state === 'connecting'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-slate-600'
              }`}
            />
            <span className="text-xs font-medium text-slate-300">
              {ACCESSIBLE_INPUT_LABELS[inputState]}
            </span>
          </div>
        </div>
      </div>

      {/* Hands-Free VAD Active Banner */}
      {(inputState === 'vad_ready' || inputState === 'listening' || inputState === 'speech') && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <span>✨ <strong>Modo Manos Libres Activo:</strong> Solo habla a tu micrófono. La aplicación detectará automáticamente tu voz y responderá cuando hagas una pausa.</span>
        </div>
      )}

      <div
        role="img"
        aria-label={`Nivel de audio ${isPlayingAudio ? 'de salida' : 'de entrada'}`}
        className="flex h-12 items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/60 px-4"
      >
        <span className="mr-2 w-12 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">
          {isPlayingAudio ? 'Salida' : 'Entrada'}
        </span>
        {Array.from({ length: 18 }, (_, index) => {
          const level = isPlayingAudio ? outputLevel : inputLevel;
          const centerWeight = 1 - Math.abs(index - 8.5) / 12;
          const scale = Math.max(0.12, level * centerWeight);
          return (
            <span
              aria-hidden="true"
              className="h-8 flex-1 origin-center rounded-full bg-cyan-400 motion-safe:transition-transform motion-safe:duration-75"
              key={index}
              style={{ transform: `scaleY(${scale})` }}
            />
          );
        })}
      </div>

      {/* Errors */}
      {errorMessage && (
        <div className="p-3 bg-red-950/80 border border-red-800/80 rounded-xl text-red-200 text-sm">
          {errorMessage}
        </div>
      )}

      {/* Main Studio Area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[350px]">
        {/* Left: Conversation Stream */}
        <div className="flex flex-col bg-slate-950/40 p-4 rounded-xl border border-slate-800/60">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 border-b border-slate-800/60 pb-2">
            Conversación en Vivo
          </h3>

          <div className="flex-1 overflow-y-auto space-y-4 max-h-[320px] pr-2">
            {turnHistory.map((t) => (
              <div key={t.turnId} className="space-y-2">
                <div className="bg-slate-800/60 p-3 rounded-lg text-slate-200 text-sm ml-4 border-l-2 border-blue-400">
                  <span className="font-semibold text-blue-400 block text-xs mb-1">Tú</span>
                  {t.userText}
                </div>
                <div className="bg-indigo-950/40 p-3 rounded-lg text-slate-200 text-sm mr-4 border-l-2 border-indigo-400">
                  <span className="font-semibold text-indigo-400 block text-xs mb-1">
                    VSLingo Assistant
                  </span>
                  {t.assistantText}
                </div>
              </div>
            ))}

            {userTranscript && (
              <div className="bg-slate-800/60 p-3 rounded-lg text-slate-200 text-sm ml-4 border-l-2 border-blue-400">
                <span className="font-semibold text-blue-400 block text-xs mb-1">Tú (último)</span>
                {userTranscript}
              </div>
            )}

            {isAssistantStreaming && (
              <div className="bg-indigo-950/40 p-3 rounded-lg text-slate-200 text-sm mr-4 border-l-2 border-indigo-400 animate-pulse">
                <span className="font-semibold text-indigo-400 block text-xs mb-1">
                  Respondiendo...
                </span>
                {streamingAssistant || '...'}
              </div>
            )}
          </div>

          {/* PTT / Manual Control Button */}
          <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
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
              className={`w-full py-3 rounded-xl font-semibold text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
                state === 'recording'
                  ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/20 animate-pulse'
                  : state === 'ready'
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              {state === 'recording'
                ? '🔴 Grabando… Suelta para enviar'
                : '🎙️ Mantén pulsado para hablar (PTT)'}
            </button>
          </div>
        </div>


        {/* Right: Parallel Feedback Cards */}
        <div className="flex flex-col bg-slate-950/40 p-4 rounded-xl border border-slate-800/60">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 border-b border-slate-800/60 pb-2 flex items-center justify-between">
            <span>Feedback en Paralelo</span>
            {isFeedbackPending && (
              <span className="text-xs text-amber-400 animate-pulse font-normal">
                Generando feedback...
              </span>
            )}
          </h3>

          {feedbackErrorMsg && (
            <div className="p-3 bg-amber-950/60 border border-amber-800/60 rounded-lg text-amber-200 text-xs mb-3">
              {feedbackErrorMsg}
            </div>
          )}

          <div className="flex-1 overflow-y-auto max-h-[320px] pr-2 space-y-4">
            {activeFeedback ? (
              <>
                <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Resumen
                  </h4>
                  <p className="text-sm text-slate-200">{activeFeedback.summary_es}</p>
                </div>

                {activeFeedback.corrections.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Correcciones ({activeFeedback.corrections.length})
                    </h4>
                    {activeFeedback.corrections.map((c, i) => (
                      <div key={i} className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
                        <div className="text-red-400 line-through">{c.original}</div>
                        <div className="text-emerald-400 font-semibold">{c.corrected}</div>
                        <div className="text-slate-400 italic">{c.explanation_es}</div>
                      </div>
                    ))}
                  </div>
                )}

                {activeFeedback.vocabulary.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Vocabulario Sólido ({activeFeedback.vocabulary.length})
                    </h4>
                    {activeFeedback.vocabulary.map((v, i) => (
                      <div key={i} className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
                        <div className="text-indigo-300 font-semibold">{v.term}</div>
                        <div className="text-slate-300">{v.meaning_es}</div>
                        <div className="text-slate-400 italic">"{v.example_en}"</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-slate-500 text-sm">
                Habla para recibir correcciones y vocabulario en tiempo real.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
