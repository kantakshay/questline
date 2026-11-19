// Applies every not-yet-applied .sql file in src/db/migrations, in filename order,
// each inside its own transaction.
const fs = require('node:fs');
const path = require('node:path');
const { pool, withTransaction } = require('../pool');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await withTransaction(async (db) => {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });
    console.log(`Applied ${file}`);
  }
}

migrate()
  .then(() => console.log('Migrations up to date.'))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
