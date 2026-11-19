/**
 * Base de datos del servidor: SQLite integrado en Node (node:sqlite), sin dependencias nativas.
 * Los objetos del dominio se guardan como JSON (mismas estructuras que usa el cliente), con columnas
 * indexadas para las consultas necesarias. Para otra base de datos (PostgreSQL, SQL Server) basta con
 * reimplementar este módulo.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     display_name TEXT NOT NULL,
     role TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     must_change INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     last_seen TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, kind TEXT NOT NULL, imported_at TEXT NOT NULL, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS raw_sheets (batch_id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS datasets (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL,
     batch_id TEXT NOT NULL, mode TEXT NOT NULL, records INTEGER NOT NULL, purged INTEGER NOT NULL DEFAULT 0, data TEXT
   );
   CREATE TABLE IF NOT EXISTS active (kind TEXT PRIMARY KEY, dataset_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT, updated_by TEXT);
   CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS reviews (alert_id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS manual (id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS saved_filters (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, username TEXT, action TEXT NOT NULL, detail TEXT
   );
   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_datasets_kind ON datasets(kind, version);
   CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
   CREATE INDEX IF NOT EXISTS idx_filters_user ON saved_filters(user_id);`,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      v++;
      db.prepare('UPDATE schema_version SET v = ?').run(v);
    });
  }
  return db;
}

/** Ejecuta fn dentro de una transacción; deshace todo si lanza una excepción. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getJson<T>(db: Db, sql: string, ...params: (string | number)[]): T | undefined {
  const row = db.prepare(sql).get(...params) as { data?: string } | undefined;
  return row?.data ? (JSON.parse(row.data) as T) : undefined;
}

export function allJson<T>(db: Db, sql: string, ...params: (string | number)[]): T[] {
  return (db.prepare(sql).all(...params) as { data: string }[]).map((r) => JSON.parse(r.data) as T);
}

export function getMeta(db: Db, key: string): string | undefined {
  return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

export function setMeta(db: Db, key: string, value: string) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export interface ChangeInfo {
  revision: number;
  at?: string;
  user?: string;
  action?: string;
}

/** Contador de revisión de los datos compartidos: los clientes lo consultan para saber si hay cambios de otros usuarios. */
export function bumpRevision(db: Db, user: string, action: string): number {
  const r = Number(getMeta(db, 'revision') ?? '0') + 1;
  setMeta(db, 'revision', String(r));
  setMeta(db, 'last_change', JSON.stringify({ revision: r, at: new Date().toISOString(), user, action }));
  return r;
}

export function revisionInfo(db: Db): ChangeInfo {
  const raw = getMeta(db, 'last_change');
  const info = raw ? (JSON.parse(raw) as ChangeInfo) : { revision: 0 };
  return { ...info, revision: Number(getMeta(db, 'revision') ?? '0') };
}

export function audit(db: Db, user: { id?: string; username?: string } | undefined, action: string, detail?: unknown) {
  db.prepare('INSERT INTO audit (at, user_id, username, action, detail) VALUES (?, ?, ?, ?, ?)').run(
    new Date().toISOString(),
    user?.id ?? null,
    user?.username ?? null,
    action,
    detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
}
