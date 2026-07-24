import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicVadDir = path.resolve(__dirname, '../public/vad');
const vadDist = path.resolve(__dirname, '../node_modules/@ricky0123/vad-web/dist');
const onnxDist = path.resolve(__dirname, '../node_modules/onnxruntime-web/dist');

const requiredAssets = [
  [vadDist, 'silero_vad_v5.onnx'],
  [vadDist, 'vad.worklet.bundle.min.js'],
  [onnxDist, 'ort-wasm-simd-threaded.wasm'],
  [onnxDist, 'ort-wasm-simd-threaded.mjs'],
  [onnxDist, 'ort-wasm-simd-threaded.jsep.wasm'],
  [onnxDist, 'ort-wasm-simd-threaded.jsep.mjs'],
];

fs.mkdirSync(publicVadDir, { recursive: true });

for (const [sourceDirectory, fileName] of requiredAssets) {
  const source = path.join(sourceDirectory, fileName);
  if (!fs.existsSync(source)) {
    throw new Error(`Required VAD asset is missing from the locked dependency: ${source}`);
  }
  fs.copyFileSync(source, path.join(publicVadDir, fileName));
  console.log(`Copied ${fileName} -> public/vad/`);
}
