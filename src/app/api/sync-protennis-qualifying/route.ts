import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { AUG17_ENTRY_LISTS, type Aug17EntryList, type EntryListPlayer } from '@/lib/aug17-entry-lists';
import { fetchOfficialPdfDebug } from '@/lib/cutoff-pdf-parser';
import { parseProTennisQualifyingSheetText } from '@/lib/protennis-qualifying-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEEK_START = '2026-08-17';
const PLACEHOLDER_TEXT = 'Tournament Information Not Yet Available';

const EVENTS = [
  { slug: 'cancun', code: '3009' },
  { slug: 'quebec-city', code: '3103' },
  { slug: 'kingston', code: '3121' },
  { slug: 'prague', code: '600' },
  { slug: 'roehampton', code: '3123' },
  { slug: 'sion', code: '3133' },
] as const;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function candidatePlayers(event: Aug17EntryList): EntryListPlayer[] {
  return [...event.main, ...event.mainNext, ...event.qualifying];
}

function resolveOfficialName(event: Aug17EntryList, officialName: string) {
  const exact = candidatePlayers(event).find((player) => normalize(player.name) === normalize(officialName));
  if (exact) return exact;

  // PTL footer sections abbreviate names (e.g. "K. Uchida"). Resolve only
  // when the initial + surname combination is unambiguous inside this event.
  const match = officialName.match(/^([A-Z])\.\s+(.+)$/i);
  if (!match) return null;
  const initial = match[1].toLowerCase();
  const surname = normalize(match[2]);
  const matches = candidatePlayers(event).filter((player) => {
    const parts = normalize(player.name).split(' ');
    return parts.length >= 2 && parts[0].startsWith(initial) && parts.slice(1).join(' ').endsWith(surname);
  });
  return matches.length === 1 ? matches[0] : null;
}

function fingerprint(parts: Array<string | number | null>) {
  return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex');
}

