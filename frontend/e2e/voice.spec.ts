import { expect, test } from '@playwright/test';

test.describe('Voice Studio E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo');
  });

  test('renders initial Voice Studio setup with scenario options and TTS provider control', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Voice Studio/i })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Iniciar' })).toBeVisible();
    await expect(page.locator('.voice-header-status')).toContainText(/Inactivo/i);

    const scenarioSelect = page.getByRole('combobox', { name: /Escenario/i });
    await expect(scenarioSelect).toBeVisible();
    await scenarioSelect.selectOption('system_design');
    await expect(scenarioSelect).toHaveValue('system_design');

    const providerSelect = page.getByRole('combobox', { name: /Proveedor de voz/i });
    await expect(providerSelect).toBeVisible();
    await providerSelect.selectOption('aws_polly');
    await expect(providerSelect).toHaveValue('aws_polly');

    // Long conversation should scroll inside the panel, not push the document.
    await expect.poll(async () =>
      page.evaluate(() => {
        const split = document.querySelector('.voice-split');
        const body = document.body;
        return split instanceof HTMLElement && getComputedStyle(body).overflowY !== 'auto';
      }),
    ).toBe(true);
  });

  test('presents session metrics section in initial state', async ({ page }) => {
    await expect(page.getByLabel('Métricas de sesión')).toBeVisible();
    await expect(page.getByText('Observabilidad · sesión')).toBeVisible();
  });
});
