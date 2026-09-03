import { create } from 'zustand';
import { readStorage, writeStorage, STORAGE_KEYS } from '@/lib/storage';

export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentColor = 'blue' | 'cyan' | 'indigo' | 'violet';
export type ResolvedTheme = 'dark' | 'light';

interface UIState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  commandOpen: boolean;
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  accent: AccentColor;
  isHydrated: boolean;
  compactTable: boolean;
  activeLabId: string;
  academicYear: string;
  semester: string;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setMobileSidebar: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  setAccent: (a: AccentColor) => void;
  syncSystemTheme: () => void;
  setCompactTable: (v: boolean) => void;
  setActiveLab: (id: string) => void;
  setAcademicYear: (y: string) => void;
  setSemester: (s: string) => void;
  hydrate: () => void;
}

interface PersistedUI {
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  accent: AccentColor;
  compactTable: boolean;
  activeLabId: string;
  academicYear: string;
  semester: string;
}

const defaults: PersistedUI = {
  sidebarCollapsed: false,
  theme: 'dark',
  accent: 'blue',
  compactTable: false,
  activeLabId: '',
  academicYear: '2026/2027',
  semester: 'Gasal',
};

function load(): PersistedUI {
  const stored = readStorage<Partial<PersistedUI>>(STORAGE_KEYS.UI, defaults);
  return {
    ...defaults,
    ...stored,
    theme: isThemeMode(stored.theme) ? stored.theme : defaults.theme,
    accent: isAccentColor(stored.accent) ? stored.accent : defaults.accent,
  };
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

function isAccentColor(value: unknown): value is AccentColor {
  return value === 'blue' || value === 'cyan' || value === 'indigo' || value === 'violet';
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: defaults.sidebarCollapsed,
  mobileSidebarOpen: false,
  commandOpen: false,
  theme: defaults.theme,
  resolvedTheme: 'dark',
  accent: defaults.accent,
  isHydrated: false,
  compactTable: defaults.compactTable,
  activeLabId: defaults.activeLabId,
  academicYear: defaults.academicYear,
  semester: defaults.semester,
  toggleSidebar() {
    const v = !get().sidebarCollapsed;
    writeStorage(STORAGE_KEYS.UI, { ...load(), sidebarCollapsed: v });
    set({ sidebarCollapsed: v });
  },
  setSidebarCollapsed(v) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), sidebarCollapsed: v });
    set({ sidebarCollapsed: v });
  },
  setMobileSidebar(v) {
    set({ mobileSidebarOpen: v });
  },
  setCommandOpen(v) {
    set({ commandOpen: v });
  },
  setTheme(t) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), theme: t });
    const resolvedTheme = resolveTheme(t);
    set({ theme: t, resolvedTheme });
    applyTheme(t, resolvedTheme);
  },
  setAccent(a) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), accent: a });
    set({ accent: a });
    applyAccent(a);
  },
  syncSystemTheme() {
    const { theme } = get();
    if (theme !== 'system') return;
    const resolvedTheme = resolveTheme(theme);
    set({ resolvedTheme });
    applyTheme(theme, resolvedTheme);
  },
  setCompactTable(v) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), compactTable: v });
    set({ compactTable: v });
  },
  setActiveLab(id) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), activeLabId: id });
    set({ activeLabId: id });
  },
  setAcademicYear(y) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), academicYear: y });
    set({ academicYear: y });
  },
  setSemester(s) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), semester: s });
    set({ semester: s });
  },
  hydrate() {
    const p = load();
    const resolvedTheme = resolveTheme(p.theme);
    set({
      sidebarCollapsed: p.sidebarCollapsed,
      theme: p.theme,
      resolvedTheme,
      accent: p.accent,
      compactTable: p.compactTable,
      activeLabId: p.activeLabId,
      academicYear: p.academicYear,
      semester: p.semester,
      isHydrated: true,
    });
    applyTheme(p.theme, resolvedTheme);
    applyAccent(p.accent);
  },
}));

export function resolveTheme(theme: ThemeMode): ResolvedTheme {
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeMode, resolvedTheme = resolveTheme(theme)) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolvedTheme === 'dark');
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
}

export function applyAccent(accent: AccentColor) {
  document.documentElement.dataset.accent = accent;
}

export function toastEvent(message: string, type: 'success' | 'error' | 'info' = 'success') {
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { message, type } }));
}
