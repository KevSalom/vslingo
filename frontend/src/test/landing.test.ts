import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(import.meta.dirname, '../pages/index.astro');
const page = fs.readFileSync(pagePath, 'utf8');

describe('landing', () => {
  it('is static and contains the approved conversion sections', () => {
    expect(page).not.toContain('client:');
    expect(page).toContain('Probar gratis');
    expect(page).toContain('Entrar');
    expect(page).toContain('Cómo funciona');
    expect(page).toContain('Hablar');
    expect(page).toContain('Escribir');
    expect(page).toContain('Videos');
    expect(page).toContain('US$2,99');
    expect(page).toContain('60 minutos de tu voz, hasta 180 intervenciones');
    expect(page).not.toContain('AWS Polly');
    expect(page).toContain('Procesamiento efímero');
    expect(page).toContain('waveform-diff');
    expect(page).toContain('signature-stage');
    expect(page).toContain('Habla y recibe una mejora');
    expect(page).not.toContain('message.en');
    expect(page).not.toContain('video.t');
    expect(page).toContain('Elige una práctica, no una racha');
    expect(page).toContain('Ya sabes inglés. Ahora practícalo.');
    expect(page).toContain('B1-C1');
    expect(page).toContain('id="sin-ruido"');
    expect(page).toContain('Cero rachas, gemas y rutas falsas');
    expect(page).toContain('/app/hablar');
    expect(page).toContain('/app/escribir');
    expect(page).toContain('/app/videos');
    expect(page).toContain('Activar modo oscuro');
    expect(page).toContain("['light', 'dark']");
  });

  it('declares the approved SEO and structured-data metadata', () => {
    expect(page).toContain('canonical');
    expect(page).toContain('og:image');
    expect(page).toContain('twitter:card');
    expect(page).toContain('application/ld+json');
    expect(page).toContain('SoftwareApplication');
    expect(page).toContain('EducationalApplication');
  });
});
