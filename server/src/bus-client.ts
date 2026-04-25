/**
 * bus-client.ts
 * Node↔Python bridge: publish events to data/bus.db via better-sqlite3.
 * ADR-0012: shared SQLite bus, same events schema as runtime/memory/bus.py.
 *
 * better-sqlite3 is synchronous — no async overhead, safe for MCP server lifecycle.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path resolution: 4 levels up from server/build/ → repo root → data/bus.db
// Fallback to env var for non-standard layouts.
const BUS_DB_PATH =
  process.env.AEMCP_BUS_DB_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'data', 'bus.db');

const _SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           REAL NOT NULL,
  topic        TEXT NOT NULL,
  payload      TEXT NOT NULL,
  event_id     TEXT,
  ingest_ns    INTEGER,
  payload_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_evt_topic_seq ON events(topic, seq);
CREATE INDEX IF NOT EXISTS idx_evt_topic_ts  ON events(topic, ts);
CREATE INDEX IF NOT EXISTS idx_evt_event_id  ON events(event_id);
`;

let _db: ReturnType<typeof _require> | null = null;

function getDb(): ReturnType<typeof _require> {
  if (_db) return _db;
  try {
    const Database = _require('better-sqlite3');
    _db = new Database(BUS_DB_PATH);
    _db.exec(_SCHEMA);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `bus-client: better-sqlite3 required for audit bridge. Run 'npm install' in vendor/ae-mcp/server. Underlying: ${msg}`
    );
  }
  return _db;
}

/**
 * Publish an event to data/bus.db. Throws if better-sqlite3 unavailable.
 * Returns the inserted seq.
 */
export function busPublish(topic: string, payload: Record<string, unknown>): number {
  const db = getDb();
  if (!db) return -1;
  try {
    const now = Date.now();
    const stmt = db.prepare(
      'INSERT INTO events (ts, topic, payload, ingest_ns) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(now / 1e3, topic, JSON.stringify(payload), now * 1_000_000);
    return result.lastInsertRowid as number;
  } catch (err) {
    console.error('bus-client: publish error:', err);
    return -1;
  }
}
