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

    const brandIcon = page.locator('.site-header .brand-mark');
    await expect(brandIcon).toHaveAttribute('src', '/app-icon.svg?v=grain-2');
    expect(await brandIcon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const faviconHref = await page.locator('link[rel="icon"]').getAttribute('href');
    const favicon = await page.request.get(faviconHref!);
    const headerIcon = await page.request.get('/app-icon.svg');
    expect(favicon.ok()).toBe(true);
    expect(await favicon.text()).toBe(await headerIcon.text());

    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('navigates from landing to workspace demo when CTA is clicked', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Probar gratis', exact: true }).first().click();

    await page.waitForURL('/app/hablar');
    await expect(page.locator('#voice-title')).toBeVisible();
  });

  test('keeps optional measurement off after an explicit rejection', async ({ page }) => {
    let consentBody = '';
    let pageViews = 0;
    await page.route('**/api/marketing/config', (route) => route.fulfill({
      json: { enabled: true, policy_version: '2026-09-16' },
    }));
    await page.route('**/api/marketing/visitor-consent', async (route) => {
      consentBody = route.request().postData() ?? '';
      await route.fulfill({ json: { status: 'saved' } });
    });
    await page.route('**/api/marketing/page-view', async (route) => {
      pageViews += 1;
      await route.fulfill({ json: { status: 'queued' } });
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');

    await expect(page.getByLabel('Preferencia de medición')).toBeVisible();
    await page.getByRole('button', { name: 'No, gracias' }).click();

    await expect(page.getByLabel('Preferencia de medición')).toBeHidden();
    expect(JSON.parse(consentBody)).toMatchObject({ analytics_allowed: false });
    expect(pageViews).toBe(0);
  });
});
