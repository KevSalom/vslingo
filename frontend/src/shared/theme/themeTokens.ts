/** English Corrector light/dark palette used across Inglés al Grano. */

export type ThemeId = 'light' | 'dark';

export type ThemeTokens = {
  readonly ink: string;
  readonly editor: string;
  readonly panel: string;
  readonly primary: string;
  readonly secondary: string;
  readonly foreground: string;
  readonly muted: string;
  readonly mutedStrong: string;
  readonly border: string;
  readonly focus: string;
  readonly surfaceRaised: string;
  readonly surfaceRecessed: string;
  readonly primaryHover: string;
  readonly primarySubtle: string;
  readonly primaryFg: string;
  readonly primaryLight: string;
  readonly secondaryLight: string;
  readonly diffAdded: string;
  readonly diffRemoved: string;
  readonly diffAddedBg: string;
  readonly diffRemovedBg: string;
  readonly diffAddedText: string;
  readonly diffRemovedText: string;
  readonly warning: string;
  readonly selectionBg: string;
  readonly selectionFg: string;
  readonly accentColor: string;
};

export type ThemeMeta = {
  readonly id: ThemeId;
  readonly name: string;
  readonly tokens: ThemeTokens;
};

const LIGHT_TOKENS: ThemeTokens = {
  ink: '#FAFAF9',
  editor: '#FAFAF9',
  panel: '#FFFFFF',
  primary: '#CA6A43',
  secondary: '#7C3AED',
  foreground: '#292524',
  muted: '#78716C',
  mutedStrong: '#57534E',
  border: '#E7E5E4',
  focus: '#B85732',
  surfaceRaised: '#FFFFFF',
  surfaceRecessed: '#F5F5F4',
  primaryHover: '#B85732',
  primarySubtle: '#FDF6F0',
  primaryFg: '#FFFFFF',
  primaryLight: '#CA6A43',
  secondaryLight: '#7C3AED',
  diffAdded: '#059669',
  diffRemoved: '#DC2626',
  diffAddedBg: '#ECFDF5',
  diffRemovedBg: '#FEF2F2',
  diffAddedText: '#047857',
  diffRemovedText: '#B91C1C',
  warning: '#EA580C',
  selectionBg: '#FDF6F0',
  selectionFg: '#292524',
  accentColor: '#CA6A43',
};

const DARK_TOKENS: ThemeTokens = {
  ink: '#1C1917',
  editor: '#1C1917',
  panel: '#292524',
  primary: '#CC6236',
  secondary: '#A78BFA',
  foreground: '#F5F5F4',
  muted: '#A8A29E',
  mutedStrong: '#D6D3D1',
  border: '#3E3A38',
  focus: '#FB923C',
  surfaceRaised: '#292524',
  surfaceRecessed: '#211E1C',
  primaryHover: '#B35128',
  primarySubtle: '#431407',
  primaryFg: '#FFFFFF',
  primaryLight: '#FB923C',
  secondaryLight: '#C4B5FD',
  diffAdded: '#10B981',
  diffRemoved: '#EF4444',
  diffAddedBg: '#064E3B',
  diffRemovedBg: '#450A0A',
  diffAddedText: '#A7F3D0',
  diffRemovedText: '#FECACA',
  warning: '#FB923C',
  selectionBg: '#431407',
  selectionFg: '#F5F5F4',
  accentColor: '#CC6236',
};

export const THEMES: readonly ThemeMeta[] = [
  { id: 'light', name: 'Claro', tokens: LIGHT_TOKENS },
  { id: 'dark', name: 'Oscuro', tokens: DARK_TOKENS },
];

export const DEFAULT_THEME_ID: ThemeId = 'light';

export function isValidThemeId(value: unknown): value is ThemeId {
  return value === 'light' || value === 'dark';
}

export function getThemeById(id: ThemeId): ThemeMeta {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
