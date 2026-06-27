import { pool } from './db.js';

// Drops every table, type, and the migration history by recreating the public
// schema from scratch. After this, run `npm run migrate` to rebuild the tables.
async function reset() {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  console.log('Database wiped: all tables and data dropped.');
  console.log('Run `npm run migrate` (and optionally `npm run seed`) to rebuild.');
}

reset()
  .catch((err) => {
    console.error('Reset failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
