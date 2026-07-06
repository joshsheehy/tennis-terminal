import { describe, expect, it } from 'vitest';
import { renderWelcome, unsubscribeUrl, managePrefsUrl } from './alert-email';

describe('renderWelcome', () => {
  it('lists the chosen tours and links to manage/unsubscribe', () => {
    const { subject, html, text } = renderWelcome({
      origin: 'https://tenniscuts.com',
      token: 'tok123',
      categories: ['grandslam', 'atp'],
      includeDoubles: false,
    });
    expect(subject).toMatch(/subscribed/i);
    expect(html).toContain('Grand Slam');
    expect(html).toContain('ATP Tour');
    expect(html).toContain(managePrefsUrl('https://tenniscuts.com', 'tok123'));
    expect(html).toContain(unsubscribeUrl('https://tenniscuts.com', 'tok123'));
    // No confirmation step advertised.
    expect(text).toMatch(/no confirmation needed/i);
    // Doubles not opted in -> not mentioned.
    expect(html).not.toContain('Doubles (advance entry)');
  });

  it('mentions doubles when opted in', () => {
    const { html, text } = renderWelcome({
      origin: 'https://tenniscuts.com',
      token: 't',
      categories: ['challenger'],
      includeDoubles: true,
    });
    expect(html).toContain('Doubles (advance entry)');
    expect(text).toContain('Doubles (advance entry)');
  });
});
