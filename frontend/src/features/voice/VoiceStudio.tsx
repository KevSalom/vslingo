import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioRecorder } from './audioCapture';
import type { ErrorMessage, ScenarioType, SpeechProviderType } from './protocol';
import { VoiceSocketClient } from './voiceSocket';

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
  const [scenario, setScenario] = useState<ScenarioType>('daily_standup');
  const [speechProvider, setSpeechProvider] = useState<SpeechProviderType>('aws_polly');
  const [generation, setGeneration] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<VoiceSocketClient | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const currentTurnIdRef = useRef<string | null>(null);

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
            break;
          case 'session.configured':
            setScenario(msg.scenario);
            setSpeechProvider(msg.speech_provider);
            break;
          case 'transcript.final':
            setTranscript(msg.text);
            setState('ready');
            break;
          case 'response.cancelled':
            setState('ready');
            break;
          case 'error':
            handleServerError(msg);
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

  const startRecording = useCallback(async () => {
    if (state !== 'ready' || !socketRef.current) return;

    try {
      const turnId = crypto.randomUUID();
      currentTurnIdRef.current = turnId;
      const nextGeneration = generation + 1;

      // Send speech.started
      socketRef.current.sendMessage({
        type: 'speech.started',
        turn_id: turnId,
        generation: nextGeneration,
      });
      setGeneration(nextGeneration);

      // Start audio recorder
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
        // Audio too short or empty -> cancel turn
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

      // Send utterance.begin
      socketRef.current.sendMessage({
        type: 'utterance.begin',
        turn_id: turnId,
        generation: currentGen,
        media_type: 'audio/wav',
        byte_length: wavBytes.length,
        duration_ms: Math.max(100, Math.min(60000, durationMs)),
      });

      // Send binary frame
      socketRef.current.sendBinary(wavBytes);
    } catch (err) {
      console.error('Error stopping recording:', err);
      setErrorMessage('Error procesando la grabación de audio.');
      setState('ready');
    }
  }, [state, generation]);

  // Clean up on unmount
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
    <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto p-6 bg-slate-900/90 text-slate-100 rounded-2xl border border-slate-800 shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              Voice Studio — Push To Talk
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              {scenario}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Práctica de pronunciación y conversación fluida con feedback en tiempo real.
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
            {state === 'connecting' && 'Conectando con el servidor...'}
            {state === 'ready' && 'Listo para hablar'}
            {state === 'recording' && 'Grabando audio (PTT)...'}
            {state === 'transcribing' && 'Transcribiendo respuesta...'}
            {state === 'error' && 'Error de conexión'}
            {state === 'closed' && 'Conexión cerrada'}
          </span>
        </div>
        {state === 'ready' && (
          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
            <span>Proveedor: {speechProvider}</span>
            <span>Generación: {generation}</span>
          </div>
        )}
      </div>

      {/* Error notification */}
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

      {/* Main PTT Interactive Area */}
      <div className="flex flex-col items-center justify-center p-8 bg-slate-950/40 rounded-2xl border border-slate-800/50 min-h-[220px] gap-6">
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
          className={`relative group flex flex-col items-center justify-center w-36 h-36 rounded-full transition-all duration-300 shadow-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/50 ${
            state === 'recording'
              ? 'bg-gradient-to-tr from-red-600 to-amber-500 scale-105 shadow-red-500/40 ring-4 ring-red-500/30'
              : state === 'ready'
              ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 hover:scale-105 shadow-blue-600/30 hover:shadow-indigo-500/50'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
          }`}
          aria-label="Mantén pulsado para hablar"
        >
          <svg
            className={`w-12 h-12 transition-transform duration-200 ${
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
          <span className="text-xs font-semibold text-white/90 mt-2 px-2 text-center">
            {state === 'recording' ? 'Soltar para enviar' : 'Mantén presionado'}
          </span>
        </button>

        <p className="text-xs text-slate-400 text-center max-w-sm">
          Mantén pulsado el botón o la barra espaciadora para grabar tu mensaje de voz. El audio se procesará automáticamente al soltar.
        </p>
      </div>

      {/* Transcript Display Section */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Transcripción Final (STT)
        </h3>
        <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl min-h-[80px] flex items-center">
          {transcript ? (
            <p className="text-slate-100 font-medium text-base leading-relaxed">
              "{transcript}"
            </p>
          ) : (
            <p className="text-slate-500 text-sm italic">
              Aún no hay transcripción. Mantén presionado para hablar y verás tu texto aquí.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
