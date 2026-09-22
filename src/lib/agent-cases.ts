import type { PoolClient } from 'pg';
import { pool, withTransaction } from './db';

// The audit bot's case ledger (sql/018). One row per problem, identified by the audit's stable key.

export type CaseStatus = 'open' | 'in_progress' | 'fixed' | 'escalated' | 'acknowledged';
export type Severity = 'critical' | 'warn';

export type Finding = {
  key: string;
  severity: Severity;
  title: string;
  text: string;
  data?: Record<string, unknown>;
};

export type CaseRow = {
  id: number;
  key: string;
  check_id: string;
  severity: Severity;
  title: string;
  detail: string;
  data: Record<string, unknown>;
  status: CaseStatus;
  first_seen: string;
  last_seen: string;
  times_seen: number;
  attempts: number;
  last_attempt_at: string | null;
  escalated_at: string | null;
  notified_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
};

export type CaseEvent = { at: string; actor: string; action: string; note: string };

// States a fix can still resolve. An acknowledged case is one the user chose to stop hearing about, but
// if the problem genuinely goes away it should still close.
const OPEN_STATES: CaseStatus[] = ['open', 'in_progress', 'escalated', 'acknowledged'];

/** The boss stops retrying a case after this many failed attempts and hands it to the user. */
export const MAX_ATTEMPTS = 2;

/** The check a key belongs to: "A2|plovdiv-4@2026" -> "A2", "D2" -> "D2". */
export function checkIdOf(key: string): string {
  return key.split('|')[0];
}

let tablesReady: Promise<void> | null = null;

/** Create the ledger tables on first use, so the code can deploy before sql/018 is applied. */
export function ensureAgentTables(): Promise<void> {
  tablesReady ??= (async () => {
    const found = await pool.query<{ ok: boolean }>(`select to_regclass('public.agent_cases') is not null as ok`);
    if (found.rows[0]?.ok) return;
    await pool.query(`
      create table if not exists agent_cases (
        id bigserial primary key, key text not null unique, check_id text not null,
        severity text not null check (severity in ('critical', 'warn')),
        title text not null, detail text not null default '', data jsonb not null default '{}'::jsonb,
        status text not null default 'open' check (status in ('open', 'in_progress', 'fixed', 'escalated', 'acknowledged')),
        first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
        times_seen int not null default 1, attempts int not null default 0,
        last_attempt_at timestamptz, escalated_at timestamptz, notified_at timestamptz,
        resolved_at timestamptz, resolution text, updated_at timestamptz not null default now()
      );
      create index if not exists agent_cases_status_idx on agent_cases(status);
      create index if not exists agent_cases_check_idx on agent_cases(check_id);
      create table if not exists agent_case_events (
        id bigserial primary key, case_id bigint not null references agent_cases(id) on delete cascade,
        at timestamptz not null default now(), actor text not null, action text not null, note text not null default ''
      );
      create index if not exists agent_case_events_case_idx on agent_case_events(case_id, at desc);
      create table if not exists agent_kv (
        key text primary key, value jsonb not null, updated_at timestamptz not null default now()
      );
    `);
  })().catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
}

async function event(client: PoolClient, caseId: number, actor: string, action: string, note = '') {
  await client.query('insert into agent_case_events (case_id, actor, action, note) values ($1, $2, $3, $4)', [
    caseId,
    actor,
    action,
    note.slice(0, 1500),
  ]);
}

export type SyncResult = { opened: number; updated: number; reopened: number; resolved: number };

/**
 * Record what one audit run found.
 *   - a finding not seen before opens a case;
 *   - one already open is refreshed; one that was fixed and came back is reopened;
 *   - an open case whose check RAN this time but no longer reports it is marked fixed.
 * `ran` is the checks that actually executed, so a daily health run cannot "fix" a coverage problem it
 * never looked at. `verified` is for sampled checks (V1 re-reads a handful of sheets each run): the keys
 * that were looked at this time and found correct, the only ones such a check may close.
 */
