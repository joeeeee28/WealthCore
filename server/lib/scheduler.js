// WealthCore — background scheduler.
//
// Runs jobs in-process without blocking the HTTP server. It ticks on an
// interval (default 60s), decides which jobs are due, executes them, records
// status/attempts/duration/errors in `jobs`, and applies exponential backoff.
//
// The scheduler is deliberately optional (WEALTHCORE_SCHEDULER_ENABLED). When
// an external provider (AA / market / LLM) is unconfigured, the relevant job
// runs but records an honest "no-op / not configured" outcome — never a fake
// success.

import { config } from '../config.js';
import { expireConsents } from './aa-integration.js';
import { refreshPrices } from './market-data.js';
import { evaluate } from './notifications.js';
import { recordSnapshot } from './networth.js';
import { marketProviderConfig } from './market-data.js';
import { reconciliationForAccount } from './reconciliation.js';
import logger from './logger.js';

function nextDaily(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function nextMonthly(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, 2, 0, 0);
  return d.toISOString();
}

function nextInMinutes(minutes, now = new Date()) {
  return new Date(now.getTime() + minutes * 60000).toISOString();
}

function allUserIds(db) {
  return db.prepare('SELECT id FROM users').all().map((u) => u.id);
}

// Registry of runnable jobs. `run(db, userId|null)` returns a result object.
const JOB_RUNNERS = {
  'expire-consents': {
    schedule: 'daily',
    next: nextDaily,
    describe: () => 'Mark expired AA consents',
    async run(db) {
      let count = 0;
      for (const uid of allUserIds(db)) count += expireConsents(db, uid);
      return { ok: true, records: count, note: 'consents expired' };
    },
  },
  'market-refresh': {
    schedule: 'interval',
    next: () => nextInMinutes(config().scheduler.marketRefreshMinutes),
    describe: () => 'Refresh securities prices',
    async run(db) {
      const mkt = marketProviderConfig();
      if (!mkt.configured) {
        return { ok: true, records: 0, note: 'PENDING_PROVIDER_CREDENTIALS', status: 'not_configured' };
      }
      let updated = 0;
      for (const uid of allUserIds(db)) {
        const r = await refreshPrices(db, uid);
        updated += r.securitiesUpdated || 0;
      }
      return { ok: true, records: updated, note: 'prices refreshed' };
    },
  },
  'notify-evaluate': {
    schedule: 'daily',
    next: nextDaily,
    describe: () => 'Evaluate notification rules',
    async run(db) {
      let created = 0;
      for (const uid of allUserIds(db)) created += evaluate(db, uid).length;
      return { ok: true, records: created, note: 'notifications created' };
    },
  },
  'monthly-networth-snapshot': {
    schedule: 'monthly',
    next: nextMonthly,
    describe: () => 'Record a net-worth snapshot per user',
    async run(db) {
      let records = 0;
      for (const uid of allUserIds(db)) {
        recordSnapshot(db, uid);
        records++;
      }
      return { ok: true, records, note: 'snapshots recorded' };
    },
  },
  'reconciliation-scan': {
    schedule: 'daily',
    next: nextDaily,
    describe: () => 'Run reconciliation across accounts',
    async run(db) {
      let differences = 0;
      for (const uid of allUserIds(db)) {
        const accounts = db.prepare('SELECT id FROM accounts WHERE user_id = ?').all(uid);
        for (const a of accounts) {
          // Reconciliation is best-effort; a difference is surfaced, not fixed.
          const rec = reconciliationForAccount(db, uid, a.id);
          if (rec.status === 'DIFFERENCE' || rec.status === 'REQUIRES_REVIEW') differences++;
        }
      }
      return { ok: true, records: differences, note: 'reconciliation scanned' };
    },
  },
};

function waitFor(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Compute the next run time in ms from now given a job record. `now` is in ms. */
function isDue(job, nowMs) {
  if (job.status === 'running') return false;
  if (!job.next_run_at) return true;
  return new Date(job.next_run_at).getTime() <= nowMs;
}

function backoffMs(attempts) {
  // 1, 2, 4, 8... minutes
  return Math.min(30 * 60 * 1000, 60000 * Math.pow(2, Math.max(0, attempts - 1)));
}

async function runJob(db, job, runner) {
  const start = Date.now();
  db.prepare(`UPDATE jobs SET status='running', updated_at=datetime('now') WHERE id=?`).run(job.id);
  let result;
  try {
    result = await runner.run(db);
    // If the job is explicitly not-configured, don't count it as a retry failure.
    const attempts = result.status === 'not_configured' ? 0 : job.attempts;
    db.prepare(`
      UPDATE jobs SET status='success', last_run_at=datetime('now'), next_run_at=?, last_duration_ms=?, attempts=?, error=?, updated_at=datetime('now') WHERE id=?
    `).run(runner.next(), Date.now() - start, attempts, result.note || null, job.id);
    logger.info('job_completed', { job: job.name, records: result.records, durationMs: Date.now() - start });
    return { ok: true, result };
  } catch (e) {
    const attempts = job.attempts + 1;
    const fail = attempts >= (job.max_attempts || 3) ? 'failed' : 'pending';
    db.prepare(`
      UPDATE jobs SET status=?, attempts=?, error=?, next_run_at=?, last_run_at=datetime('now'), updated_at=datetime('now') WHERE id=?
    `).run(fail, attempts, String(e.message || e), new Date(Date.now() + backoffMs(attempts)).toISOString(), job.id);
    logger.error('job_failed', { job: job.name, attempts, error: String(e.message || e) });
    return { ok: false, error: e.message };
  }
}

/** Start the scheduler. Returns a stop function. */
export function startScheduler(db, { intervalSeconds = 60 } = {}) {
  const cfg = config().scheduler;
  const effectiveInterval = intervalSeconds || cfg.intervalSeconds;
  for (const [name, runner] of Object.entries(JOB_RUNNERS)) {
    try {
      const existing = db.prepare('SELECT * FROM jobs WHERE name = ? AND user_id IS NULL').get(name);
      if (!existing) {
        db.prepare(`INSERT INTO jobs (user_id, name, schedule, status, next_run_at) VALUES (NULL, ?, ?, 'pending', ?)`)
          .run(name, runner.schedule, runner.next());
      }
    } catch (e) {
      logger.warn('job_init_skipped', { job: name, error: e.message });
    }
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const due = db.prepare("SELECT * FROM jobs WHERE user_id IS NULL AND status != 'running' AND status != 'failed'").all();
      for (const job of due) {
        if (!isDue(job, now)) continue;
        const runner = JOB_RUNNERS[job.name];
        if (!runner) continue;
        await runJob(db, job, runner);
      }
    } catch (e) {
      logger.error('scheduler_tick_error', { error: String(e.message || e) });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, effectiveInterval * 1000);
  // Run once shortly after start.
  setTimeout(tick, 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

export { JOB_RUNNERS };
export default { startScheduler, JOB_RUNNERS };
