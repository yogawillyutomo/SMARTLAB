import { create } from 'zustand';
import { readStorage, writeStorage, STORAGE_KEYS } from '@/lib/storage';

export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentColor = 'blue' | 'cyan';

interface UIState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  commandOpen: boolean;
  theme: ThemeMode;
  accent: AccentColor;
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
  activeLabId: 'lab-rpl-1',
  academicYear: '2026/2027',
  semester: 'Gasal',
};

function load(): PersistedUI {
  return readStorage<PersistedUI>(STORAGE_KEYS.UI, defaults);
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: defaults.sidebarCollapsed,
  mobileSidebarOpen: false,
  commandOpen: false,
  theme: defaults.theme,
  accent: defaults.accent,
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
    set({ theme: t });
    applyTheme(t);
  },
  setAccent(a) {
    writeStorage(STORAGE_KEYS.UI, { ...load(), accent: a });
    set({ accent: a });
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
    set({
      sidebarCollapsed: p.sidebarCollapsed,
      theme: p.theme,
      accent: p.accent,
      compactTable: p.compactTable,
      activeLabId: p.activeLabId,
      academicYear: p.academicYear,
      semester: p.semester,
    });
    applyTheme(p.theme);
  },
}));

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);
}

export function toastEvent(message: string, type: 'success' | 'error' | 'info' = 'success') {
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { message, type } }));
}
