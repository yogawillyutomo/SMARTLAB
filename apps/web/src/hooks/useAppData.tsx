import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadDB, normalizeDB, resetDB, saveDB, type AppDB, type DatabaseSaveResult } from '@/lib/db';

interface AppDataCtx {
  db: AppDB;
  ready: boolean;
  refresh: () => void;
  mutate: (fn: (db: AppDB) => void) => void;
  replaceDB: (next: AppDB) => DatabaseSaveResult;
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
    const saved = saveDB(next);
    if (!saved.ok) throw new Error(saved.error);
    setDb({ ...saved.db });
  }, []);

  const replaceDB = useCallback((next: AppDB): DatabaseSaveResult => {
    const saved = saveDB(next);
    if (saved.ok) setDb({ ...saved.db });
    return saved;
  }, []);

  const reset = useCallback(() => {
    setDb({ ...resetDB() });
  }, []);

  const importDB = useCallback((raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      const normalized = normalizeDB(parsed);
      if (!normalized.ok) return false;
      const saved = saveDB(normalized.db);
      if (!saved.ok) return false;
      setDb({ ...saved.db });
      return true;
    } catch {
      return false;
    }
  }, []);

  const exportDB = useCallback(() => JSON.stringify(db, null, 2), [db]);

  const value = useMemo<AppDataCtx>(() => ({ db, ready, refresh, mutate, replaceDB, reset, importDB, exportDB }), [db, ready, refresh, mutate, replaceDB, reset, importDB, exportDB]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- The provider and its consumer hook form one intentionally shared context module.
export function useAppData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
