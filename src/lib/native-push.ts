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

// Step-by-step trace, visible in the iOS app's console (Xcode / devicectl).
function trace(step: string, detail?: unknown) {
  console.log(`[push] ${step}`, detail === undefined ? '' : JSON.stringify(detail));
}

// Capacitor plugin objects are proxies that answer *every* property —
// including `then`. Returned straight from an async function, the promise
// machinery sees a "thenable" and waits on it forever (no prompt, no error).
// So hand it back wrapped in a plain object.
async function plugin() {
  trace('loading plugin');
  const mod = await import('@capacitor/push-notifications');
  trace('plugin loaded');
  return { Push: mod.PushNotifications };
}

// Ask iOS for a device token. Resolves with it, or null if the user declined
// or registration failed.
async function obtainToken(promptIfNeeded: boolean): Promise<string | null> {
  const { Push } = await plugin();
  trace('checkPermissions');
  let perm = await Push.checkPermissions();
  trace('permission', perm);
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    if (!promptIfNeeded) return null;
    trace('requestPermissions');
    perm = await Push.requestPermissions();
    trace('permission after prompt', perm);
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
    trace('register');
    Push.register();
  });
}

export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'failed'; message: string };

// Turn push on for this phone: permission prompt (first time), token, then
// tie the token to the signed-in account.
export async function enablePush(): Promise<EnableResult> {
  trace('enable');
  const token = await obtainToken(true);
  if (!token) {
    const { Push } = await plugin();
    const perm = await Push.checkPermissions();
    return perm.receive === 'denied'
      ? { ok: false, reason: 'denied', message: 'Notifications are off for TennisCuts. Turn them on in iPhone Settings → TennisCuts → Notifications.' }
      : { ok: false, reason: 'failed', message: "Couldn't register this phone for notifications. Try again." };
  }
  const result = await accountApi('/api/push/register', 'POST', { token });
  if (!result.ok) return { ok: false, reason: 'failed', message: result.error };
  storeToken(token);
  return { ok: true };
}

// Turn push off for this phone (also used on sign-out, so the phone stops
// getting the previous account's alerts).
export async function disablePush(): Promise<void> {
  const token = storedPushToken();
  if (token) await accountApi('/api/push/unregister', 'POST', { token });
  storeToken(null);
}

// On app launch: if this phone had push on, re-send its (possibly rotated)
// token. Never prompts.
export async function refreshPushRegistration(): Promise<void> {
  if (!storedPushToken()) return;
  const token = await obtainToken(false);
  if (!token) return;
  const result = await accountApi('/api/push/register', 'POST', { token });
  if (result.ok) storeToken(token);
  else if (result.status === 401) storeToken(null); // signed out elsewhere
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
