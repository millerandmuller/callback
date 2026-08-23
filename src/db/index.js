import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Opens (creating if needed) the SQLite database at the given path and applies
 * schema.sql. Idempotent: safe to call once per process start.
 * @param {string} [path] defaults to config.db.path
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(path = config.db.path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

/**
 * Ensures a namespace row exists ('own' or a dry-run channel handle).
 * @param {import('better-sqlite3').Database} db
 * @param {{name: string, kind: 'own'|'dryrun', channelId: string}} ns
 */
export function ensureNamespace(db, { name, kind, channelId }) {
  db.prepare(
    `INSERT INTO namespaces (name, kind, channel_id) VALUES (@name, @kind, @channelId)
     ON CONFLICT(name) DO UPDATE SET channel_id = excluded.channel_id`
  ).run({ name, kind, channelId });
}
