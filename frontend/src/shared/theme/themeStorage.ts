/** localStorage persistence for the active workspace theme. */

import { DEFAULT_THEME_ID, isValidThemeId, type ThemeId } from './themeTokens';

export const THEME_STORAGE_KEY = 'vslingo:theme';

/** Read the saved theme ID. Returns the default if missing or invalid. */
export function loadThemeId(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isValidThemeId(raw) ? raw : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

/** Persist a valid theme ID. Silently ignores storage errors. */
export function saveThemeId(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Storage may be full or blocked — ignore silently.
  }
}
