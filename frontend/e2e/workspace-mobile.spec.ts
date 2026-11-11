import { expect, test } from '@playwright/test';

test('mobile navigation stays at the bottom and leaves content reachable', async ({ page }, testInfo) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/account/quota', (route) => route.fulfill({ json: { source: 'trial', ends_at: null } }));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/app/escribir');
    await expect(page.getByRole('link', { name: 'Tu plan: Gratis' })).toBeVisible();
    await expect(page.locator('.workspace-panel')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Módulos de práctica' });
    await expect(nav).toHaveCSS('position', width <= 640 ? 'fixed' : 'static');
    if (width <= 640) {
      const bounds = await nav.boundingBox();
      expect(bounds!.y + bounds!.height).toBeCloseTo(800, 0);
      await page.getByRole('textbox', { name: 'Tu texto en inglés' }).focus();
      await page.keyboard.type('Yesterday I went to the beach.');
      await page.getByRole('button', { name: 'Revisar texto', exact: true }).scrollIntoViewIfNeeded();
      const button = await page.getByRole('button', { name: 'Revisar texto', exact: true }).boundingBox();
      expect(button!.y + button!.height).toBeLessThanOrEqual(bounds!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`writing-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Videos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Comprensión auditiva' })).toBeFocused();
  }
});
