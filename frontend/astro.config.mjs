// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/** @returns {import('vite').Plugin} */
function serveVadStaticPlugin() {
  return {
    name: 'serve-vad-static',
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
  integrations: [react()],
  vite: {
    plugins: [serveVadStaticPlugin(), tailwindcss()],
  },
});
