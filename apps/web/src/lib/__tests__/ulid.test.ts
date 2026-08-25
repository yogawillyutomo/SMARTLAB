import { describe, expect, it } from 'vitest';
import { isUlid } from '@/lib/ulid';

describe('isUlid', () => {
  it.each([
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    '01m0r8nsw938c2zcv44zyge820',
    '01m0R8nsW938c2Zcv44zYge820',
  ])('accepts valid Crockford ULID text without normalizing %s', (value) => {
    expect(isUlid(value)).toBe(true);
  });

  it.each([
    ['wrong length', '01m0r8nsw938c2zcv44zyge82'],
    ['uppercase I', '01m0r8nsw938c2zcv44zyge82I'],
    ['lowercase i', '01m0r8nsw938c2zcv44zyge82i'],
    ['uppercase L', '01m0r8nsw938c2zcv44zyge82L'],
    ['lowercase l', '01m0r8nsw938c2zcv44zyge82l'],
    ['uppercase O', '01m0r8nsw938c2zcv44zyge82O'],
    ['lowercase o', '01m0r8nsw938c2zcv44zyge82o'],
    ['uppercase U', '01m0r8nsw938c2zcv44zyge82U'],
    ['lowercase u', '01m0r8nsw938c2zcv44zyge82u'],
    ['first character 8', '81m0r8nsw938c2zcv44zyge820'],
    ['first character Z', 'Z1m0r8nsw938c2zcv44zyge820'],
    ['punctuation', '01m0r8nsw938c2zcv44zyge82-'],
  ])('rejects %s', (_case, value) => {
    expect(isUlid(value)).toBe(false);
  });

  it.each([null, undefined, 1, {}, []])('rejects non-string input %j', (value) => {
    expect(isUlid(value)).toBe(false);
  });
});
