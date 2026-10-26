import { describe, expect, it } from 'vitest';
import {
  generateLoginCode,
  generateSessionToken,
  hashLoginCode,
  hashesMatch,
  normalizeCode,
  normalizeEmail,
  originAllowed,
  parseEditionIds,
  safeNextPath,
  sessionTokenFrom,
} from './auth-core';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('normalizeEmail', () => {
  it('trims and lowercases a valid address', () => {
    expect(normalizeEmail('  Josh@Example.COM ')).toBe('josh@example.com');
  });
  it('rejects junk and non-strings', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@x.co`)).toBeNull();
  });
});

describe('login codes', () => {
  it('generates six digits, zero-padded', () => {
    for (let i = 0; i < 200; i++) expect(generateLoginCode()).toMatch(/^\d{6}$/);
  });
  it('accepts a typed code with spaces, rejects anything else', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('012345')).toBe('012345');
    expect(normalizeCode('12345')).toBeNull();
    expect(normalizeCode('abcdef')).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
  it('binds the hash to the email', () => {
    const h = hashLoginCode('a@x.co', '123456');
    expect(hashesMatch(h, hashLoginCode('a@x.co', '123456'))).toBe(true);
    expect(hashesMatch(h, hashLoginCode('b@x.co', '123456'))).toBe(false);
    expect(hashesMatch(h, hashLoginCode('a@x.co', '123457'))).toBe(false);
  });
  it('treats empty or mismatched-length hashes as no match', () => {
    expect(hashesMatch('', '')).toBe(false);
    expect(hashesMatch('ab', 'abcd')).toBe(false);
  });
});

describe('session tokens', () => {
  it('are long and unique', () => {
    const a = generateSessionToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(generateSessionToken()).not.toBe(a);
  });
  it('prefers a Bearer header over the cookie', () => {
    expect(sessionTokenFrom('Bearer abc', 'cookie')).toBe('abc');
    expect(sessionTokenFrom(null, 'cookie')).toBe('cookie');
    expect(sessionTokenFrom('Bearer ', 'cookie')).toBe('cookie');
    expect(sessionTokenFrom(null, undefined)).toBeNull();
  });
});

describe('parseEditionIds', () => {
  it('keeps valid uuids, dedupes, lowercases', () => {
    expect(parseEditionIds([A, A.toUpperCase(), B, 'nope', 7])).toEqual([A, B]);
  });
  it('accepts a comma-separated ?build= string', () => {
    expect(parseEditionIds(`${A}, ${B}`)).toEqual([A, B]);
  });
  it('returns nothing for non-lists', () => {
    expect(parseEditionIds(undefined)).toEqual([]);
    expect(parseEditionIds({})).toEqual([]);
  });
});

describe('safeNextPath', () => {
  it('allows same-site paths only', () => {
    expect(safeNextPath('/schedule?build=1')).toBe('/schedule?build=1');
    expect(safeNextPath('//evil.com')).toBe('/account');
    expect(safeNextPath('/\\evil.com')).toBe('/account');
    expect(safeNextPath('https://evil.com')).toBe('/account');
    expect(safeNextPath(undefined)).toBe('/account');
  });
});

describe('originAllowed', () => {
  const hosts = ['tenniscuts.com', null, 'localhost:3000'];
  it('passes requests with no Origin and matching origins', () => {
    expect(originAllowed(null, hosts)).toBe(true);
    expect(originAllowed('https://tenniscuts.com', hosts)).toBe(true);
    expect(originAllowed('http://localhost:3000', hosts)).toBe(true);
  });
  it('blocks other sites and garbage', () => {
    expect(originAllowed('https://evil.com', hosts)).toBe(false);
    expect(originAllowed('https://tenniscuts.com.evil.com', hosts)).toBe(false);
    expect(originAllowed('null', hosts)).toBe(false);
  });
});
