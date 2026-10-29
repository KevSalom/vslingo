import { expect, test } from '@playwright/test';

test('registra el shell y precarga una pantalla offline honesta', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const shell = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cached = await caches.match('/offline.html');
    return {
      script: registration.active?.scriptURL,
      offline: await cached?.text(),
    };
  });
  expect(shell.script).toMatch(/\/sw\.js$/);
  expect(shell.offline).toContain('Tu práctica necesita internet.');
  expect(shell.offline).toContain('No ponemos voz, correcciones ni pagos en una cola oculta');
});

test('actualiza el icono del encabezado aunque la app conserve el distintivo IA en caché', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await page.evaluate(async () => {
    const shell = (await caches.keys()).find((key) => key.startsWith('ingles-al-grano-shell-'));
    if (!shell) throw new Error('No se encontró la caché del shell');
    const cache = await caches.open(shell);
    await cache.put('/app-icon.svg', new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="8" y="40">IA</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } },
    ));
  });
  await page.reload();

  const servedIcon = await page.locator('.brand-mark').evaluate(async (image) => {
    return (await fetch((image as HTMLImageElement).currentSrc)).text();
  });
  expect(servedIcon).toContain('<ellipse');
  expect(servedIcon).not.toContain('<text');
  await page.locator('.site-header').screenshot({ path: testInfo.outputPath('header-grain.png') });
});
