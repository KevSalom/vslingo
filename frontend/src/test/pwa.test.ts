import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('public/app.webmanifest', 'utf8')) as {
  name: string;
  start_url: string;
  display: string;
  icons: Array<{ purpose: string; sizes: string; type: string }>;
};
const worker = readFileSync('public/sw.js', 'utf8');
const offline = readFileSync('public/offline.html', 'utf8');
const pwaHead = readFileSync('src/components/PwaHead.astro', 'utf8');
const renderBlueprint = readFileSync('../render.yaml', 'utf8');

describe('PWA shell', () => {
  it('declares a standalone install with branded icon and practice destination', () => {
    expect(manifest.name).toBe('Inglés al Grano');
    expect(manifest.start_url).toContain('/app/hablar');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('publishes the manifest with its registered media type', () => {
    expect(pwaHead).toContain('type="application/manifest+json"');
    expect(renderBlueprint).toContain('path: /app.webmanifest');
    expect(renderBlueprint).toContain('value: application/manifest+json');
  });

  it('never caches API, audio or video and falls back to an honest offline page', () => {
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("['audio', 'video'].includes(request.destination)");
    expect(worker).toContain("cache: 'no-store'");
    expect(worker).not.toContain('sync');
    expect(offline).toContain('No ponemos voz, correcciones ni pagos en una cola oculta');
  });
});
