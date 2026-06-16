// SQLite storage — synchronous, single file, zero external services.
// The file lives at config.dbPath, which must be on a Railway volume.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

// Ensure the parent directory exists (e.g. /data). On a properly mounted
// volume this already exists; locally it may not.
mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL'); // better concurrency + durability

db.exec(`
  CREATE TABLE IF NOT EXISTS food_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    ts INTEGER NOT NULL,            -- unix ms, UTC
    source TEXT NOT NULL,           -- 'text' | 'restaurant' | 'photo'
    raw_input TEXT,
    items_json TEXT,
    kcal REAL,
    protein_g REAL,
    carbs_g REAL,
    fat_g REAL,
    estimated INTEGER NOT NULL DEFAULT 0  -- 0/1
  );
  CREATE INDEX IF NOT EXISTS idx_food_log_chat_ts ON food_log (chat_id, ts);
`);

const insertStmt = db.prepare(`
  INSERT INTO food_log
    (chat_id, ts, source, raw_input, items_json, kcal, protein_g, carbs_g, fat_g, estimated)
  VALUES
    (@chat_id, @ts, @source, @raw_input, @items_json, @kcal, @protein_g, @carbs_g, @fat_g, @estimated)
`);

/**
 * Persist a logged meal. `parsed` is the strict-shape object from the router.
 * Returns the new row id.
 */
export function insertEntry({ chatId, source, rawInput, parsed }) {
  const info = insertStmt.run({
    chat_id: String(chatId),
    ts: Date.now(),
    source,
    raw_input: rawInput ?? null,
    items_json: JSON.stringify(parsed.items ?? []),
    kcal: parsed.kcal ?? 0,
    protein_g: parsed.protein_g ?? 0,
    carbs_g: parsed.carbs_g ?? 0,
    fat_g: parsed.fat_g ?? 0,
    estimated: parsed.estimated ? 1 : 0,
  });
  return info.lastInsertRowid;
}

const sumRangeStmt = db.prepare(`
  SELECT
    COUNT(*)               AS meals,
    COALESCE(SUM(kcal), 0)      AS kcal,
    COALESCE(SUM(protein_g), 0) AS protein_g,
    COALESCE(SUM(carbs_g), 0)   AS carbs_g,
    COALESCE(SUM(fat_g), 0)     AS fat_g,
    COALESCE(MAX(estimated), 0) AS any_estimated
  FROM food_log
  WHERE chat_id = ? AND ts >= ? AND ts < ?
`);

/**
 * Sum all entries for a chat within [startMs, endMs).
 */
export function sumRange(chatId, startMs, endMs) {
  return sumRangeStmt.get(String(chatId), startMs, endMs);
}

const latestStmt = db.prepare(
  `SELECT id FROM food_log WHERE chat_id = ? ORDER BY ts DESC, id DESC LIMIT 1`
);
const deleteStmt = db.prepare(`DELETE FROM food_log WHERE id = ?`);

/**
 * Delete the most recent entry for a chat. Returns true if a row was removed.
 */
export function deleteLatest(chatId) {
  const row = latestStmt.get(String(chatId));
  if (!row) return false;
  deleteStmt.run(row.id);
  return true;
}

export default db;
