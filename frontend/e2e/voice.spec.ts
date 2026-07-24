import { expect, test } from '@playwright/test';

test.describe('Voice Studio E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo');
  });

  test('renders initial Voice Studio setup with scenario options and TTS provider control', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Voice Studio/i })).toBeVisible();

    // Verify scenario buttons
    await expect(page.getByRole('button', { name: 'Daily Standup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'System Design / Technical Interview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salary Negotiation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Libre / Explorar' })).toBeVisible();

    // Select scenario
    await page.getByRole('button', { name: 'System Design / Technical Interview' }).click();
    await expect(page.getByRole('button', { name: 'System Design / Technical Interview' })).toHaveAttribute('aria-pressed', 'true');

    // Speech provider control
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
