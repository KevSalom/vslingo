import { expect, test } from '@playwright/test';

test.describe('Writing Studio E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo');
    await page.locator('.activity-button[title="Writing Studio"]').click();
  });

  test('renders writing editor and clears draft', async ({ page }) => {
    const editor = page.getByRole('textbox', { name: /Tu texto en inglés/i });
    await expect(editor).toBeVisible();

    await editor.fill('Testing clear functionality.');
    await page.getByRole('button', { name: /Limpiar/i }).click();

    await expect(editor).toHaveValue('');
  });
});
