import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SaveButton from './SaveButton';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

type Call = { url: string; method: string; body?: string };

// Fake the account API: `saved` is what the server already has for the user.
function mockApi({ signedIn, saved }: { signedIn: boolean; saved: string[] }) {
  const calls: Call[] = [];
  let have = [...saved];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: init.body as string | undefined });
      if (url === '/api/auth/me') {
        return Response.json({ ok: true, user: signedIn ? { email: 'a@x.co' } : null, savedEditionIds: have });
      }
      const ids = (JSON.parse(String(init.body)) as { editionIds: string[] }).editionIds;
      have = method === 'DELETE' ? have.filter((id) => !ids.includes(id)) : Array.from(new Set([...have, ...ids]));
      return Response.json({ ok: true, savedEditionIds: have });
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('SaveButton in the Builder (schedule mode)', () => {
  it('saves the whole chain, then links to the saved schedule', async () => {
    const calls = mockApi({ signedIn: true, saved: [] });
    render(<SaveButton editionIds={[A, B]} schedule label="Save to schedule" savedLabel="Saved: view schedule" />);
    const button = await screen.findByRole('button', { name: 'Save to schedule' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const link = await screen.findByRole('link', { name: 'Saved: view schedule' });
    expect(link.getAttribute('href')).toBe('/account');
    expect(calls.find((c) => c.url === '/api/saved')).toMatchObject({ method: 'POST' });
  });

  it('never unsaves a one-stop chain on a second tap', async () => {
    const calls = mockApi({ signedIn: true, saved: [] });
    render(<SaveButton editionIds={[A]} schedule label="Save to schedule" savedLabel="Saved: view schedule" />);
    const button = await screen.findByRole('button', { name: 'Save to schedule' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByRole('link', { name: 'Saved: view schedule' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('offers to save again once a new stop is added', async () => {
    mockApi({ signedIn: true, saved: [A] });
    const { rerender } = render(<SaveButton editionIds={[A]} schedule label="Save to schedule" savedLabel="Saved: view schedule" />);
    await screen.findByRole('link', { name: 'Saved: view schedule' });
    rerender(<SaveButton editionIds={[A, B]} schedule label="Save to schedule" savedLabel="Saved: view schedule" />);
    expect(await screen.findByRole('button', { name: 'Save to schedule' })).toBeTruthy();
  });

  it('sends a signed-out visitor to sign in instead of saving', async () => {
    const calls = mockApi({ signedIn: false, saved: [] });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/', search: `?build=${A}` });
    render(<SaveButton editionIds={[A]} schedule label="Save to schedule" savedLabel="Saved: view schedule" />);
    const button = await screen.findByRole('button', { name: 'Save to schedule' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/?build=${A}`)}`);
    expect(calls.some((c) => c.url === '/api/saved')).toBe(false);
  });
});

describe('SaveButton on a tournament page (single)', () => {
  it('toggles save and unsave', async () => {
    const calls = mockApi({ signedIn: true, saved: [] });
    render(<SaveButton editionIds={[A]} label="Save 2026" savedLabel="Saved 2026" />);
    const button = await screen.findByRole('button', { name: 'Save 2026' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: 'Saved 2026' }));
    await screen.findByRole('button', { name: 'Save 2026' });
    expect(calls.filter((c) => c.url === '/api/saved').map((c) => c.method)).toEqual(['POST', 'DELETE']);
  });
});
