export function mutationSucceeded<Result extends { ok: boolean }>(result: Result): result is Extract<Result, { ok: true }> {
  return result.ok;
}

export type HeartbeatOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export async function runHeartbeat<T>(operation: () => Promise<T>, setLoading: (loading: boolean) => void): Promise<HeartbeatOutcome<T>> {
  setLoading(true);
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  } finally {
    setLoading(false);
  }
}
