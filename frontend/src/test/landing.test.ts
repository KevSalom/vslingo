import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(import.meta.dirname, '../pages/index.astro');
const page = fs.readFileSync(pagePath, 'utf8');

describe('landing', () => {
  it('is static and contains the approved conversion sections', () => {
    expect(page).not.toContain('client:');
    expect(page).toContain('Probar demo');
    expect(page).toContain('Cómo funciona');
    expect(page).toContain('Voice Studio');
    expect(page).toContain('Writing Studio');
    expect(page).toContain('Video Lab');
    expect(page).toContain('AWS Polly Neural');
    expect(page).toContain('Procesamiento efímero');
    expect(page).toContain('waveform-diff');
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
