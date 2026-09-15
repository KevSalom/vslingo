import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadThemeId, saveThemeId, THEME_STORAGE_KEY } from '../themeStorage';

describe('themeStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('loadThemeId', () => {
    it('returns light when nothing is stored', () => {
      expect(loadThemeId()).toBe('light');
    });

    it('returns the stored theme id', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      expect(loadThemeId()).toBe('dark');
    });

    it('returns both valid mode ids', () => {
      for (const id of ['light', 'dark'] as const) {
        localStorage.setItem(THEME_STORAGE_KEY, id);
        expect(loadThemeId()).toBe(id);
      }
    });

    it('migrates retired VSLingo themes to light', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'deepwater');
      expect(loadThemeId()).toBe('light');
    });

    it('returns light for an unknown value', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
      expect(loadThemeId()).toBe('light');
    });

    it('returns light for empty string', () => {
      localStorage.setItem(THEME_STORAGE_KEY, '');
      expect(loadThemeId()).toBe('light');
    });
  });

  describe('saveThemeId', () => {
    it('persists a valid theme id', () => {
      saveThemeId('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('overwrites a previously saved id', () => {
      saveThemeId('dark');
      saveThemeId('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });
  });
});
