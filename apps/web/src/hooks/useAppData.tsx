import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadDB, normalizeDB, persistDB, resetDB, type AppDB, type DatabaseLoadResult, type DatabaseMigrationIssue, type DatabaseSaveResult, RECOVERY_WRITE_ERROR } from '@/lib/db';

export type AppMutationResult = { ok: true } | { ok: false; error: string; issues?: DatabaseMigrationIssue[] };
export type ImportDatabaseResult = { ok: true; db: AppDB } | { ok: false; error: string; issues?: DatabaseMigrationIssue[] };
export type RecoveryState = { issues: DatabaseMigrationIssue[]; rawPreserved: true } | null;
interface AppDataCtx {
  db: AppDB; ready: boolean; recovery: RecoveryState; refresh: () => void;
  mutate: (fn: (db: AppDB) => void) => AppMutationResult;
  replaceDB: (next: AppDB) => DatabaseSaveResult;
  reset: () => AppMutationResult;
  importDB: (raw: string) => ImportDatabaseResult;
  exportDB: () => string;
}
const Ctx = createContext<AppDataCtx | null>(null);
function recoveryOf(result: DatabaseLoadResult): RecoveryState { return result.ok ? null : { issues: result.issues, rawPreserved: true }; }
function clone(db: AppDB): AppDB { return JSON.parse(JSON.stringify(db)) as AppDB; }

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [initial] = useState<DatabaseLoadResult>(loadDB);
  const [db, setDb] = useState<AppDB>(initial.db);
  const [recovery, setRecovery] = useState<RecoveryState>(recoveryOf(initial));
  const [ready, setReady] = useState(false);
  useEffect(() => { const next = loadDB(); setDb(next.db); setRecovery(recoveryOf(next)); setReady(true); }, []);
  const refresh = useCallback(() => { const next = loadDB(); setDb(next.db); setRecovery(recoveryOf(next)); }, []);
  const mutate = useCallback((fn: (draft: AppDB) => void): AppMutationResult => {
    if (recovery) return { ok: false, error: RECOVERY_WRITE_ERROR, issues: recovery.issues };
    const next = clone(db); fn(next); const saved = persistDB(next);
    if (!saved.ok) return { ok: false, error: saved.error, issues: saved.issues };
    setDb(saved.db); return { ok: true };
  }, [db, recovery]);
  const replaceDB = useCallback((next: AppDB): DatabaseSaveResult => {
    if (recovery) return { ok: false, error: RECOVERY_WRITE_ERROR, issues: recovery.issues };
    const saved = persistDB(next); if (saved.ok) setDb(saved.db); return saved;
  }, [recovery]);
  const reset = useCallback((): AppMutationResult => {
    const saved = resetDB(); if (!saved.ok) return { ok: false, error: saved.error, issues: saved.issues };
    setDb(saved.db); setRecovery(null); return { ok: true };
  }, []);
  const importDB = useCallback((raw: string): ImportDatabaseResult => {
    try { const normalized = normalizeDB(JSON.parse(raw) as unknown); if (!normalized.ok) return { ok: false, error: 'Backup tidak valid.', issues: normalized.issues };
      const saved = persistDB(normalized.db, { allowRecoveryReplace: true, writeVersion: true }); if (!saved.ok) return { ok: false, error: saved.error, issues: saved.issues };
      setDb(saved.db); setRecovery(null); return { ok: true, db: saved.db };
    } catch { return { ok: false, error: 'File backup tidak dapat dibaca.' }; }
  }, []);
  const exportDB = useCallback(() => { if (recovery) throw new Error('Backup asli sedang dipertahankan. Gunakan impor atau reset sebelum mengekspor data aplikasi.'); const normalized = normalizeDB(db); if (!normalized.ok) throw new Error('Database tidak valid untuk diekspor.'); return JSON.stringify(normalized.db, null, 2); }, [db, recovery]);
  const value = useMemo<AppDataCtx>(() => ({ db, ready, recovery, refresh, mutate, replaceDB, reset, importDB, exportDB }), [db, ready, recovery, refresh, mutate, replaceDB, reset, importDB, exportDB]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components -- The provider and its consumer hook form one intentionally shared context module.
export function useAppData() { const ctx = useContext(Ctx); if (!ctx) throw new Error('useAppData must be used within AppDataProvider'); return ctx; }
