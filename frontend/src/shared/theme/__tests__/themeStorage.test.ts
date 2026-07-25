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
    it('returns deepwater when nothing is stored', () => {
      expect(loadThemeId()).toBe('deepwater');
    });

    it('returns the stored theme id', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'ember');
      expect(loadThemeId()).toBe('ember');
    });

    it('returns all valid theme ids', () => {
      for (const id of ['deepwater', 'ember', 'aurora', 'obsidian'] as const) {
        localStorage.setItem(THEME_STORAGE_KEY, id);
        expect(loadThemeId()).toBe(id);
      }
    });

    it('returns deepwater for an unknown value', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
      expect(loadThemeId()).toBe('deepwater');
    });

    it('returns deepwater for empty string', () => {
      localStorage.setItem(THEME_STORAGE_KEY, '');
      expect(loadThemeId()).toBe('deepwater');
    });
  });

  describe('saveThemeId', () => {
    it('persists a valid theme id', () => {
      saveThemeId('aurora');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('aurora');
    });

    it('overwrites a previously saved id', () => {
      saveThemeId('ember');
      saveThemeId('obsidian');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('obsidian');
    });
  });
});
