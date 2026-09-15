import { expect, test } from '@playwright/test';

test.describe('Landing Page E2E', () => {
  test('renders static landing page with hero, modules, CTA and SEO metadata', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Inglés al Grano/i);
    await expect(page.locator('#hero-title')).toContainText('Ya sabes inglés. Ahora practícalo.');

    const demoCta = page.getByRole('link', { name: 'Probar gratis', exact: true }).first();
    await expect(demoCta).toBeVisible();
    await expect(demoCta).toHaveAttribute('href', '/app/hablar');

    await expect(page.getByRole('link', { name: /Empezar a hablar/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Mejorar un texto/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Entrenar el oído/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('navigates from landing to workspace demo when CTA is clicked', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Probar gratis', exact: true }).first().click();

    await page.waitForURL('/app/hablar');
    await expect(page.locator('#voice-title')).toBeVisible();
  });
});
