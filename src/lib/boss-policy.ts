// What the "boss" agent (scripts/boss/) is allowed to do. Everything here is deterministic and enforced by
// the runner, not by asking the model nicely: the model can be wrong, or be fed hostile text by a sheet it
// reads, so its reach is bounded by code.

/** The only files the boss may change: small registries that each hold one reviewed fix per entry. */
export const BOSS_EDITABLE_FILES = [
  'src/lib/ptl-code-overrides.ts',
  'src/lib/surface-overrides.ts',
  'src/lib/tournament-aliases.ts',
] as const;

export const MAX_ADDED_LINES = 60;
export const MAX_REMOVED_LINES = 15;
export const MAX_MUTATIONS_PER_RUN = 25;
export const MAX_SHEET_FETCHES_PER_RUN = 30;

/** Claude Code permission rules for the boss session. Edit rules are root-relative; they cover every edit tool. */
export function bossPermissionRules() {
  return {
    tools: ['Read', 'Glob', 'Grep', 'Edit', 'Bash'],
    allow: [
      'Read',
      'Glob',
      'Grep',
      ...BOSS_EDITABLE_FILES.map((f) => `Edit(/${f})`),
      'Bash(node scripts/boss/tools.mjs *)',
    ],
  };
}

/** Changed paths (modified, added, deleted or renamed) that are not on the boss's list. */
export function disallowedChanges(changed: string[]): string[] {
  const allowed = new Set<string>(BOSS_EDITABLE_FILES);
  return changed.map((p) => p.trim()).filter((p) => p && !allowed.has(p));
}

/** `git diff --numstat` rows must stay small: an entry or two, not a rewrite. */
export function diffTooLarge(numstat: string): string | null {
  let added = 0;
  let removed = 0;
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, r] = line.split('\t');
    added += a === '-' ? 0 : Number(a) || 0;
    removed += r === '-' ? 0 : Number(r) || 0;
  }
  if (added > MAX_ADDED_LINES) return `adds ${added} lines (limit ${MAX_ADDED_LINES})`;
  if (removed > MAX_REMOVED_LINES) return `removes ${removed} lines (limit ${MAX_REMOVED_LINES})`;
  return null;
}

/** True when any secret value appears in `text`. Short values are ignored so "1" cannot match everything. */
export function leaksSecret(text: string, secrets: Array<string | undefined>): boolean {
  return secrets.some((s) => typeof s === 'string' && s.length >= 8 && text.includes(s));
}

const PTL_POSTING = /^\/posting\/\d{4}\/\d+\/(mds|qs|mdd)\.pdf$/i;

/** A draw-sheet URL the boss may fetch: ProTennisLive's own posting path, live or through the Wayback Machine. */
export function isSheetUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'www.protennislive.com' || host === 'protennislive.com') return PTL_POSTING.test(u.pathname) && !u.search;
  if (host === 'web.archive.org') {
    const m = u.pathname.match(/^\/web\/\d{4,14}(?:id_)?\/https?:\/\/(?:www\.)?protennislive\.com(\/posting\/.+)$/i);
    return !!m && PTL_POSTING.test(m[1]);
  }
  return false;
}

export type AdminVerdict = { ok: true; mutating: boolean } | { ok: false; reason: string };

const READ_ONLY_ROUTES = new Set(['/api/missing-cuts-report', '/api/code-audit', '/api/discovery-health']);
const APPLY_ROUTES = new Set(['/api/cleanup-anomalous-cuts', '/api/resolve-tournament-aliases']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

/**
 * May the boss call this admin route? Only routes whose writes come from the app's own parsers and
 * guards: it can re-run an import or a cleanup, never type a cut value in by hand.
 */
export function judgeAdminCall(path: string, query: Record<string, string>): AdminVerdict {
  if ('key' in query) return { ok: false, reason: 'the admin key is added by the tool, not passed by you' };
  if (READ_ONLY_ROUTES.has(path)) return { ok: true, mutating: false };
  if (APPLY_ROUTES.has(path)) {
    const extra = Object.keys(query).filter((k) => k !== 'apply');
    if (extra.length) return { ok: false, reason: `${path} takes only apply=true` };
    return { ok: true, mutating: query.apply === 'true' };
  }
  if (path === '/api/import-pdf-direct') {
    if (!query.url || !isSheetUrl(query.url)) return { ok: false, reason: 'url must be a ProTennisLive posting PDF (live or web.archive.org)' };
    if (query.debug === 'true') return { ok: true, mutating: false };
    const year = Number(query.year);
    if (!SLUG.test(query.slug ?? '')) return { ok: false, reason: 'slug looks wrong' };
    if (!Number.isInteger(year) || year < 2020 || year > 2030) return { ok: false, reason: 'year must be 2020-2030' };
    if (!['singles', 'doubles'].includes(query.event ?? '')) return { ok: false, reason: 'event must be singles or doubles' };
    if (!['main', 'qualifying'].includes(query.draw ?? '')) return { ok: false, reason: 'draw must be main or qualifying' };
    return { ok: true, mutating: true };
  }
  return { ok: false, reason: `${path} is not one of the routes the boss may call` };
}
