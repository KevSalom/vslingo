/**
 * VAD (Voice Activity Detection) Client loading @ricky0123/vad-web dynamically
 * with Silero VAD local ONNX assets.
 */

export interface VadClientOptions {
  onSpeechStart: () => void;
  onSpeechEnd: (wavBytes: Uint8Array, durationMs: number) => void;
  onSpeechCancel: () => void;
  onFrameLevel?: (level: number) => void;
  onError: (error: Error) => void;
}

export interface VadController {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
}

export async function createVadClient(options: VadClientOptions): Promise<VadController> {
  try {
    const vadModule = await import('@ricky0123/vad-web');

    const micVAD = await vadModule.MicVAD.new({
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      model: 'v5',
      onFrameProcessed: (_probabilities: unknown, frame: Float32Array) => {
        if (!options.onFrameLevel) return;
        let squareSum = 0;
        for (const sample of frame) squareSum += sample * sample;
        const rms = frame.length > 0 ? Math.sqrt(squareSum / frame.length) : 0;
        options.onFrameLevel(Math.min(1, rms * 8));
      },
      onSpeechStart: () => {
        options.onSpeechStart();
      },
      onVADMisfire: () => {
        options.onSpeechCancel();
      },
      onSpeechEnd: (audioFloat32: Float32Array) => {
        const sampleRate = 16000;
        const durationMs = Math.round((audioFloat32.length / sampleRate) * 1000);

        if (durationMs < 100 || durationMs > 60000 || audioFloat32.length === 0) {
          options.onSpeechCancel();
          return;
        }

        try {
          const pcm16 = floatTo16BitPCM(audioFloat32);
          const wavBytes = encodeWavPCM16kMono(pcm16);
          options.onSpeechEnd(wavBytes, durationMs);
        } catch {
          options.onSpeechCancel();
        }
      },
    });


    return {
      start: async () => {
        await micVAD.start();
      },
      pause: async () => {
        await micVAD.pause();
      },
      destroy: async () => {
        await micVAD.destroy();
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    options.onError(error);
    throw error;
  }
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function encodeWavPCM16kMono(pcm16Samples: Int16Array): Uint8Array {
  const numChannels = 1;
  const sampleRate = 16000;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm16Samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const uint8View = new Uint8Array(buffer, 44);
  for (let i = 0; i < pcm16Samples.length; i++) {
    const sample = pcm16Samples[i];
    uint8View[i * 2] = sample & 0xff;
    uint8View[i * 2 + 1] = (sample >> 8) & 0xff;
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
