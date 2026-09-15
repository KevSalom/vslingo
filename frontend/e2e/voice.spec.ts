import { expect, test } from '@playwright/test';

test.describe('Hablar E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/hablar');
  });

  test('renders the PTT setup with scenario and allowlisted voice controls', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Hablar' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Activar micrófono' })).toBeVisible();
    await expect(page.locator('.voice-header-status')).toContainText(/Inactivo/i);

    const scenarioSelect = page.getByRole('combobox', { name: /Escenario/i });
    await expect(scenarioSelect).toBeVisible();
    await scenarioSelect.selectOption('system_design');
    await expect(scenarioSelect).toHaveValue('system_design');

    const voiceSelect = page.getByRole('combobox', { name: 'Voz' });
    await expect(voiceSelect).toBeVisible();
    await voiceSelect.selectOption('en-GB-SoniaNeural');
    await expect(voiceSelect).toHaveValue('en-GB-SoniaNeural');

    // The human-first layout may use natural document scroll, but must never overflow sideways.
    await expect.poll(async () =>
      page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth <= root.clientWidth;
      }),
    ).toBe(true);
  });

  test('keeps the learner interface free of provider and cost diagnostics', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Mantén pulsado para hablar' })).toBeVisible();
    await expect(page.getByText(/Observabilidad|Coste|Proveedor de voz/)).toHaveCount(0);
  });
});
