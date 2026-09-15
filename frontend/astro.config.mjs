// @ts-check
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  output: 'static',
  // En producción SITE_URL es obligatorio para emitir canonical y OG correctos.
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  integrations: [react()],
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Outfit',
      cssVariable: '--font-outfit',
      weights: ['300 800'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Arial', 'sans-serif'],
    },
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
