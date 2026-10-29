import { expect, test, type Page } from '@playwright/test';

test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.setTimeout(120_000);

async function inspectReadability(page: Page) {
  return page.evaluate(() => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const contrast = (foreground: string, background: string) => {
      const a = luminance(foreground);
      const b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    const backgroundOf = (element: Element): string => {
      const background = getComputedStyle(element).backgroundColor;
      return background === 'rgba(0, 0, 0, 0)' && element.parentElement
        ? backgroundOf(element.parentElement) : background;
    };
    const smallText = [...document.querySelectorAll('body *')].filter((element) =>
      element.getClientRects().length && [...element.childNodes].some((node) =>
        node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) &&
      parseFloat(getComputedStyle(element).fontSize) < 14,
    ).map((element) => `${element.className}: ${getComputedStyle(element).fontSize}`);
    const diffs = [...document.querySelectorAll('del, ins, .sig-diff, .diff-preview span, .diff-symbol, .contrast-list li')]
      .filter((element) => element.getClientRects().length)
      .map((element) => ({ text: element.textContent, ratio: contrast(getComputedStyle(element).color, backgroundOf(element)) }));
    const selection = getComputedStyle(document.body, '::selection');
    return {
      smallText, diffs,
      selectionContrast: contrast(selection.color, selection.backgroundColor),
      selectionSurfaceContrast: contrast(selection.backgroundColor, getComputedStyle(document.body).backgroundColor),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

for (const theme of ['light', 'dark']) {
  test(`readable UI in ${theme} mode across desktop, tablet and mobile`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('vslingo:theme', value), theme);
    await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
    for (const width of [1440, 768, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/', '/app/hablar', '/app/escribir', '/app/videos', '/app/cuenta']) {
        await page.goto(path);
        if (path !== '/') await expect(page.locator('.practice-intro h1')).toBeVisible();
        if (path === '/') {
          await expect(page.locator('.signature-panel').first()).toHaveCSS('opacity', '1');
          await expect(page.locator('.signature-panel').first()).toBeVisible();
        }
        const result = await inspectReadability(page);
        expect(result.smallText, `${path} at ${width}px`).toEqual([]);
        expect(result.overflow, `${path} at ${width}px`).toBe(false);
        for (const diff of result.diffs) expect(diff.ratio, `${path}: ${diff.text}`).toBeGreaterThanOrEqual(4.5);
        expect(result.selectionContrast).toBeGreaterThanOrEqual(4.5);
        expect(result.selectionSurfaceContrast).toBeGreaterThanOrEqual(2);
        if (path === '/' && width !== 768) {
          await page.screenshot({ path: testInfo.outputPath(`landing-${theme}-${width}.png`), fullPage: true });
        }
      }
    }
  });

  test(`writing corrections keep sufficient contrast in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('vslingo:theme', value), theme);
    await page.route('**/api/writing/correct', (route) => route.fulfill({ json: {
      original_text: 'I has a dog.', corrected_text: 'I have a dog.', has_corrections: true,
      corrections: [{ original: 'I has', corrected: 'I have', category: 'grammar', explanation: 'Usa have con I.' }],
      general_feedback: 'Revisa la concordancia del verbo.',
    } }));
    await page.goto('/app/escribir');
    await page.getByRole('textbox', { name: /Tu texto en inglés/i }).fill('I has a dog.');
    await page.getByRole('button', { name: 'Revisar texto', exact: true }).click();
    await expect(page.locator('.writing-diff-line ins')).toBeVisible();
    const result = await inspectReadability(page);
    expect(result.smallText).toEqual([]);
    expect(result.diffs.length).toBeGreaterThanOrEqual(2);
    for (const diff of result.diffs) expect(diff.ratio, diff.text ?? '').toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath(`writing-${theme}.png`), fullPage: true });
  });
}
