import { expect, test } from '@playwright/test';

test.describe('Landing Page E2E', () => {
  test('renders static landing page with hero, modules, CTA and SEO metadata', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/VSLingo/i);
    await expect(page.locator('#hero-title')).toContainText('Practica el inglés que usas para desarrollar');

    const demoCta = page.getByRole('link', { name: /Probar demo/i }).first();
    await expect(demoCta).toBeVisible();
    await expect(demoCta).toHaveAttribute('href', '/demo');

    // Module cards links
    await expect(page.getByRole('link', { name: /Explorar módulos/i })).toBeVisible();
  });

  test('navigates from landing to workspace demo when CTA is clicked', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Probar demo/i }).first().click();

    await page.waitForURL('/demo');
    await expect(page.locator('#voice-title')).toBeVisible();
  });
});
