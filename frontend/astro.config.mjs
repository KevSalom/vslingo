// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';

/** @returns {any} */
function serveVadStaticPlugin() {
  return {
    name: 'serve-vad-static',
    /** @param {any} server */
    configureServer(server) {
      server.middlewares.use(
        /**
         * @param {import('node:http').IncomingMessage} req
         * @param {import('node:http').ServerResponse} res
         * @param {() => void} next
         */
        (req, res, next) => {
          if (req.url && req.url.startsWith('/vad/')) {
            const cleanUrl = req.url.split('?')[0];
            const filePath = path.resolve('./public', cleanUrl.slice(1));
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              const ext = path.extname(filePath);
              if (ext === '.mjs' || ext === '.js') {
                res.setHeader('Content-Type', 'application/javascript');
              } else if (ext === '.wasm') {
                res.setHeader('Content-Type', 'application/wasm');
              } else if (ext === '.onnx') {
                res.setHeader('Content-Type', 'application/octet-stream');
              }
              res.end(fs.readFileSync(filePath));
              return;
            }
          }
          next();
        }
      );
    },
  };
}

export default defineConfig({
  output: 'static',
  // En producción SITE_URL es obligatorio para emitir canonical y OG correctos.
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  integrations: [react()],
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Sora',
      cssVariable: '--font-sora',
      weights: ['100 800'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Arial', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'IBM Plex Sans',
      cssVariable: '--font-ibm-plex-sans',
      weights: [400, 500, 600],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Arial', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains-mono',
      weights: [400, 500],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Consolas', 'monospace'],
    },
  ],
  vite: {
    plugins: [serveVadStaticPlugin(), tailwindcss()],
    // Prebundle VAD + ORT so dynamic import does not 504 "Outdated Optimize Dep"
    // after HMR/dep re-optimization (breaks hands-free mic in dev).
    optimizeDeps: {
      include: [
        '@ricky0123/vad-web',
        'onnxruntime-web',
        'onnxruntime-web/wasm',
      ],
    },
    server: {
      // Keep optimized dep URLs stable for long-running `astro dev` sessions.
      warmup: {
        clientFiles: ['./src/features/voice/vadClient.ts'],
      },
    },
  },
});
