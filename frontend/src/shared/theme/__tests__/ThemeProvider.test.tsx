import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_THEME_ID, getThemeById, isValidThemeId, THEMES } from '../themeTokens';

describe('themeTokens', () => {
  describe('THEMES', () => {
    it('contains exactly 4 themes', () => {
      expect(THEMES).toHaveLength(4);
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
        'diffRemovedText', 'aws', 'selectionBg', 'selectionFg', 'accentColor',
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
    it('is deepwater', () => {
      expect(DEFAULT_THEME_ID).toBe('deepwater');
    });
  });

  describe('isValidThemeId', () => {
    it('accepts all known ids', () => {
      expect(isValidThemeId('deepwater')).toBe(true);
      expect(isValidThemeId('ember')).toBe(true);
      expect(isValidThemeId('aurora')).toBe(true);
      expect(isValidThemeId('obsidian')).toBe(true);
    });

    it('rejects unknown strings', () => {
      expect(isValidThemeId('monokai')).toBe(false);
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
