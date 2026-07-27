import { expect, test } from '@playwright/test';

test.describe('Voice Studio E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo');
  });

  test('renders initial Voice Studio setup with scenario options and TTS provider control', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Voice Studio/i })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Iniciar Voice Studio' })).toBeVisible();
    await expect(page.getByRole('status', { name: /Estado: Inactivo/i })).toBeVisible();

    const scenarioSelect = page.getByRole('combobox', { name: /Escenario/i });
    await expect(scenarioSelect).toBeVisible();
    await scenarioSelect.selectOption('system_design');
    await expect(scenarioSelect).toHaveValue('system_design');

    const providerSelect = page.getByRole('combobox', { name: /Proveedor de voz/i });
    await expect(providerSelect).toBeVisible();
    await providerSelect.selectOption('aws_polly');
    await expect(providerSelect).toHaveValue('aws_polly');
  });

  test('presents session metrics section in initial state', async ({ page }) => {
    await expect(page.getByLabel('Métricas de sesión')).toBeVisible();
    await expect(page.getByText('Observabilidad local · esta sesión')).toBeVisible();
  });
});
