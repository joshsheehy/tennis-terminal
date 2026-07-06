// Minimal transactional-email helper. Uses the Resend REST API directly via
// fetch so we don't add an npm dependency (the codebase already talks to every
// other service with plain fetch). Set these on Railway:
//
//   RESEND_API_KEY   - from https://resend.com (free tier is plenty for this)
//   ALERT_FROM_EMAIL - a verified sender, e.g. "Tennis Cuts <alerts@yourdomain>".
//                      Before you verify a domain, Resend lets you send from
//                      "onboarding@resend.dev" to your OWN account email — ideal
//                      for testing with yourself.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type SendResult = { ok: boolean; id?: string; error?: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function fromAddress(): string {
  return process.env.ALERT_FROM_EMAIL || 'Tennis Cuts <onboarding@resend.dev>';
}

// One-click unsubscribe headers (RFC 8058). Gmail/Yahoo bulk-sender rules
// expect these, and they materially improve inbox placement (fewer spam
// classifications). The URL must accept a POST for true one-click.
export function listUnsubscribeHeaders(unsubUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not set' };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.headers ? { headers: opts.headers } : {}),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!response.ok) {
      return { ok: false, error: body.message || `Resend returned ${response.status}` };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
  }
}
