const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}
