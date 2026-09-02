// WealthCore server entry point.
// Binds to 0.0.0.0 so it is reachable via the sandbox preview proxy.

import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDb, closeDb } from './db.js';
import { config, validateConfig } from './config.js';
import logger from './lib/logger.js';
import { health, readiness } from './lib/health.js';
import apiRouter from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > -1) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function buildApp() {
  const cfg = config();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.raw({ type: ['text/csv', 'application/vnd.ms-excel', 'text/plain'], limit: '20mb' }));

  // Request correlation ids + structured logging + security headers.
  app.use((req, res, next) => {
    const rid = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
    const cid = req.headers['x-correlation-id'] || req.headers['x-request-id'] || rid;
    req.id = rid;
    req.correlationId = cid;
    res.setHeader('X-Request-Id', rid);
    res.setHeader('X-Correlation-Id', cid);
    req.cookies = parseCookies(req.headers.cookie);
    const start = Date.now();
    const route = req.path;
    res.on('finish', () => {
      // Log only metadata — never body, never financial values.
      logger.debug('http', { reqId: rid, method: req.method, route, status: res.statusCode, ms: Date.now() - start });
    });
    next();
  });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'");
    next();
  });

  // Liveness / readiness are public.
  app.get('/api/v1/health', (_req, res) => res.json(health()));
  app.get('/api/v1/ready', (_req, res) => {
    const r = readiness();
    res.status(r.status === 'ok' ? 200 : 503).json(r);
  });
  app.get('/health', (_req, res) => res.json(health()));
  app.get('/ready', (_req, res) => {
    const r = readiness();
    res.status(r.status === 'ok' ? 200 : 503).json(r);
  });

  app.use('/api/v1', apiRouter);

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Central error handler — never leaks stack traces or data.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error('server_error', { error: err && err.message ? err.message : String(err) });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred.' } });
  });

  return app;
}

export const app = buildApp();

export function start(port = config().port) {
  const cfg = config();
  const validate = validateConfig(cfg);
  if (cfg.isProd && !validate.valid) {
    throw new Error(`Production configuration invalid:\n- ${validate.errors.join('\n- ')}`);
  }

  getDb();
  const server = app.listen(port, cfg.host, () => {
    logger.info('server_listening', { host: cfg.host, port, env: cfg.env });
  });
  extendShutdownHandlers(server);
  schedulerHook(server);
  return server;
}

function schedulerHook(server) {
  const cfg = config();
  if (!cfg.scheduler.enabled) return;
  import('./lib/scheduler.js').then(({ startScheduler }) => {
    startScheduler(getDb());
    logger.info('scheduler_started', { intervalSeconds: cfg.scheduler.intervalSeconds });
  });
}

function extendShutdownHandlers(server) {
  const close = () => {
    server.close(() => {
      try { closeDb(); } catch {}
      process.exit(0);
    });
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}

// Only start when run directly (not during tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    start();
  } catch (e) {
    logger.error('startup_failed', { error: e.message });
    process.exit(1);
  }
}
