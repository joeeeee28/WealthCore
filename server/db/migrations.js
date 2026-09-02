// WealthCore — database migrations.
//
// A forward-only, idempotent migration runner. Each migration is an object with
// a unique `id`, a name, and a synchronous `up(db)` that executes SQL. Applied
// migrations are recorded in `schema_migrations`. Column additions are guarded
// by `columnExists` so re-runs are safe on both existing and fresh databases.

function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function tableExists(db, table) {
  const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  return !!r;
}

export const MIGRATIONS = [
  {
    id: 1,
    name: 'transactions_ingestion_metadata',
    up(db) {
      addColumn(db, 'transactions', 'posting_date', 'TEXT');
      addColumn(db, 'transactions', 'source_ref', 'TEXT');
      addColumn(db, 'transactions', 'confidence', 'REAL');
      addColumn(db, 'transactions', 'ingested_at', 'TEXT');
      addColumn(db, 'transactions', 'normalized_merchant', 'TEXT');
      addColumn(db, 'transactions', 'account_ref', 'TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_txn_source_ref ON transactions(source_ref)');
    },
  },
  {
    id: 2,
    name: 'securities_market_metadata',
    up(db) {
      addColumn(db, 'securities', 'previous_close_minor', 'INTEGER');
      addColumn(db, 'securities', 'previous_close_timestamp', 'TEXT');
      addColumn(db, 'securities', 'provider_instrument', 'TEXT');
    },
  },
  {
    id: 3,
    name: 'accounts_reconciliation_metadata',
    up(db) {
      addColumn(db, 'accounts', 'source_balance_minor', 'INTEGER');
      addColumn(db, 'accounts', 'source_balance_currency', 'TEXT');
      addColumn(db, 'accounts', 'source_balance_timestamp', 'TEXT');
      addColumn(db, 'accounts', 'provider_ref', 'TEXT');
      addColumn(db, 'accounts', 'correlation_id', 'TEXT');
    },
  },
  {
    id: 4,
    name: 'notifications_preferences',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS notification_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        threshold_minor INTEGER,
        min_severity TEXT NOT NULL DEFAULT 'info',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, type)
      )`);
      addColumn(db, 'notifications', 'source', 'TEXT');
      addColumn(db, 'notifications', 'dismissed', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'notifications', 'data', 'TEXT');
    },
  },
  {
    id: 5,
    name: 'reconciliation',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS reconciliation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        as_of TEXT NOT NULL,
        account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
        source_balance_minor INTEGER,
        expected_balance_minor INTEGER,
        net_worth_difference_minor INTEGER,
        status TEXT NOT NULL,
        summary TEXT,
        correlation_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS reconciliation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        transaction_id INTEGER,
        description TEXT,
        amount_minor INTEGER,
        direction TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_recon_run_user ON reconciliation_runs(user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_recon_item_run ON reconciliation_items(run_id)');
    },
  },
  {
    id: 6,
    name: 'jobs',
    up(db) {
      if (!tableExists(db, 'jobs')) {
        db.exec(`CREATE TABLE jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          schedule TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          last_run_at TEXT,
          next_run_at TEXT,
          last_duration_ms INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          error TEXT,
          correlation_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_job_user_name ON jobs(user_id, name, schedule)');
      }
    },
  },
  {
    id: 7,
    name: 'ingestion_runs_and_raw',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS ingestion_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        format TEXT NOT NULL,
        file_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        total_records INTEGER NOT NULL DEFAULT 0,
        created_records INTEGER NOT NULL DEFAULT 0,
        skipped_records INTEGER NOT NULL DEFAULT 0,
        failed_records INTEGER NOT NULL DEFAULT 0,
        duplicates INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        summary TEXT,
        correlation_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS raw_ingest (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ingestion_run_id INTEGER NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        payload TEXT NOT NULL,
        payload_kind TEXT NOT NULL DEFAULT 'json',
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    },
  },
  {
    id: 8,
    name: 'market_price_history',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS market_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        security_id INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
        price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        price_status TEXT NOT NULL,
        provider TEXT,
        observed_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(security_id, observed_at)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_price_hist_security ON market_price_history(security_id, observed_at)');
    },
  },
  {
    id: 9,
    name: 'password_resets_and_login_attempts',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(token_hash)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_login_attempts_id ON login_attempts(identifier, created_at)');
    },
  },
  {
    id: 10,
    name: 'account_aggregator_foundation',
    up(db) {
      // Consent lifecycle enrichment.
      addColumn(db, 'consents', 'fi_types', 'TEXT');
      addColumn(db, 'consents', 'data_range_from', 'TEXT');
      addColumn(db, 'consents', 'data_range_to', 'TEXT');
      addColumn(db, 'consents', 'frequency', 'TEXT');
      addColumn(db, 'consents', 'customer_handle', 'TEXT');
      addColumn(db, 'consents', 'consent_handle', 'TEXT');
      addColumn(db, 'consents', 'data_status', 'TEXT');

      // Data provenance on imported financial records.
      addColumn(db, 'transactions', 'source_txn_id', 'TEXT');
      addColumn(db, 'transactions', 'fip', 'TEXT');
      addColumn(db, 'accounts', 'masked_account_number', 'TEXT');

      // FI data sessions (per consent, one per fetch request).
      if (!tableExists(db, 'aa_sessions')) {
        db.exec(`CREATE TABLE aa_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          consent_id INTEGER REFERENCES consents(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          session_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'data_requested',
          requested_at TEXT,
          ready_at TEXT,
          fetched_at TEXT,
          error TEXT,
          correlation_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec('CREATE INDEX IF NOT EXISTS idx_aa_session_user ON aa_sessions(user_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_aa_session_consent ON aa_sessions(consent_id)');
      }
    },
  },
  {
    id: 11,
    name: 'aa_webhook_notifications_idempotency',
    up(db) {
      // Idempotency + audit for provider webhooks. A notification is processed
      // at most once per (provider, notification_id); the row records the
      // event type and the entities it touched so replays are safely ignored
      // and the ingestion is auditable. No raw financial payloads are stored.
      if (!tableExists(db, 'webhook_notifications')) {
        db.exec(`CREATE TABLE webhook_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL DEFAULT 'setu',
          notification_id TEXT NOT NULL,
          type TEXT,
          consent_id TEXT,
          data_session_id TEXT,
          status TEXT,
          received_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(provider, notification_id)
        )`);
        db.exec('CREATE INDEX IF NOT EXISTS idx_webhook_notif_consent ON webhook_notifications(consent_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_webhook_notif_session ON webhook_notifications(data_session_id)');
      }
    },
  },
  {
    id: 12,
    name: 'aa_consent_url',
    up(db) {
      // The consent webview/redirect URL issued by a provider (e.g. Setu's
      // `<sandbox>/consents/webview/<id>`). Persisted so the customer can open
      // the provider's consent UI to approve a REAL consent, and so the same URL
      // is available for re-use while the consent is still PENDING.
      addColumn(db, 'consents', 'consent_url', 'TEXT');
    },
  },
];

export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const record = db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)');
  let count = 0;
  for (const m of MIGRATIONS) {
    if (!applied.has(m.id)) {
      db.transaction(() => {
        m.up(db);
        record.run(m.id, m.name);
      })();
      count++;
    }
  }
  return count;
}

export default { MIGRATIONS, runMigrations };
