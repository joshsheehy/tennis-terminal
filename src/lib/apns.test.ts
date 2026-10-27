import { describe, expect, it } from 'vitest';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { normalizePem, signApnsJwt } from './apns';

describe('signApnsJwt', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  it('produces an ES256 JWT APNs accepts: kid/iss/iat and a raw r||s signature', () => {
    const jwt = signApnsJwt(privateKey, 'ABC123XYZ9', '85942YNM9J', 1_800_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123XYZ9' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: '85942YNM9J', iat: 1_800_000_000 });
    const sig = Buffer.from(s, 'base64url');
    expect(sig).toHaveLength(64);
    const ok = verify('sha256', Buffer.from(`${h}.${c}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, sig);
    expect(ok).toBe(true);
  });
});

describe('normalizePem', () => {
  it('turns literal \\n sequences from a dashboard into real newlines', () => {
    expect(normalizePem('-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n')).toBe(
      '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----'
    );
  });
  it('leaves a real multi-line key alone', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
    expect(normalizePem(`${pem}\n`)).toBe(pem);
  });
});
