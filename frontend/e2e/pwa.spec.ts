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
