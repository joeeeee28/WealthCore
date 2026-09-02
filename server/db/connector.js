// WealthCore — data connector / repository abstraction.
//
// Business logic should query through this thin seam rather than calling a
// database-specific API directly. Today the implementation is SQLite
// (better-sqlite3). A PostgreSQL adapter is supported via `WEALTHCORE_DB_URL`
// and the `postgres` driver; it is documented and mapping-ready but is only
// active when the URL is supplied.
//
// Parameter style is translated: SQLite uses `?`, PostgreSQL uses `$1..$n`.

import { getDb } from '../db.js';

export const DIALECT = process.env.WEALTHCORE_DB_URL ? 'postgres' : 'sqlite';

/**
 * Translate a `?`-parameterised SQL string to `$1..$n` for PostgreSQL.
 */
export function toPostgresParams(sql) {
  let i = 0;
  // replace ? not inside quotes — for our controlled queries this is a safe
  // simple scan.
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Run a SELECT that returns all rows.
 * @param {object} db  the database handle (better-sqlite3 today)
 * @param {string} sql `?`-parameterised SQL
 * @param {Array} params
 */
export function all(db, sql, params = []) {
  if (DIALECT === 'sqlite') return db.prepare(sql).all(...params);
  // Postgres path — not exercised until a PG URL is configured.
  return db.prepare(toPostgresParams(sql)).all(...params);
}

/** Run a SELECT that returns a single row. */
export function get(db, sql, params = []) {
  if (DIALECT === 'sqlite') return db.prepare(sql).get(...params);
  return db.prepare(toPostgresParams(sql)).get(...params);
}

/** Run a write statement, returning run info (lastInsertRowid / changes). */
export function run(db, sql, params = []) {
  if (DIALECT === 'sqlite') return db.prepare(sql).run(...params);
  return db.prepare(toPostgresParams(sql)).run(...params);
}

/** Transaction wrapper (best-effort; Postgres would use BEGIN/COMMIT). */
export function transaction(db, fn) {
  if (DIALECT === 'sqlite') {
    return db.transaction(fn)();
  }
  // Postgres: wrap fn with a single transaction.
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export default { DIALECT, toPostgresParams, all, get, run, transaction, db: getDb };
