import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_THEME_ID, getThemeById, isValidThemeId, THEMES } from '../themeTokens';

describe('themeTokens', () => {
  describe('THEMES', () => {
    it('contains only the English Corrector light and dark modes', () => {
      expect(THEMES.map((theme) => theme.id)).toEqual(['light', 'dark']);
    });

    it('has unique ids', () => {
      const ids = THEMES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every theme has all required token keys', () => {
      const requiredKeys = [
        'ink', 'editor', 'panel', 'primary', 'secondary',
        'foreground', 'muted', 'mutedStrong', 'border', 'focus',
        'surfaceRaised', 'surfaceRecessed', 'primaryHover', 'primarySubtle',
        'primaryFg', 'primaryLight', 'secondaryLight', 'diffAdded',
        'diffRemoved', 'diffAddedBg', 'diffRemovedBg', 'diffAddedText',
        'diffRemovedText', 'warning', 'selectionBg', 'selectionFg', 'accentColor',
      ];
      for (const theme of THEMES) {
        for (const key of requiredKeys) {
          expect(theme.tokens).toHaveProperty(key);
          expect(typeof (theme.tokens as Record<string, unknown>)[key]).toBe('string');
        }
      }
    });

    it('every token value looks like a hex color', () => {
      const hexPattern = /^#[0-9A-Fa-f]{6}$/;
      for (const theme of THEMES) {
        for (const [key, value] of Object.entries(theme.tokens)) {
          expect(value, `${theme.id}.${key}`).toMatch(hexPattern);
        }
      }
    });
  });

  describe('DEFAULT_THEME_ID', () => {
    it('is light', () => {
      expect(DEFAULT_THEME_ID).toBe('light');
    });
  });

  it('uses the English Corrector terracotta palette', () => {
    expect(getThemeById('light').tokens).toMatchObject({
      ink: '#FAFAF9',
      editor: '#FAFAF9',
      panel: '#FFFFFF',
      primary: '#CA6A43',
      foreground: '#292524',
      border: '#E7E5E4',
    });
    expect(getThemeById('dark').tokens).toMatchObject({
      ink: '#1C1917',
      editor: '#1C1917',
      panel: '#292524',
      primary: '#CC6236',
      foreground: '#F5F5F4',
      border: '#3E3A38',
    });
  });

  describe('isValidThemeId', () => {
    it('accepts all known ids', () => {
      expect(isValidThemeId('light')).toBe(true);
      expect(isValidThemeId('dark')).toBe(true);
    });

    it('rejects unknown strings', () => {
      expect(isValidThemeId('monokai')).toBe(false);
      expect(isValidThemeId('deepwater')).toBe(false);
      expect(isValidThemeId('')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isValidThemeId(null)).toBe(false);
      expect(isValidThemeId(42)).toBe(false);
      expect(isValidThemeId(undefined)).toBe(false);
    });
  });

  describe('getThemeById', () => {
    it('returns the correct theme for each id', () => {
      for (const theme of THEMES) {
        expect(getThemeById(theme.id)).toBe(theme);
      }
    });
  });
});

describe('ThemeProvider', () => {
  // ThemeProvider tests rely on React rendering + DOM, tested via
  // the DemoWorkspace integration tests and manual verification.
  // Context logic is unit-covered indirectly through themeStorage tests
  // and the token validation above.

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('themeStorage integrates with token ids', async () => {
    const { saveThemeId, loadThemeId } = await import('../themeStorage');
    for (const theme of THEMES) {
      saveThemeId(theme.id);
      expect(loadThemeId()).toBe(theme.id);
    }
  });
});
