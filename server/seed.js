// WealthCore — demo data seeder.
//
// This loads clearly-labelled demo/sample data (is_demo=1, source='manual') for
// an EXISTING user so the product can be explored without entering real data.
// It never creates a user and never hard-codes credentials: run setup first
// (via the UI or /api/v1/auth/setup), then `npm run seed`.
//
//   node server/seed.js            # seed the first user (no-op if none)

import { getDb, closeDb } from './db.js';
import { ensureDefaultCategories, seedDemoData } from './lib/defaults.js';

const db = getDb();

const user = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
if (!user) {
  console.error('No user found. Set up WealthCore first (the Setup screen or POST /api/v1/auth/setup), then re-run the seed.');
  closeDb();
  process.exit(1);
}

ensureDefaultCategories(db, user.id);
const counts = seedDemoData(db, user.id);
console.log(`Seeded demo data for user ${user.id}:`, counts);
console.log('All records are labelled MANUAL / SANDBOX and is_demo=1. Nothing is presented as LIVE.');
closeDb();
