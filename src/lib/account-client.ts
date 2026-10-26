// Browser-side calls to the account API. Every write is JSON — the server
// rejects anything else (see rejectUnsafeWrite in auth-request.ts).

export type ApiResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export async function accountApi<T = Record<string, unknown>>(
  url: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!response.ok || !data.ok) {
      return { ok: false, error: data.error || 'Something went wrong. Please try again.', status: response.status };
    }
    return { ...data, ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach Tennis Cuts. Check your connection.", status: 0 };
  }
}

export type Me = { user: { email: string } | null; savedEditionIds: string[] };

export async function fetchMe(): Promise<Me | null> {
  const result = await accountApi<Me>('/api/auth/me');
  return result.ok ? { user: result.user, savedEditionIds: result.savedEditionIds } : null;
}

// Where to send a signed-out visitor who tried to save: back to this page
// after signing in.
export function loginHref(): string {
  const here = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(here)}`;
}
