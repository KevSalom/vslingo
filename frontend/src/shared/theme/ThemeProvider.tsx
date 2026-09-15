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
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeToDOM(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);

  useEffect(() => {
    const saved = loadThemeId();
    setThemeIdState(saved);
    applyThemeToDOM(saved);
  }, []);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    applyThemeToDOM(id);
    saveThemeId(id);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeIdState((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      applyThemeToDOM(next);
      saveThemeId(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ themeId, setThemeId, toggleTheme }),
    [themeId, setThemeId, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
