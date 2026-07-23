import { describe, expect, it } from 'vitest';
import { encodeWav, resampleTo16k } from './audioCapture';

describe('audioCapture encoder and resampler', () => {
  it('resamples 48kHz audio to 16kHz', () => {
    const input48k = new Float32Array(48000); // 1 second at 48kHz
    const resampled = resampleTo16k(input48k, 48000);
    expect(resampled.length).toBe(16000);
  });

  it('keeps 16kHz audio unchanged', () => {
    const input16k = new Float32Array(16000);
    const resampled = resampleTo16k(input16k, 16000);
    expect(resampled.length).toBe(16000);
    expect(resampled).toBe(input16k);
  });

  it('encodes synthetic samples to valid 44-byte header WAV PCM 16kHz mono', () => {
    const samples = new Float32Array(16000); // 1 second
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((i / 16000) * 440 * 2 * Math.PI); // 440Hz tone
    }

    const wavBytes = encodeWav(samples, 16000);
    expect(wavBytes.length).toBe(44 + 32000); // 44 header + 32000 pcm bytes

    const view = new DataView(wavBytes.buffer);

    // RIFF check
    const riff = String.fromCharCode(
      wavBytes[0],
      wavBytes[1],
      wavBytes[2],
      wavBytes[3]
    );
    expect(riff).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 32000);

    // WAVE check
    const wave = String.fromCharCode(
      wavBytes[8],
      wavBytes[9],
      wavBytes[10],
      wavBytes[11]
    );
    expect(wave).toBe('WAVE');

    // fmt check
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // 16kHz
    expect(view.getUint16(34, true)).toBe(16); // 16-bit
  });
});
