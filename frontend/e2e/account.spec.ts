import { expect, test } from '@playwright/test';

const QUOTA = {
  period_id: 'trial-period',
  source: 'trial',
  plan_code: 'monthly_v1',
  config_version: 1,
  starts_at: '2026-09-15T00:00:00Z',
  ends_at: null,
  limits: { voice_seconds: 600, voice_turns: 30, writings: 10, videos: 3 },
  used: { voice_seconds: 125, voice_turns: 4, writings: 2, videos: 1 },
  reserved: { voice_seconds: 0, voice_turns: 0, writings: 0, videos: 0 },
  remaining: { voice_seconds: 475, voice_turns: 26, writings: 8, videos: 2 },
};

const BILLING = {
  mode: 'fake',
  offer: { plan_code: 'monthly_v1', price_minor: 299, currency: 'USD' },
  subscription: null,
  pending_checkout: null,
};

test.describe('Cuenta E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/account/quota', (route) => route.fulfill({ json: QUOTA }));
    await page.route('**/api/account/billing', (route) => route.fulfill({ json: BILLING }));
  });

  test('shows the authenticated balance and supports keyboard navigation', async ({ page }) => {
    await page.goto('/app/cuenta');

    await expect(page.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activar plan' })).toBeVisible();
    await expect(page.getByText('7 min 55 s', { exact: true })).toBeVisible();
    await expect(page.getByText('26', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(4);

    await page.keyboard.press('Tab');
    const focusedControl = page.locator(':focus');
    await expect(focusedControl).toBeVisible();
    expect(await focusedControl.evaluate((element) => ['A', 'BUTTON'].includes(element.tagName))).toBe(true);
  });

  test('reflows on a narrow screen, at enlarged text, and preserves dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/app/cuenta');
    await expect(page.getByText('7 min 55 s', { exact: true })).toBeVisible();

    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await expect.poll(async () => page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth <= root.clientWidth;
    })).toBe(true);

    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
