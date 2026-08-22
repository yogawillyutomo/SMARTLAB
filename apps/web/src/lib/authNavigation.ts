interface LocationLike {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSafeInternalPath(path: string): boolean {
  const containsControlCharacter = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return path.startsWith('/')
    && !path.startsWith('//')
    && !path.includes('\\')
    && !containsControlCharacter;
}

export function postLoginPath(locationState: unknown): string {
  if (!isRecord(locationState)) return '/dashboard';
  const from = locationState.from;
  if (!isRecord(from)) return '/dashboard';

  const candidate: LocationLike = from;
  const pathname = typeof candidate.pathname === 'string' ? candidate.pathname : '';
  const search = typeof candidate.search === 'string' && candidate.search.startsWith('?') ? candidate.search : '';
  const hash = typeof candidate.hash === 'string' && candidate.hash.startsWith('#') ? candidate.hash : '';
  const path = `${pathname}${search}${hash}`;

  return isSafeInternalPath(path) && pathname !== '/login' ? path : '/dashboard';
}
