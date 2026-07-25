/** Semantic theme token definitions for VSLingo workspace themes. */

export type ThemeId = 'deepwater' | 'ember' | 'aurora' | 'obsidian';

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
  readonly aws: string;
  readonly selectionBg: string;
  readonly selectionFg: string;
  readonly accentColor: string;
};

export type ThemeMeta = {
  readonly id: ThemeId;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly tokens: ThemeTokens;
};

/* ─── Deepwater ───────────────────────────────────────────────── */

const DEEPWATER_TOKENS: ThemeTokens = {
  ink: '#090D12',
  editor: '#111820',
  panel: '#18212C',
  primary: '#22D3EE',
  secondary: '#8B5CF6',
  foreground: '#F1F5F9',
  muted: '#9AA8B8',
  mutedStrong: '#C3CED9',
  border: '#2A3746',
  focus: '#67E8F9',
  surfaceRaised: '#1D2834',
  surfaceRecessed: '#0D141C',
  primaryHover: '#A5F3FC',
  primarySubtle: '#102A34',
  primaryFg: '#071015',
  primaryLight: '#A5F3FC',
  secondaryLight: '#C4B5FD',
  diffAdded: '#4ADE80',
  diffRemoved: '#FB7185',
  diffAddedBg: '#123825',
  diffRemovedBg: '#4C1424',
  diffAddedText: '#BBF7D0',
  diffRemovedText: '#FECDD3',
  aws: '#FF9900',
  selectionBg: '#164E63',
  selectionFg: '#ECFEFF',
  accentColor: '#22D3EE',
};

/* ─── Ember ───────────────────────────────────────────────────── */

const EMBER_TOKENS: ThemeTokens = {
  ink: '#0F0D0A',
  editor: '#171310',
  panel: '#211D18',
  primary: '#F59E0B',
  secondary: '#F472B6',
  foreground: '#F5F0E8',
  muted: '#B8A898',
  mutedStrong: '#D4C8B8',
  border: '#3A3228',
  focus: '#FCD34D',
  surfaceRaised: '#262018',
  surfaceRecessed: '#0D0B08',
  primaryHover: '#FCD34D',
  primarySubtle: '#2A2010',
  primaryFg: '#1C1004',
  primaryLight: '#FDE68A',
  secondaryLight: '#F9A8D4',
  diffAdded: '#4ADE80',
  diffRemoved: '#FB7185',
  diffAddedBg: '#132E1E',
  diffRemovedBg: '#3D1222',
  diffAddedText: '#BBF7D0',
  diffRemovedText: '#FECDD3',
  aws: '#FF9900',
  selectionBg: '#4D3800',
  selectionFg: '#FEF9C3',
  accentColor: '#F59E0B',
};

/* ─── Aurora ──────────────────────────────────────────────────── */

const AURORA_TOKENS: ThemeTokens = {
  ink: '#0A0E14',
  editor: '#121820',
  panel: '#1A222E',
  primary: '#34D399',
  secondary: '#A78BFA',
  foreground: '#E8F0F8',
  muted: '#8FA0B2',
  mutedStrong: '#B8C8D8',
  border: '#283848',
  focus: '#6EE7B7',
  surfaceRaised: '#1E2838',
  surfaceRecessed: '#080C12',
  primaryHover: '#6EE7B7',
  primarySubtle: '#0E2A22',
  primaryFg: '#052E1C',
  primaryLight: '#A7F3D0',
  secondaryLight: '#C4B5FD',
  diffAdded: '#4ADE80',
  diffRemoved: '#FB7185',
  diffAddedBg: '#123825',
  diffRemovedBg: '#4C1424',
  diffAddedText: '#BBF7D0',
  diffRemovedText: '#FECDD3',
  aws: '#FF9900',
  selectionBg: '#134E3A',
  selectionFg: '#ECFDF5',
  accentColor: '#34D399',
};

/* ─── Obsidian ────────────────────────────────────────────────── */

const OBSIDIAN_TOKENS: ThemeTokens = {
  ink: '#0C0C0C',
  editor: '#151515',
  panel: '#1E1E1E',
  primary: '#C4B5FD',
  secondary: '#67E8F9',
  foreground: '#E4E4E7',
  muted: '#A1A1AA',
  mutedStrong: '#C8C8D0',
  border: '#2E2E2E',
  focus: '#D4CAFE',
  surfaceRaised: '#232323',
  surfaceRecessed: '#0A0A0A',
  primaryHover: '#DDD6FE',
  primarySubtle: '#1E1A2E',
  primaryFg: '#1A0F30',
  primaryLight: '#DDD6FE',
  secondaryLight: '#A5F3FC',
  diffAdded: '#4ADE80',
  diffRemoved: '#FB7185',
  diffAddedBg: '#142E1E',
  diffRemovedBg: '#3E1222',
  diffAddedText: '#BBF7D0',
  diffRemovedText: '#FECDD3',
  aws: '#FF9900',
  selectionBg: '#2E2650',
  selectionFg: '#F5F3FF',
  accentColor: '#C4B5FD',
};

/* ─── Registry ────────────────────────────────────────────────── */

export const THEMES: readonly ThemeMeta[] = [
  {
    id: 'deepwater',
    name: 'Deepwater',
    description: 'Azules profundos con acentos cyan — el original.',
    icon: '🌊',
    tokens: DEEPWATER_TOKENS,
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'Tonos grafito cálidos con acentos ámbar.',
    icon: '🔥',
    tokens: EMBER_TOKENS,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Fondo profundo con acentos verde esmeralda.',
    icon: '🌿',
    tokens: AURORA_TOKENS,
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Monocromático puro con acento lavanda.',
    icon: '🪨',
    tokens: OBSIDIAN_TOKENS,
  },
];

export const DEFAULT_THEME_ID: ThemeId = 'deepwater';

export function isValidThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' &&
    (value === 'deepwater' || value === 'ember' || value === 'aurora' || value === 'obsidian')
  );
}

export function getThemeById(id: ThemeId): ThemeMeta {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) {
    return THEMES[0];
  }
  return theme;
}
