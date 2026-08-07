import { describe, expect, it } from 'vitest';
import { mutationSucceeded, runHeartbeat } from '@/lib/mutationOutcome';

describe('mutation success flow guards', () => {
  it('prevents optimistic selected state, drawer closure, and maintenance success paths after a failed mutation', () => {
    const failed = { ok: false as const, error: 'storage failed' };
    expect(mutationSucceeded(failed)).toBe(false);
  });

  it('allows the existing success paths only after a successful mutation', () => {
    expect(mutationSucceeded({ ok: true as const })).toBe(true);
  });

  it('returns a heartbeat failure through the error path and always clears loading', async () => {
    const loading: boolean[] = [];
    const outcome = await runHeartbeat(async () => { throw new Error('offline'); }, (value) => loading.push(value));
    expect(outcome).toMatchObject({ ok: false, error: expect.any(Error) });
    expect(loading).toEqual([true, false]);
  });

  it('keeps the successful heartbeat path and clears loading in its finally path', async () => {
    const loading: boolean[] = [];
    const outcome = await runHeartbeat(async () => 'ok', (value) => loading.push(value));
    expect(outcome).toEqual({ ok: true, value: 'ok' });
    expect(loading).toEqual([true, false]);
  });
});
