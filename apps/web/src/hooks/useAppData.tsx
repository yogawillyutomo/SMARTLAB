import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadDB, saveDB, type AppDB } from '@/lib/db';
import { generateSeedData } from '@/data/seed';

interface AppDataCtx {
  db: AppDB;
  ready: boolean;
  refresh: () => void;
  mutate: (fn: (db: AppDB) => void) => void;
  reset: () => void;
  importDB: (raw: string) => boolean;
  exportDB: () => string;
}

const Ctx = createContext<AppDataCtx | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<AppDB>(() => loadDB());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDb(loadDB());
    setReady(true);
  }, []);

  const refresh = useCallback(() => setDb(loadDB()), []);

  const mutate = useCallback((fn: (d: AppDB) => void) => {
    const next = loadDB();
    fn(next);
    saveDB(next);
    setDb({ ...next });
  }, []);

  const reset = useCallback(() => {
    const seed = generateSeedData();
    saveDB(seed);
    setDb({ ...seed });
  }, []);

  const importDB = useCallback((raw: string) => {
    try {
      const parsed = JSON.parse(raw) as AppDB;
      if (!parsed || typeof parsed !== 'object') return false;
      if (!parsed.labs || !parsed.devices) return false;
      saveDB(parsed);
      setDb({ ...parsed });
      return true;
    } catch {
      return false;
    }
  }, []);

  const exportDB = useCallback(() => JSON.stringify(db, null, 2), [db]);

  const value = useMemo<AppDataCtx>(() => ({ db, ready, refresh, mutate, reset, importDB, exportDB }), [db, ready, refresh, mutate, reset, importDB, exportDB]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- The provider and its consumer hook form one intentionally shared context module.
export function useAppData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
