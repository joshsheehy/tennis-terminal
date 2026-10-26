import { SITE_URL } from './brand';

// The sign-in code email. Same look as the alert emails (alert-email.ts):
// logo + wordmark header, plain body, text alternative.

export function renderLoginCodeEmail(code: string, ttlMinutes: number): { subject: string; html: string; text: string } {
  const subject = `${code} is your Tennis Cuts sign-in code`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <div style="margin:0 0 16px;line-height:1">
      <img src="${SITE_URL}/logo-mark.png" width="28" height="28" alt="Tennis Cuts" style="vertical-align:middle;margin-right:8px;border:0" />
      <span style="font-size:20px;font-weight:700;color:#111;vertical-align:middle">Tennis<span style="color:#3CB043">Cuts</span></span>
    </div>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">Enter this code to sign in:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 16px;font-family:ui-monospace,Menlo,monospace">${code}</p>
    <p style="font-size:13px;color:#555;line-height:1.5;margin:0">It expires in ${ttlMinutes} minutes. If you didn't ask to sign in, you can ignore this email.</p>
  </div>`;
  const text = `Your Tennis Cuts sign-in code is ${code}\n\nIt expires in ${ttlMinutes} minutes. If you didn't ask to sign in, you can ignore this email.`;
  return { subject, html, text };
}
