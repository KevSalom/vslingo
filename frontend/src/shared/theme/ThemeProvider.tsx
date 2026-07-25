/**
 * ThemeProvider — React context for workspace theme selection with live preview.
 *
 * Manages three states:
 * - `themeId`: the persisted (committed) theme.
 * - `previewId`: a transient preview applied to the DOM but not yet saved.
 * - `activeId`: the currently visible theme (preview if set, otherwise committed).
 *
 * The provider applies `data-theme` on `<html>` so that CSS `[data-theme="X"]`
 * selectors can override custom properties for each theme.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { DEFAULT_THEME_ID, type ThemeId } from './themeTokens';
import { loadThemeId, saveThemeId } from './themeStorage';

type ThemeContextValue = {
  /** The committed (persisted) theme. */
  themeId: ThemeId;
  /** The currently visible theme (preview overrides committed). */
  activeId: ThemeId;
  /** Whether a preview is active and different from the committed theme. */
  isPreviewing: boolean;
  /** Apply a live preview without persisting. */
  previewTheme: (id: ThemeId) => void;
  /** Persist the current preview as the committed theme. */
  commitTheme: () => void;
  /** Cancel the preview and revert to the committed theme. */
  cancelPreview: () => void;
  /** Change theme immediately (persist + apply). */
  setThemeId: (id: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeToDOM(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [previewId, setPreviewId] = useState<ThemeId | null>(null);
  const [ready, setReady] = useState(false);

  // Load persisted theme on mount.
  useEffect(() => {
    const saved = loadThemeId();
    setThemeIdState(saved);
    applyThemeToDOM(saved);
    setReady(true);
  }, []);

  const activeId = previewId ?? themeId;

  // Keep DOM in sync with active theme.
  useEffect(() => {
    if (ready) {
      applyThemeToDOM(activeId);
    }
  }, [activeId, ready]);

  const previewTheme = useCallback((id: ThemeId) => {
    setPreviewId(id);
  }, []);

  const commitTheme = useCallback(() => {
    setPreviewId((current) => {
      if (current !== null) {
        setThemeIdState(current);
        saveThemeId(current);
      }
      return null;
    });
  }, []);

  const cancelPreview = useCallback(() => {
    setPreviewId(null);
  }, []);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    saveThemeId(id);
    setPreviewId(null);
  }, []);

  const isPreviewing = previewId !== null && previewId !== themeId;

  const value = useMemo(
    () => ({
      themeId,
      activeId,
      isPreviewing,
      previewTheme,
      commitTheme,
      cancelPreview,
      setThemeId,
    }),
    [themeId, activeId, isPreviewing, previewTheme, commitTheme, cancelPreview, setThemeId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