export async function syncFindings(input: { source: string; ran: string[]; verified?: string[]; findings: Finding[] }): Promise<SyncResult> {
  await ensureAgentTables();
  const out: SyncResult = { opened: 0, updated: 0, reopened: 0, resolved: 0 };
  const seen = new Set(input.findings.map((f) => f.key));

  await withTransaction(async (client) => {
    for (const f of input.findings) {
      const existing = await client.query<{ id: number; status: CaseStatus }>(
        'select id, status from agent_cases where key = $1 for update',
        [f.key]
      );
      const row = existing.rows[0];
      if (!row) {
        const created = await client.query<{ id: number }>(
          `insert into agent_cases (key, check_id, severity, title, detail, data)
           values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
          [f.key, checkIdOf(f.key), f.severity, f.title.slice(0, 300), f.text.slice(0, 2000), JSON.stringify(f.data ?? {})]
        );
        await event(client, created.rows[0].id, input.source, 'opened', f.text);
        out.opened += 1;
      } else if (row.status === 'fixed') {
        await client.query(
          `update agent_cases set status = 'open', attempts = 0, resolved_at = null, resolution = null,
             escalated_at = null, notified_at = null, last_seen = now(), times_seen = times_seen + 1,
             severity = $2, title = $3, detail = $4, data = $5::jsonb, updated_at = now() where id = $1`,
          [row.id, f.severity, f.title.slice(0, 300), f.text.slice(0, 2000), JSON.stringify(f.data ?? {})]
        );
        await event(client, row.id, input.source, 'reopened', 'The problem is back after being fixed.');
        out.reopened += 1;
      } else {
        await client.query(
          `update agent_cases set last_seen = now(), times_seen = times_seen + 1, severity = $2, title = $3,
             detail = $4, data = $5::jsonb, updated_at = now() where id = $1`,
          [row.id, f.severity, f.title.slice(0, 300), f.text.slice(0, 2000), JSON.stringify(f.data ?? {})]
        );
        out.updated += 1;
      }
    }

    const verified = input.verified ?? [];
    if (input.ran.length || verified.length) {
      const stillOpen = await client.query<{ id: number; key: string }>(
        `select id, key from agent_cases
         where status = any($1::text[]) and (check_id = any($2::text[]) or key = any($3::text[]))`,
        [OPEN_STATES, input.ran, verified]
      );
      for (const row of stillOpen.rows) {
        if (seen.has(row.key)) continue;
        await client.query(
          `update agent_cases set status = 'fixed', resolved_at = now(), resolution = $2, updated_at = now() where id = $1`,
          [row.id, `No longer reported by ${checkIdOf(row.key)}.`]
        );
        await event(client, row.id, input.source, 'resolved', `${checkIdOf(row.key)} no longer reports this.`);
        out.resolved += 1;
      }
    }
  });

  return out;
}

export type CaseFilter = { status?: CaseStatus[]; id?: number; key?: string; fixedWithinDays?: number; limit?: number };

const COLUMNS = `id, key, check_id, severity, title, detail, data, status, first_seen, last_seen, times_seen,
  attempts, last_attempt_at, escalated_at, notified_at, resolved_at, resolution`;

export async function listCases(filter: CaseFilter = {}): Promise<{ counts: Record<string, number>; cases: CaseRow[] }> {
  await ensureAgentTables();
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.id != null) { args.push(filter.id); where.push(`id = $${args.length}`); }
  if (filter.key) { args.push(filter.key); where.push(`key = $${args.length}`); }
  if (filter.status?.length) { args.push(filter.status); where.push(`status = any($${args.length}::text[])`); }
  if (filter.fixedWithinDays != null) {
    args.push(filter.fixedWithinDays);
    where.push(`(status <> 'fixed' or resolved_at > now() - ($${args.length}::int * interval '1 day'))`);
  }
  args.push(Math.min(filter.limit ?? 50, 200));
  const cases = await pool.query<CaseRow>(
    `select ${COLUMNS} from agent_cases ${where.length ? 'where ' + where.join(' and ') : ''}
     order by (case status when 'escalated' then 0 when 'open' then 1 when 'in_progress' then 2 else 3 end),
              (case severity when 'critical' then 0 else 1 end), id desc
     limit $${args.length}`,
    args
  );
  const counts = await pool.query<{ status: string; n: number }>('select status, count(*)::int as n from agent_cases group by 1');
  return { counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])), cases: cases.rows };
}

export async function caseEvents(caseId: number, limit = 12): Promise<CaseEvent[]> {
  await ensureAgentTables();
  const r = await pool.query<CaseEvent>(
    'select at, actor, action, note from agent_case_events where case_id = $1 order by at desc, id desc limit $2',
    [caseId, limit]
  );
  return r.rows;
}

export type UpdateInput = {
  id?: number;
  key?: string;
  status?: CaseStatus;
  actor: string;
  note?: string;
  /** Count this as one attempt to fix it (sets in_progress and stamps last_attempt_at). */
  attempt?: boolean;
  markNotified?: boolean;
};

/** Move one case along. Returns the updated row, or null if there is no such case. */
export async function updateCase(input: UpdateInput): Promise<CaseRow | null> {
  await ensureAgentTables();
  return withTransaction(async (client) => {
    const found = await client.query<{ id: number; status: CaseStatus }>(
      input.id != null ? 'select id, status from agent_cases where id = $1 for update' : 'select id, status from agent_cases where key = $1 for update',
      [input.id ?? input.key]
    );
    const row = found.rows[0];
    if (!row) return null;

    const sets: string[] = ['updated_at = now()'];
    const args: unknown[] = [row.id];
    const add = (sql: string, value?: unknown) => {
      if (value !== undefined) args.push(value);
      sets.push(value !== undefined ? sql.replace('?', `$${args.length}`) : sql);
    };

    if (input.attempt) {
      add('attempts = attempts + 1');
      add('last_attempt_at = now()');
      if (!input.status) add("status = 'in_progress'");
    }
    if (input.status) {
      add('status = ?', input.status);
      if (input.status === 'fixed') { add('resolved_at = now()'); add('resolution = ?', input.note ?? 'Fixed.'); }
      if (input.status === 'escalated') add('escalated_at = now()');
      if (input.status === 'open') { add('attempts = 0'); add('escalated_at = null'); add('notified_at = null'); add('resolved_at = null'); add('resolution = null'); }
    }
    if (input.markNotified) add('notified_at = now()');

    await client.query(`update agent_cases set ${sets.join(', ')} where id = $1`, args);
    const action = input.attempt ? 'attempt' : input.markNotified && !input.status ? 'notified' : input.status ?? 'update';
    await event(client, row.id, input.actor, action, input.note ?? '');
    const updated = await client.query<CaseRow>(`select ${COLUMNS} from agent_cases where id = $1`, [row.id]);
    return updated.rows[0];
  });
}

/** Cases the boss should work on: open or part-way, and not yet out of attempts. Worst first. */
export async function casesForBoss(maxAttempts = MAX_ATTEMPTS): Promise<CaseRow[]> {
  await ensureAgentTables();
  const r = await pool.query<CaseRow>(
    `select ${COLUMNS} from agent_cases
     where status in ('open', 'in_progress') and attempts < $1
     order by (case severity when 'critical' then 0 else 1 end), id`,
    [maxAttempts]
  );
  return r.rows;
}

/** Open cases that ran out of attempts without the boss escalating them itself. */
export async function escalateExhausted(actor: string, maxAttempts = MAX_ATTEMPTS): Promise<CaseRow[]> {
  await ensureAgentTables();
  const r = await pool.query<CaseRow>(
    `select ${COLUMNS} from agent_cases where status in ('open', 'in_progress') and attempts >= $1`,
    [maxAttempts]
  );
  const out: CaseRow[] = [];
  for (const row of r.rows) {
    const updated = await updateCase({
      id: row.id,
      status: 'escalated',
      actor,
      note: `Still not fixed after ${row.attempts} attempts.`,
    });
    if (updated) out.push(updated);
  }
  return out;
}

/** Escalated cases the user has not been told about yet, plus ones still unresolved a week after the last nudge. */
export async function casesToTellUser(reminderDays = 7): Promise<{ fresh: CaseRow[]; reminders: CaseRow[] }> {
  await ensureAgentTables();
  const r = await pool.query<CaseRow>(
    `select ${COLUMNS} from agent_cases where status = 'escalated'
     order by (case severity when 'critical' then 0 else 1 end), id`
  );
  const cutoff = Date.now() - reminderDays * 86400000;
  return {
    fresh: r.rows.filter((c) => !c.notified_at),
    reminders: r.rows.filter((c) => c.notified_at && new Date(c.notified_at).getTime() < cutoff),
  };
}

export type LedgerSummary = {
  counts: Record<string, number>;
  fixedRecently: number;
  lastAuditAt: string | null;
};

/** The numbers behind "have things been resolved?". */
export async function ledgerSummary(days = 7): Promise<LedgerSummary> {
  await ensureAgentTables();
  const counts = await pool.query<{ status: string; n: number }>('select status, count(*)::int as n from agent_cases group by 1');
  const fixed = await pool.query<{ n: number }>(
    `select count(*)::int as n from agent_cases where status = 'fixed' and resolved_at > now() - ($1::int * interval '1 day')`,
    [days]
  );
  const audit = await pool.query<{ at: string | null }>(`select max(at) as at from agent_case_events where actor = 'audit'`);
  return {
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    fixedRecently: fixed.rows[0]?.n ?? 0,
    lastAuditAt: audit.rows[0]?.at ?? null,
  };
}

/** The Telegram poller's last-seen update_id + 1, so a cron run only sees messages that arrived since the last one. */
export async function getTelegramOffset(): Promise<number> {
  await ensureAgentTables();
  const r = await pool.query<{ value: number }>(`select (value->>'offset')::bigint as value from agent_kv where key = 'telegram_offset'`);
  return r.rows[0]?.value ?? 0;
}

export async function setTelegramOffset(offset: number): Promise<void> {
  await ensureAgentTables();
  await pool.query(
    `insert into agent_kv (key, value, updated_at) values ('telegram_offset', jsonb_build_object('offset', $1::bigint), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [offset]
  );
}