async function insertMovement(args: {
  sourceKey: string;
  sourceUrl: string;
  tournamentSlug: string;
  playerName: string;
  movementType: 'q_to_md' | 'q_withdrawal' | 'q_alt_to_q';
  fromSection: 'qualifying' | 'qualifying_alt';
  toSection: 'main' | 'qualifying' | 'out';
  entryRank: number | null;
  qSpotsDelta: number;
  rawText: string | null;
  evidence: Record<string, unknown>;
}) {
  const id = fingerprint([
    WEEK_START,
    args.tournamentSlug,
    args.playerName,
    args.movementType,
    args.fromSection,
    args.toSection,
    args.sourceKey,
  ]);
  const result = await pool.query(
    `insert into entry_list_movements (
       week_start, tournament_slug, event_type, player_name, movement_type,
       from_section, to_section, entry_rank, original_position, q_spots_delta,
       observed_at, source_key, source_url, raw_text, evidence, fingerprint
     ) values ($1, $2, 'singles', $3, $4, $5, $6, $7, null, $8,
               now(), $9, $10, $11, $12::jsonb, $13)
     on conflict (fingerprint) do nothing
     returning id`,
    [
      WEEK_START,
      args.tournamentSlug,
      args.playerName,
      args.movementType,
      args.fromSection,
      args.toSection,
      args.entryRank,
      args.qSpotsDelta,
      args.sourceKey,
      args.sourceUrl,
      args.rawText,
      JSON.stringify(args.evidence),
      id,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const requestedWeek = request.nextUrl.searchParams.get('week') ?? WEEK_START;
  if (requestedWeek !== WEEK_START) {
    return NextResponse.json({ ok: false, error: `PTL Q pilot is mapped for ${WEEK_START} only.` }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];
  let totalMovements = 0;

  for (let index = 0; index < EVENTS.length; index += 1) {
    const target = EVENTS[index];
    if (index > 0) await sleep(2500); // PTL rate-limits bursts; six gentle requests/hour is sufficient.

    const event = AUG17_ENTRY_LISTS.find((item) => item.slug === target.slug);
    if (!event) {
      results.push({ slug: target.slug, ok: false, error: 'Local event mapping missing' });
      continue;
    }

    const sourceKey = `protennislive-qs-${target.slug}`;
    const sourceUrl = `https://www.protennislive.com/posting/2026/${target.code}/qs.pdf`;

    try {
      const debug = await fetchOfficialPdfDebug(sourceUrl);
      // Stream order is the most reliable representation for footer sections;
      // fall back to layout text when a producer changes the content order.
      const streamParsed = parseProTennisQualifyingSheetText(debug.text);
      const layoutParsed = parseProTennisQualifyingSheetText(debug.layoutText);
      const parsed =
        streamParsed.alternatesUsed.length + streamParsed.withdrawals.length >=
        layoutParsed.alternatesUsed.length + layoutParsed.withdrawals.length
          ? streamParsed
          : layoutParsed;

      const rawText = debug.text || debug.layoutText;
      const hash = createHash('sha256').update(rawText).digest('hex');
      const statusResult = await pool.query<{ last_content_hash: string | null }>(
        `select last_content_hash
         from entry_list_source_status
         where week_start = $1::date and source_key = $2`,
        [WEEK_START, sourceKey]
      );
      const changed = statusResult.rows[0]?.last_content_hash !== hash;
      const placeholder = parsed.placeholder || rawText.includes(PLACEHOLDER_TEXT);

      let movementsAdded = 0;
      if (!placeholder) {
        for (let altIndex = 0; altIndex < parsed.alternatesUsed.length; altIndex += 1) {
          const officialName = parsed.alternatesUsed[altIndex];
          const resolved = resolveOfficialName(event, officialName);
          if (
            await insertMovement({
              sourceKey,
              sourceUrl,
              tournamentSlug: target.slug,
              playerName: resolved?.name ?? officialName,
              movementType: 'q_alt_to_q',
              fromSection: 'qualifying_alt',
              toSection: 'qualifying',
              entryRank: resolved?.rank ?? null,
              qSpotsDelta: 0,
              rawText: `${officialName} (Alt)`,
              evidence: {
                authority: 'ATP ProTennisLive qualifying sheet',
                alternatesUsedOrder: altIndex + 1,
                releasedAt: parsed.releasedAtText,
                note: 'Order is the PTL Alternates-used order, not asserted as the original pre-draw Q ALT position.',
              },
            })
          ) movementsAdded += 1;
        }

        for (const withdrawal of parsed.withdrawals) {
          const resolved = resolveOfficialName(event, withdrawal.playerName);
          const movedToMain = /moved to main draw|mdwc|main draw/i.test(withdrawal.reason ?? '');
          if (
            await insertMovement({
              sourceKey,
              sourceUrl,
              tournamentSlug: target.slug,
              playerName: resolved?.name ?? withdrawal.playerName,
              movementType: movedToMain ? 'q_to_md' : 'q_withdrawal',
              fromSection: 'qualifying',
              toSection: movedToMain ? 'main' : 'out',
              entryRank: resolved?.rank ?? null,
              qSpotsDelta: 1,
              rawText: withdrawal.rawText,
              evidence: {
                authority: 'ATP ProTennisLive qualifying sheet',
                reason: withdrawal.reason,
                releasedAt: parsed.releasedAtText,
              },
            })
          ) movementsAdded += 1;
        }
      }
      totalMovements += movementsAdded;

      if (changed) {
        await pool.query(
          `insert into entry_list_source_snapshots (
             week_start, source_key, source_url, content_hash, raw_payload,
             parsed_payload, source_updated_text
           ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
           on conflict (week_start, source_key, content_hash) do nothing`,
          [WEEK_START, sourceKey, sourceUrl, hash, rawText, JSON.stringify(parsed), parsed.releasedAtText]
        );
      }

      await pool.query(
        `insert into entry_list_source_status (
           week_start, source_key, source_url, last_checked_at, last_changed_at,
           last_content_hash, last_error, updated_at
         ) values ($1, $2, $3, now(), case when $4 then now() else null end, $5, null, now())
         on conflict (week_start, source_key) do update
         set source_url = excluded.source_url,
             last_checked_at = now(),
             last_changed_at = case when $4 then now() else entry_list_source_status.last_changed_at end,
             last_content_hash = $5,
             last_error = null,
             updated_at = now()`,
        [WEEK_START, sourceKey, sourceUrl, changed, hash]
      );

      results.push({
        slug: target.slug,
        code: target.code,
        ok: true,
        placeholder,
        changed,
        releasedAt: parsed.releasedAtText,
        lastDirectAcceptanceName: parsed.lastDirectAcceptanceName,
        lastDirectAcceptanceRank: parsed.lastDirectAcceptanceRank,
        alternatesUsed: parsed.alternatesUsed,
        withdrawals: parsed.withdrawals,
        movementsAdded,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `insert into entry_list_source_status (
           week_start, source_key, source_url, last_checked_at, last_error, updated_at
         ) values ($1, $2, $3, now(), $4, now())
         on conflict (week_start, source_key) do update
         set source_url = excluded.source_url,
             last_checked_at = now(),
             last_error = $4,
             updated_at = now()`,
        [WEEK_START, sourceKey, sourceUrl, message]
      ).catch(() => undefined);
      results.push({ slug: target.slug, code: target.code, ok: false, error: message });
    }
  }

  return NextResponse.json({
    ok: results.every((row) => row.ok !== false),
    week: WEEK_START,
    checkedAt: new Date().toISOString(),
    movementsAdded: totalMovements,
    events: results,
  });
}
