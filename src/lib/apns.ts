import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

// Minimal Apple Push Notification service client: token-based auth (an ES256
// JWT signed with the .p8 key) over HTTP/2, with no npm dependency — the same
// plain-platform approach as the Resend helper in email.ts. Set on Railway:
//
//   APNS_KEY_ID       10-character Key ID shown next to the key in the portal
//   APNS_TEAM_ID      Apple Developer Team ID
//   APNS_PRIVATE_KEY  full contents of AuthKey_<id>.p8, BEGIN/END lines included
//   APNS_BUNDLE_ID    optional, defaults to com.tenniscuts.app

export type ApnsEnv = 'sandbox' | 'production';

const HOSTS: Record<ApnsEnv, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

export function apnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);
}

function bundleId(): string {
  return process.env.APNS_BUNDLE_ID || 'com.tenniscuts.app';
}

// Railway (and most dashboards) store a pasted multi-line value either with
// real newlines or with literal "\n" sequences; accept both.
export function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

// ES256 JWT for APNs. Exported for tests; production callers use authToken().
export function signApnsJwt(key: KeyObject, keyId: string, teamId: string, issuedAtSec: number): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: issuedAtSec }));
  const input = `${header}.${claims}`;
  // APNs wants the raw r||s signature (JOSE), not the DER that Node defaults to.
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${base64url(signature)}`;
}

// Apple rejects tokens older than an hour and throttles refreshing faster
// than every ~20 minutes, so reuse one for 50 minutes.
const TOKEN_TTL_MS = 50 * 60 * 1000;
let cached: { token: string; at: number } | null = null;

function authToken(): string {
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  const key = createPrivateKey(normalizePem(process.env.APNS_PRIVATE_KEY ?? ''));
  const token = signApnsJwt(key, process.env.APNS_KEY_ID!, process.env.APNS_TEAM_ID!, Math.floor(Date.now() / 1000));
  cached = { token, at: Date.now() };
  return token;
}

export type PushMessage = {
  title: string;
  body: string;
  // In-app path to open when the notification is tapped.
  url?: string;
  // Collapse identical alerts on the device (e.g. a re-sent digest).
  collapseId?: string;
};

export type PushOutcome =
  | { ok: true; env: ApnsEnv }
  // `gone`: the token is dead (app deleted / token rotated) — drop the device.
  | { ok: false; gone: boolean; status: number; reason: string };

// One HTTP/2 connection per environment, reused for a whole cron run.
export class ApnsClient {
  private sessions = new Map<ApnsEnv, ClientHttp2Session>();

  private session(env: ApnsEnv): ClientHttp2Session {
    let s = this.sessions.get(env);
    if (!s || s.closed || s.destroyed) {
      s = connect(HOSTS[env]);
      s.on('error', () => this.sessions.delete(env));
      this.sessions.set(env, s);
    }
    return s;
  }

  private sendOnce(env: ApnsEnv, token: string, message: PushMessage): Promise<{ status: number; reason: string }> {
    const payload = JSON.stringify({
      aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
      ...(message.url ? { url: message.url } : {}),
    });
    return new Promise((resolve) => {
      const req = this.session(env).request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
        authorization: `bearer ${authToken()}`,
        'apns-topic': bundleId(),
        'apns-push-type': 'alert',
        'apns-priority': '10',
        ...(message.collapseId ? { 'apns-collapse-id': message.collapseId.slice(0, 64) } : {}),
      });
      let status = 0;
      let body = '';
      req.setEncoding('utf8');
      req.on('response', (headers) => {
        status = Number(headers[constants.HTTP2_HEADER_STATUS]);
      });
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        let reason = '';
        try {
          reason = body ? (JSON.parse(body) as { reason?: string }).reason ?? '' : '';
        } catch {
          reason = body.slice(0, 200);
        }
        resolve({ status, reason });
      });
      req.on('error', (err) => resolve({ status: 0, reason: err.message }));
      req.setTimeout(15_000, () => {
        req.close();
        resolve({ status: 0, reason: 'timeout' });
      });
      req.end(payload);
    });
  }

  // Xcode builds get sandbox tokens; TestFlight / App Store builds get
  // production ones, and nothing in the token says which. Try the
  // environment that last worked for this device, then the other.
  async send(token: string, message: PushMessage, preferred: ApnsEnv = 'production'): Promise<PushOutcome> {
    const order: ApnsEnv[] = preferred === 'production' ? ['production', 'sandbox'] : ['sandbox', 'production'];
    let last = { status: 0, reason: '' };
    let badTokenEverywhere = true;
    for (const env of order) {
      last = await this.sendOnce(env, token, message);
      if (last.status === 200) return { ok: true, env };
      if (last.status === 410) return { ok: false, gone: true, ...last };
      if (!(last.status === 400 && last.reason === 'BadDeviceToken')) {
        badTokenEverywhere = false;
        break; // auth/payload/server trouble — the other environment won't help
      }
    }
    return { ok: false, gone: badTokenEverywhere, ...last };
  }

  close(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
