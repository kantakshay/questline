const fs = require('node:fs');
const { Pool } = require('pg');
const config = require('../config');

function sslOptions() {
  if (!config.databaseSsl) return undefined;
  return {
    rejectUnauthorized: true,
    ...(config.databaseSslCa ? { ca: fs.readFileSync(config.databaseSslCa, 'utf8') } : {}),
  };
}

const pool = new Pool({ connectionString: config.databaseUrl, ssl: sslOptions() });

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
