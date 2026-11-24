// Push notifications from inside the iOS app (Capacitor). Everything here is
// a no-op on the website: the plugin is only imported when running natively.

import { accountApi } from './account-client';

const TOKEN_KEY = 'tc-push-token';

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function storedPushToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode etc. — the server still has the device
  }
}

// Capacitor plugin objects are proxies that answer *every* property —
// including `then`. Returned straight from an async function, the promise
// machinery sees a "thenable" and waits on it forever (no prompt, no error).
// So hand it back wrapped in a plain object.
async function plugin() {
  const mod = await import('@capacitor/push-notifications');
  return { Push: mod.PushNotifications };
}

// Ask iOS for a device token. Resolves with it, or null if the user declined
// or registration failed.
async function obtainToken(promptIfNeeded: boolean): Promise<string | null> {
  const { Push } = await plugin();
  let perm = await Push.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    if (!promptIfNeeded) return null;
    perm = await Push.requestPermissions();
  }
  if (perm.receive !== 'granted') return null;

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      ok.then((h) => h.remove());
      fail.then((h) => h.remove());
      resolve(value);
    };
    const ok = Push.addListener('registration', (t) => done(t.value));
    const fail = Push.addListener('registrationError', () => done(null));
    setTimeout(() => done(null), 15_000);
    Push.register();
  });
}

// What a phone with push on and no account gets alerts about (the account
// version lives on its alert preferences instead).
export type DevicePrefs = { categories: string[]; includeDoubles: boolean; reminderHours: number[] };

type RegisterReply = { standalone?: boolean; categories?: string[]; includeDoubles?: boolean; reminderHours?: number[] };

function standalonePrefs(reply: RegisterReply): DevicePrefs | null {
  if (!reply.standalone || !reply.categories || !reply.reminderHours) return null;
  return { categories: reply.categories, includeDoubles: reply.includeDoubles === true, reminderHours: reply.reminderHours };
}

export type EnableResult =
  | { ok: true; prefs: DevicePrefs | null }
  | { ok: false; reason: 'denied' | 'failed'; message: string };

// Turn push on for this phone: permission prompt (first time), token, then
// register it: with the signed-in account, or (signed out) on its own, which
// answers with the phone's own preferences.
export async function enablePush(): Promise<EnableResult> {
  const token = await obtainToken(true);
  if (!token) {
    const { Push } = await plugin();
    const perm = await Push.checkPermissions();
    return perm.receive === 'denied'
      ? { ok: false, reason: 'denied', message: 'Notifications are off for TennisCuts. Turn them on in iPhone Settings → TennisCuts → Notifications.' }
      : { ok: false, reason: 'failed', message: "Couldn't register this phone for notifications. Try again." };
  }
  const result = await accountApi<RegisterReply>('/api/push/register', 'POST', { token });
  if (!result.ok) return { ok: false, reason: 'failed', message: result.error };
  storeToken(token);
  return { ok: true, prefs: standalonePrefs(result) };
}

// Turn push off for this phone (also on account deletion).
export async function disablePush(): Promise<void> {
  const token = storedPushToken();
  if (token) await accountApi('/api/push/unregister', 'POST', { token });
  storeToken(null);
}

// Signing out doesn't turn push off: registering again signed out takes the
// phone off the account and copies the account's preferences onto it.
export async function keepPushAfterSignOut(): Promise<void> {
  const token = storedPushToken();
  if (token) await accountApi('/api/push/register', 'POST', { token });
}

// The Alerts screen, signed out: is push on for this phone, and for what?
// Registering again is harmless and answers both.
export async function loadStandalonePush(): Promise<{ on: boolean; prefs: DevicePrefs | null; error?: string }> {
  const token = storedPushToken();
  if (!token) return { on: false, prefs: null };
  const result = await accountApi<RegisterReply>('/api/push/register', 'POST', { token });
  if (!result.ok) return { on: true, prefs: null, error: result.error };
  return { on: true, prefs: standalonePrefs(result) };
}

export async function saveStandalonePrefs(prefs: DevicePrefs) {
  return accountApi('/api/push/prefs', 'PUT', { token: storedPushToken(), ...prefs });
}

// Signed in, the server sends to the account's phones; signed out, to this one.
export async function sendTestPush() {
  return accountApi('/api/push/test', 'POST', { token: storedPushToken() });
}

// On app launch: if this phone had push on, re-send its (possibly rotated)
// token. Never prompts.
export async function refreshPushRegistration(): Promise<void> {
  const previousToken = storedPushToken();
  if (!previousToken) return;
  const token = await obtainToken(false);
  if (!token) return;
  const result = await accountApi('/api/push/register', 'POST', { token, previousToken });
  if (result.ok) storeToken(token);
}

// Tapping a notification opens the page it points at (e.g. /alerts).
export async function listenForNotificationTaps(): Promise<void> {
  const { Push } = await plugin();
  await Push.addListener('pushNotificationActionPerformed', (action) => {
    const url = (action.notification.data as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      window.location.assign(url);
    }
  });
}
