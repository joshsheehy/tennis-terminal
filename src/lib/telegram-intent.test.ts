import { describe, expect, it } from 'vitest';
import { intentFor } from './telegram-intent';

describe('intentFor', () => {
  it('reads status-shaped questions', () => {
    for (const t of ['status', '/status', 'Status?', 'has anything been resolved?', 'is it fixed', 'any progress', "what's done"])
      expect(intentFor(t)).toBe('status');
  });
  it('reads list-shaped questions', () => {
    for (const t of ['open', '/open', 'list', 'cases', 'what is on the todo list']) expect(intentFor(t)).toBe('list');
  });
  it('falls back to help for anything else', () => {
    for (const t of ['hi', 'thanks', '', 'what is this bot']) expect(intentFor(t)).toBe('help');
  });
  it('prefers list over status when a message could read either way', () => {
    expect(intentFor('list what is open')).toBe('list');
  });
});
