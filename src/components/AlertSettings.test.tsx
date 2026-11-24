import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlertSettings, { PhoneAlertSettings } from './AlertSettings';

const push = vi.hoisted(() => ({
  native: true,
  token: null as string | null,
  enable: vi.fn(),
  disable: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
}));
vi.mock('@/lib/native-push', () => ({
  isNativeApp: () => push.native,
  storedPushToken: () => push.token,
  enablePush: push.enable,
  disablePush: push.disable,
  loadStandalonePush: push.load,
  saveStandalonePrefs: push.save,
  sendTestPush: push.test,
}));

type Call = { url: string; method: string; body: unknown };

function mockApi(replies: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ ok: true, ...((replies[`${method} ${url}`] as object) ?? {}) });
    })
  );
  return calls;
}

const tourSwitch = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const PHONE_PREFS = { categories: ['atp', 'itf'], includeDoubles: true, reminderHours: [12] };

beforeEach(() => {
  push.native = true;
  push.token = null;
  for (const fn of [push.enable, push.disable, push.load, push.save, push.test]) fn.mockReset();
  push.load.mockResolvedValue({ on: false, prefs: null });
  push.save.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('PhoneAlertSettings (signed out, in the app)', () => {
  it('greys out and locks every choice until push is on', async () => {
    mockApi();
    const { container } = render(<PhoneAlertSettings />);
    expect(await screen.findByText(/Push notifications are off/)).toBeTruthy();
    expect(container.querySelector('.alerts-settings__body--off')).not.toBeNull();
    expect(tourSwitch(/Grand Slam/).disabled).toBe(true);
    expect(tourSwitch(/24 hours before/).disabled).toBe(true);
  });

  it('turning push on unlocks the choices and shows the phone’s own', async () => {
    mockApi();
    push.enable.mockResolvedValue({ ok: true, prefs: PHONE_PREFS });
    const { container } = render(<PhoneAlertSettings />);
    const master = await screen.findByRole('checkbox', { name: /Push notifications/ });
    await waitFor(() => expect((master as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(master);

    await waitFor(() => expect(tourSwitch(/ITF World Tennis Tour/).checked).toBe(true));
    expect(container.querySelector('.alerts-settings__body--off')).toBeNull();
    expect(tourSwitch(/Grand Slam/).disabled).toBe(false);
    expect(tourSwitch(/Grand Slam/).checked).toBe(false);
    expect(tourSwitch(/12 hours before/).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeTruthy();
  });

  it('saves changes to the phone (no submit button)', async () => {
    mockApi();
    push.token = 'a'.repeat(64);
    push.load.mockResolvedValue({ on: true, prefs: PHONE_PREFS });
    render(<PhoneAlertSettings />);
    await waitFor(() => expect(tourSwitch(/Grand Slam/).disabled).toBe(false));
    fireEvent.click(tourSwitch(/Grand Slam/));
    await waitFor(() => expect(push.save).toHaveBeenCalledOnce());
    expect(push.save).toHaveBeenCalledWith({ ...PHONE_PREFS, categories: ['atp', 'itf', 'grandslam'] });
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('turning push off locks the choices again', async () => {
    mockApi();
    push.token = 'a'.repeat(64);
    push.load.mockResolvedValue({ on: true, prefs: PHONE_PREFS });
    push.disable.mockResolvedValue(undefined);
    render(<PhoneAlertSettings />);
    await waitFor(() => expect(tourSwitch(/Grand Slam/).disabled).toBe(false));
    fireEvent.click(screen.getByRole('checkbox', { name: /Push notifications/ }));
    await waitFor(() => expect(tourSwitch(/Grand Slam/).disabled).toBe(true));
    expect(push.disable).toHaveBeenCalledOnce();
  });

  it('adding an email signs in, brings push along and turns email on', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    push.token = 'b'.repeat(64);
    push.load.mockResolvedValue({ on: true, prefs: PHONE_PREFS });
    const calls = mockApi({ 'GET /api/alerts/prefs': { exists: true, ...PHONE_PREFS, emailOn: false } });
    render(<PhoneAlertSettings />);
    expect(await screen.findByText('Also get them by email?')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'new@x.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '6-digit code' }), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(calls).toEqual([
      { url: '/api/auth/request-code', method: 'POST', body: { email: 'new@x.co' } },
      { url: '/api/auth/verify', method: 'POST', body: { email: 'new@x.co', code: '123456' } },
      { url: '/api/push/register', method: 'POST', body: { token: 'b'.repeat(64) } },
      { url: '/api/alerts/prefs', method: 'GET', body: undefined },
      { url: '/api/alerts/prefs', method: 'PUT', body: { ...PHONE_PREFS, emailOn: true } },
    ]);
  });

  it('falls back to the email form without the native bridge', async () => {
    push.native = false;
    mockApi();
    render(<PhoneAlertSettings />);
    expect(await screen.findByRole('button', { name: 'Notify me' })).toBeTruthy();
  });
});

describe('AlertSettings (signed in, in the app)', () => {
  const INITIAL = { categories: ['grandslam', 'atp', 'challenger'], includeDoubles: false, reminderHours: [24], emailOn: false };

  it('is locked while neither push nor email is on, and unlocks with email', async () => {
    const calls = mockApi();
    render(<AlertSettings email="a@x.co" initial={INITIAL} />);
    expect(await screen.findByText(/Alerts are off/)).toBeTruthy();
    expect(tourSwitch(/Grand Slam/).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Email (a@x.co)' }));
    expect(tourSwitch(/Grand Slam/).disabled).toBe(false);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: '/api/alerts/prefs', method: 'PUT', body: { ...INITIAL, emailOn: true } });
  });

  it('is unlocked when this phone already has push on', async () => {
    mockApi();
    push.token = 'c'.repeat(64);
    render(<AlertSettings email="a@x.co" initial={INITIAL} />);
    await waitFor(() => expect(tourSwitch(/Grand Slam/).disabled).toBe(false));
    expect(screen.queryByText(/Alerts are off/)).toBeNull();
  });
});
