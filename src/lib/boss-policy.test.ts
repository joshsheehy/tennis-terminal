import { describe, expect, it } from 'vitest';
import {
  BOSS_EDITABLE_FILES,
  bossPermissionRules,
  diffTooLarge,
  disallowedChanges,
  isSheetUrl,
  judgeAdminCall,
  leaksSecret,
} from './boss-policy';

describe('disallowedChanges', () => {
  it('passes the three registries and nothing else', () => {
    expect(disallowedChanges([...BOSS_EDITABLE_FILES])).toEqual([]);
    expect(disallowedChanges(['src/lib/ptl-code-overrides.ts', 'package.json', '.github/workflows/boss.yml', 'sql/019_x.sql'])).toEqual([
      'package.json',
      '.github/workflows/boss.yml',
      'sql/019_x.sql',
    ]);
  });
  it('does not treat a lookalike path as allowed', () => {
    expect(disallowedChanges(['src/lib/ptl-code-overrides.ts.bak', '../src/lib/surface-overrides.ts'])).toHaveLength(2);
  });
});

describe('diffTooLarge', () => {
  it('accepts a small entry and rejects a rewrite', () => {
    expect(diffTooLarge('6\t0\tsrc/lib/ptl-code-overrides.ts\n')).toBeNull();
    expect(diffTooLarge('200\t3\tsrc/lib/ptl-code-overrides.ts\n')).toMatch(/adds 200/);
    expect(diffTooLarge('2\t40\tsrc/lib/surface-overrides.ts\n')).toMatch(/removes 40/);
  });
  it('sums across files', () => {
    expect(diffTooLarge('40\t0\ta\n40\t0\tb\n')).toMatch(/adds 80/);
  });
});

describe('leaksSecret', () => {
  it('finds a secret anywhere in the text', () => {
    expect(leaksSecret('+ // key 0fcb3f39abcdef', ['0fcb3f39abcdef'])).toBe(true);
  });
  it('ignores unset and very short values', () => {
    expect(leaksSecret('anything 1 here', [undefined, '', '1'])).toBe(false);
  });
});

describe('isSheetUrl', () => {
  it('accepts ProTennisLive posting PDFs, live and archived', () => {
    expect(isSheetUrl('https://www.protennislive.com/posting/2025/7841/mds.pdf')).toBe(true);
    expect(isSheetUrl('https://www.protennislive.com/posting/2025/7841/qs.pdf')).toBe(true);
    expect(isSheetUrl('https://web.archive.org/web/20220106id_/https://www.protennislive.com/posting/2022/7841/mdd.pdf')).toBe(true);
  });
  it('rejects other hosts, schemes, paths and tricks', () => {
    expect(isSheetUrl('http://www.protennislive.com/posting/2025/7841/mds.pdf')).toBe(false);
    expect(isSheetUrl('https://evil.example/posting/2025/7841/mds.pdf')).toBe(false);
    expect(isSheetUrl('https://www.protennislive.com.evil.example/posting/2025/7841/mds.pdf')).toBe(false);
    expect(isSheetUrl('https://www.protennislive.com/posting/2025/7841/mds.pdf?x=1')).toBe(false);
    expect(isSheetUrl('https://www.protennislive.com/other.pdf')).toBe(false);
    expect(isSheetUrl('https://user:pw@www.protennislive.com/posting/2025/7841/mds.pdf')).toBe(false);
    expect(isSheetUrl('https://web.archive.org/web/2022/https://evil.example/posting/2022/7841/mds.pdf')).toBe(false);
    expect(isSheetUrl('not a url')).toBe(false);
  });
});

describe('judgeAdminCall', () => {
  const sheet = 'https://www.protennislive.com/posting/2025/7841/mds.pdf';
  it('lets the boss read the reports', () => {
    expect(judgeAdminCall('/api/missing-cuts-report', {})).toEqual({ ok: true, mutating: false });
    expect(judgeAdminCall('/api/code-audit', { year: '2026' })).toEqual({ ok: true, mutating: false });
  });
  it('treats cleanup and alias routes as read-only until apply=true', () => {
    expect(judgeAdminCall('/api/cleanup-anomalous-cuts', {})).toEqual({ ok: true, mutating: false });
    expect(judgeAdminCall('/api/cleanup-anomalous-cuts', { apply: 'true' })).toEqual({ ok: true, mutating: true });
    expect(judgeAdminCall('/api/resolve-tournament-aliases', { apply: 'true' })).toEqual({ ok: true, mutating: true });
    expect(judgeAdminCall('/api/resolve-tournament-aliases', { apply: 'true', slug: 'x' }).ok).toBe(false);
  });
  it('lets it re-run an import from a real sheet, and only that', () => {
    const q = { url: sheet, slug: 'plovdiv-4', year: '2026', event: 'singles', draw: 'main' };
    expect(judgeAdminCall('/api/import-pdf-direct', q)).toEqual({ ok: true, mutating: true });
    expect(judgeAdminCall('/api/import-pdf-direct', { url: sheet, debug: 'true' })).toEqual({ ok: true, mutating: false });
    expect(judgeAdminCall('/api/import-pdf-direct', { ...q, url: 'https://evil.example/x.pdf' }).ok).toBe(false);
    expect(judgeAdminCall('/api/import-pdf-direct', { ...q, year: '1999' }).ok).toBe(false);
    expect(judgeAdminCall('/api/import-pdf-direct', { ...q, draw: 'x' }).ok).toBe(false);
  });
  it('refuses set-cut, deletes and anything unlisted, and refuses a supplied key', () => {
    expect(judgeAdminCall('/api/set-cut', { slug: 'a', year: '2025', cuts: 'singles:main:5', apply: 'true' }).ok).toBe(false);
    expect(judgeAdminCall('/api/delete-edition', {}).ok).toBe(false);
    expect(judgeAdminCall('/api/run-all', {}).ok).toBe(false);
    expect(judgeAdminCall('/api/code-audit', { key: 'x' }).ok).toBe(false);
  });
});

describe('bossPermissionRules', () => {
  it('names each editable file and only the wrapper for shell access', () => {
    const { allow, tools } = bossPermissionRules();
    expect(allow.filter((a) => a.startsWith('Edit('))).toHaveLength(BOSS_EDITABLE_FILES.length);
    expect(allow).toContain('Bash(node scripts/boss/tools.mjs *)');
    expect(allow.some((a) => a.startsWith('Bash(') && !a.includes('scripts/boss/tools.mjs'))).toBe(false);
    expect(tools).not.toContain('WebFetch');
  });
});
