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

  test('creates a local note from the explorer and lists it in the tree', async ({ page }) => {
    await page.getByRole('button', { name: /Abrir demo técnica/i }).click();

    await page.getByRole('button', { name: 'Nueva nota' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nueva nota' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Nombre').fill('Architectural concept');
    await dialog.getByLabel('Contenido').fill('Key architectural concept explained here.');
    await dialog.getByRole('button', { name: 'Guardar nota' }).click();

    await expect(
      page.getByRole('button', { name: 'Architectural concept' }),
    ).toBeVisible();
  });
});
