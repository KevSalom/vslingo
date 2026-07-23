import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioRecorder } from './audioCapture';
import type {
  ErrorMessage,
  ScenarioType,
  SpeechProviderType,
  VoiceFeedback,
} from './protocol';
import { VoiceSocketClient } from './voiceSocket';
import {
  SCENARIO_LABELS,
  loadVoicePreferences,
  saveVoicePreferences,
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
  const [scenario, setScenario] = useState<ScenarioType>(loadVoicePreferences);
  const [speechProvider, setSpeechProvider] = useState<SpeechProviderType>('aws_polly');
  const [generation, setGeneration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Turn states for T06
  const [turnHistory, setTurnHistory] = useState<TurnRecord[]>([]);
  const [userTranscript, setUserTranscript] = useState('');
  const [streamingAssistant, setStreamingAssistant] = useState('');
  const [isAssistantStreaming, setIsAssistantStreaming] = useState(false);
  const [isFeedbackPending, setIsFeedbackPending] = useState(false);
  const [activeFeedback, setActiveFeedback] = useState<VoiceFeedback | null>(null);
  const [feedbackErrorMsg, setFeedbackErrorMsg] = useState<string | null>(null);

  const socketRef = useRef<VoiceSocketClient | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const currentTurnIdRef = useRef<string | null>(null);
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

  const handleConnect = async () => {
    setState('connecting');
    setErrorMessage(null);
    try {
      const client = new VoiceSocketClient();
      socketRef.current = client;

      client.onStatusChange((connected) => {
        if (!connected) {
          setState('closed');
        }
      });

      client.onMessage((msg) => {
        switch (msg.type) {
          case 'session.ready':
            setGeneration(msg.generation);
            setState('ready');
            // Send initial config with latest scenarioRef
            client.sendMessage({
              type: 'session.config',
              scenario: scenarioRef.current,
              speech_provider: speechProviderRef.current,
            });
            break;

          case 'session.configured':
            setScenario(msg.scenario);
            setSpeechProvider(msg.speech_provider);
            setTurnHistory([]);
            setUserTranscript('');
            setStreamingAssistant('');
            setActiveFeedback(null);
            setFeedbackErrorMsg(null);
            break;

          case 'transcript.final':
            setUserTranscript(msg.text);
            userTranscriptRef.current = msg.text;
            setIsAssistantStreaming(true);
            setIsFeedbackPending(true);
            setStreamingAssistant('');
            accumulatedAssistantRef.current = '';
            setActiveFeedback(null);
            setFeedbackErrorMsg(null);
            setState('ready');
            break;

          case 'assistant.delta':
            accumulatedAssistantRef.current += msg.delta;
            setStreamingAssistant(accumulatedAssistantRef.current);
            break;

          case 'assistant.done':
            setIsAssistantStreaming(false);
            setStreamingAssistant(msg.text);
            // Append to turn history (max 6 pairs)
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

          case 'feedback.ready':
            setIsFeedbackPending(false);
            setActiveFeedback(msg.feedback);
            // Attach feedback to the latest turn record in history if matching turn_id
            setTurnHistory((prev) =>
              prev.map((t) => (t.turnId === msg.turn_id ? { ...t, feedback: msg.feedback } : t))
            );
            break;

          case 'response.cancelled':
            setIsAssistantStreaming(false);
            setIsFeedbackPending(false);
            setState('ready');
            break;

          case 'error':
            if (msg.code === 'feedback_unavailable') {
              setIsFeedbackPending(false);
              setFeedbackErrorMsg('La conversación continúa, pero el feedback no está disponible.');
            } else if (msg.code === 'conversation_unavailable') {
              setIsAssistantStreaming(false);
              setIsFeedbackPending(false);
              setErrorMessage('La conversación no está disponible.');
            } else {
              setIsAssistantStreaming(false);
              setIsFeedbackPending(false);
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
    }
  };

  const handleDisconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.cleanup();
      recorderRef.current = null;
    }
    setState('idle');
  };

  const handleServerError = (msg: ErrorMessage) => {
    setErrorMessage(`Error [${msg.code}]: ${msg.message}`);
    if (msg.fatal) {
      setState('error');
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    } else {
      setState('ready');
    }
  };

  const handleScenarioChange = (newScenario: ScenarioType) => {
    scenarioRef.current = newScenario;
    setScenario(newScenario);
    saveVoicePreferences(newScenario);

    if (socketRef.current && state === 'ready') {
      socketRef.current.sendMessage({
        type: 'session.config',
        scenario: newScenario,
        speech_provider: speechProviderRef.current,
      });
    } else {
      setTurnHistory([]);
      setUserTranscript('');
      setStreamingAssistant('');
      setActiveFeedback(null);
      setFeedbackErrorMsg(null);
    }
  };

  const startRecording = useCallback(async () => {
    if (state !== 'ready' || !socketRef.current) return;

    try {
      const turnId = crypto.randomUUID();
      currentTurnIdRef.current = turnId;
      const nextGeneration = generation + 1;

      socketRef.current.sendMessage({
        type: 'speech.started',
        turn_id: turnId,
        generation: nextGeneration,
      });
      setGeneration(nextGeneration);

      const recorder = new AudioRecorder();
      recorderRef.current = recorder;
      await recorder.start();

      setState('recording');
    } catch (err) {
      console.error('Failed to start microphone:', err);
      setErrorMessage('No se pudo acceder al micrófono.');
      setState('ready');
    }
  }, [state, generation]);

  const stopRecording = useCallback(() => {
    if (state !== 'recording' || !recorderRef.current || !socketRef.current) return;

    try {
      const turnId = currentTurnIdRef.current;
      const currentGen = generation;
      const { wavBytes, durationMs } = recorderRef.current.stop();
      recorderRef.current = null;

      if (!turnId || durationMs < 100 || wavBytes.length <= 44) {
        if (turnId) {
          socketRef.current.sendMessage({
            type: 'response.cancel',
            turn_id: turnId,
            generation: currentGen,
          });
        }
        setState('ready');
        return;
      }

      setState('transcribing');

      socketRef.current.sendMessage({
        type: 'utterance.begin',
        turn_id: turnId,
        generation: currentGen,
        media_type: 'audio/wav',
        byte_length: wavBytes.length,
        duration_ms: Math.max(100, Math.min(60000, durationMs)),
      });

      socketRef.current.sendBinary(wavBytes);
    } catch (err) {
      console.error('Error stopping recording:', err);
      setErrorMessage('Error procesando la grabación de audio.');
      setState('ready');
    }
  }, [state, generation]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (recorderRef.current) {
        recorderRef.current.cleanup();
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto p-6 bg-slate-900/90 text-slate-100 rounded-2xl border border-slate-800 shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              Voice Studio — Practice & Feedback
            </h2>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Conversación fluida B1-B2 con respuestas en streaming y feedback en paralelo.
          </p>
        </div>
        <div>
          {state === 'idle' || state === 'closed' || state === 'error' ? (
            <button
              onClick={handleConnect}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-indigo-600/20 active:scale-95"
            >
              Conectar Voice Studio
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-all duration-200 border border-slate-700 active:scale-95"
            >
              Desconectar
            </button>
          )}
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Escenario de Conversación
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((scKey) => {
            const isSelected = scenario === scKey;
            return (
              <button
                key={scKey}
                type="button"
                aria-pressed={isSelected}
                disabled={isAssistantStreaming || isFeedbackPending || state === 'recording'}
                onClick={() => handleScenarioChange(scKey)}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all duration-200 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-600/40 ring-1 ring-indigo-400 font-bold'
                    : 'bg-slate-950/80 text-slate-400 border-slate-800/80 hover:bg-slate-800 hover:text-slate-200'
                } ${
                  isAssistantStreaming || isFeedbackPending || state === 'recording'
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                {SCENARIO_LABELS[scKey]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Status Bar */}
      <div
        aria-live="polite"
        className="flex items-center justify-between px-4 py-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-sm"
      >
        <div className="flex items-center gap-3">
          <span
            className={`w-3 h-3 rounded-full ${
              state === 'ready'
                ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50 animate-pulse'
                : state === 'recording'
                ? 'bg-red-500 shadow-lg shadow-red-500/50 animate-ping'
                : state === 'transcribing'
                ? 'bg-amber-400 shadow-lg shadow-amber-400/50 animate-pulse'
                : state === 'connecting'
                ? 'bg-blue-400 animate-spin'
                : 'bg-slate-600'
            }`}
          />
          <span className="capitalize font-medium text-slate-200">
            {state === 'idle' && 'Desconectado'}
            {state === 'connecting' && 'Conectando...'}
            {state === 'ready' && 'Listo para hablar'}
            {state === 'recording' && 'Grabando audio (PTT)...'}
            {state === 'transcribing' && 'Procesando transcripción...'}
            {state === 'error' && 'Error de conexión'}
            {state === 'closed' && 'Conexión cerrada'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isAssistantStreaming && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-blue-950 text-blue-300 border border-blue-800 animate-pulse">
              Generando respuesta...
            </span>
          )}
          {isFeedbackPending && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-purple-950 text-purple-300 border border-purple-800 animate-pulse">
              Analizando tu inglés...
            </span>
          )}
        </div>
      </div>

      {/* Error Notifications */}
      {errorMessage && (
        <div className="p-4 bg-red-950/50 border border-red-800/80 rounded-xl text-red-200 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-xs text-red-400 hover:text-red-200 underline ml-4"
          >
            Descartar
          </button>
        </div>
      )}

      {feedbackErrorMsg && (
        <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-300 text-xs flex items-center justify-between">
          <span>{feedbackErrorMsg}</span>
          <button
            onClick={() => setFeedbackErrorMsg(null)}
            className="text-xs text-amber-400 hover:text-amber-200 underline ml-4"
          >
            Descartar
          </button>
        </div>
      )}

      {/* Main PTT Button */}
      <div className="flex flex-col items-center justify-center p-6 bg-slate-950/40 rounded-2xl border border-slate-800/50 min-h-[180px] gap-4">
        <button
          disabled={state !== 'ready' && state !== 'recording'}
          onPointerDown={startRecording}
          onPointerUp={stopRecording}
          onPointerCancel={stopRecording}
          onKeyDown={(e) => {
            if ((e.code === 'Space' || e.code === 'Enter') && state === 'ready') {
              e.preventDefault();
              void startRecording();
            }
          }}
          onKeyUp={(e) => {
            if ((e.code === 'Space' || e.code === 'Enter') && state === 'recording') {
              e.preventDefault();
              stopRecording();
            }
          }}
          className={`relative group flex flex-col items-center justify-center w-32 h-32 rounded-full transition-all duration-300 shadow-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/50 ${
            state === 'recording'
              ? 'bg-gradient-to-tr from-red-600 to-amber-500 scale-105 shadow-red-500/40 ring-4 ring-red-500/30'
              : state === 'ready'
              ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 hover:scale-105 shadow-blue-600/30 hover:shadow-indigo-500/50'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
          }`}
          aria-label="Mantén pulsado para hablar"
        >
          <svg
            className={`w-10 h-10 transition-transform duration-200 ${
              state === 'recording' ? 'scale-110 text-white animate-bounce' : 'text-white'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
          <span className="text-xs font-semibold text-white/90 mt-1 px-2 text-center">
            {state === 'recording' ? 'Soltar para enviar' : 'Mantén presionado'}
          </span>
        </button>
      </div>

      {/* Current Turn Area */}
      {(userTranscript || streamingAssistant) && (
        <div className="flex flex-col gap-4 p-5 bg-slate-950/80 border border-slate-800 rounded-2xl">
          {/* User Transcript */}
          {userTranscript && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                Tú (Transcripción STT):
              </span>
              <p className="text-slate-100 font-medium text-base">"{userTranscript}"</p>
            </div>
          )}

          {/* Assistant Response Streaming */}
          {streamingAssistant && (
            <div className="flex flex-col gap-1 pt-3 border-t border-slate-800/80">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                Asistente (VSLingo):
                {isAssistantStreaming && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                )}
              </span>
              <p
                aria-live="polite"
                className="text-slate-200 text-base leading-relaxed whitespace-pre-wrap font-sans"
              >
                {streamingAssistant}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Structured Feedback Section */}
      {activeFeedback && (
        <div className="flex flex-col gap-4 p-5 bg-slate-950/90 border border-purple-900/50 rounded-2xl shadow-xl">
          <h3 className="text-sm font-bold text-purple-300 uppercase tracking-wider flex items-center gap-2">
            <span>✨ Feedback Estructurado</span>
          </h3>

          {/* Summary & Strengths */}
          <div className="p-4 bg-purple-950/30 border border-purple-900/40 rounded-xl flex flex-col gap-2">
            <p className="text-purple-100 text-sm font-medium">{activeFeedback.summary_es}</p>
            {activeFeedback.strengths.length > 0 && (
              <ul className="list-disc list-inside text-xs text-purple-200/90 space-y-1 mt-1">
                {activeFeedback.strengths.map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Corrections (Diffs) */}
          {activeFeedback.corrections.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-slate-300 uppercase">Cambios Sugeridos</h4>
              <div className="grid grid-cols-1 gap-2">
                {activeFeedback.corrections.map((corr, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-mono">
                      <span>Categoría: {corr.category}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="text-red-400 line-through">- {corr.original}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-emerald-400 font-semibold">+ {corr.corrected}</span>
                    </div>
                    <p className="text-slate-300 text-xs mt-0.5">{corr.explanation_es}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vocabulary */}
          {activeFeedback.vocabulary.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-slate-300 uppercase">Vocabulario Sugerido</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {activeFeedback.vocabulary.map((vocab, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs flex flex-col gap-1"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold text-indigo-300 text-sm">{vocab.term}</span>
                      <span className="text-slate-400 text-xs">{vocab.meaning_es}</span>
                    </div>
                    <p className="text-slate-300 text-xs italic">"{vocab.example_en}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History of Past Turns */}
      {turnHistory.length > 1 && (
        <div className="flex flex-col gap-3 pt-4 border-t border-slate-800/80">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Historial de Conversación (Últimos Turnos)
          </h3>
          <div className="flex flex-col gap-3">
            {turnHistory.slice(0, -1).map((turn, i) => (
              <div key={i} className="p-3 bg-slate-950/40 border border-slate-800/60 rounded-xl text-xs flex flex-col gap-1.5">
                <p className="text-indigo-300 font-medium">Tú: "{turn.userText}"</p>
                <p className="text-slate-200">VSLingo: "{turn.assistantText}"</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
