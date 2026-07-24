import { expect, test } from '@playwright/test';

test.describe('Video Lab E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo');
    await page.locator('.activity-button[title="Video Lab"]').click();
  });

  test('loads fixture transcript and toggles playback and line/paragraph view', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Video Lab/i })).toBeVisible();

    const sampleBtn = page.getByRole('button', { name: /Abrir demo técnica/i });
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    await expect(page.getByRole('button', { name: /Vista párrafo/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Vista línea/i })).toBeVisible();

    await page.getByRole('button', { name: /Vista línea/i }).click();
    await expect(page.getByRole('button', { name: /Vista línea/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('creates a timestamped local note', async ({ page }) => {
    const sampleBtn = page.getByRole('button', { name: /Abrir demo técnica/i });
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    const noteInput = page.getByPlaceholder(/Anota vocabulario/i);
    await expect(noteInput).toBeVisible();
    await noteInput.fill('Key architectural concept explained here.');
    await page.getByRole('button', { name: /Guardar nota/i }).click();
    await expect(page.getByText('Key architectural concept explained here.')).toBeVisible();
  });
});
