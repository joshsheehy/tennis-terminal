import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlertOffer, { OFFER_DISMISSED_KEY } from './AlertOffer';

const push = vi.hoisted(() => ({
  native: false,
  enable: vi.fn(),
}));
vi.mock('@/lib/native-push', () => ({
  isNativeApp: () => push.native,
  enablePush: push.enable,
}));

type Call = { url: string; method: string; body: unknown };

function mockApi(ok = true) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
      return ok ? Response.json({ ok: true }) : Response.json({ ok: false, error: 'Nope' }, { status: 500 });
    })
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  push.native = false;
  push.enable.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('AlertOffer', () => {
  it('turns on email alerts with only the basic defaults', async () => {
    const calls = mockApi();
    render(<AlertOffer email="a@x.co" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on email alerts' }));
    expect(await screen.findByText('Alerts are on')).toBeTruthy();
    expect(calls).toEqual([
      {
        url: '/api/alerts/prefs',
        method: 'PUT',
        body: { categories: ['grandslam', 'atp', 'challenger'], includeDoubles: false, reminderHours: [24], emailOn: true },
      },
    ]);
  });

  it('"Not now" hides it and keeps it hidden on this device', async () => {
    const calls = mockApi();
    const { unmount } = render(<AlertOffer email="a@x.co" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Get entry-deadline alerts?')).toBeNull();
    expect(localStorage.getItem(OFFER_DISMISSED_KEY)).toBe('1');
    unmount();

    render(<AlertOffer email="a@x.co" />);
    await waitFor(() => expect(screen.queryByText('Get entry-deadline alerts?')).toBeNull());
    expect(calls).toEqual([]);
  });

  it('shows the error and stays open when saving fails', async () => {
    mockApi(false);
    render(<AlertOffer email="a@x.co" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on email alerts' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nope');
    expect(screen.queryByText('Alerts are on')).toBeNull();
  });

  it('in the app, turns on push without touching email', async () => {
    push.native = true;
    push.enable.mockResolvedValue({ ok: true });
    const calls = mockApi();
    render(<AlertOffer email="a@x.co" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByText(/You’ll get a notification/)).toBeTruthy();
    expect(push.enable).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });

  it('in the app, points to email when notifications are denied', async () => {
    push.native = true;
    push.enable.mockResolvedValue({ ok: false, reason: 'denied', message: 'Notifications are off.' });
    mockApi();
    render(<AlertOffer email="a@x.co" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Or get them by email instead.');
    expect(screen.getByRole('button', { name: 'Email me instead' })).toBeTruthy();
  });
});
