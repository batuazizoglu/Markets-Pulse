import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';
import { SOURCE_DEFS } from './config.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Add a Railway PostgreSQL database and expose DATABASE_URL.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

export async function initDb() {
  await pool.query(SCHEMA_SQL);
  for (const s of SOURCE_DEFS) {
    await pool.query(`
      INSERT INTO sources(slug, name, url, enabled)
      VALUES ($1,$2,$3,TRUE)
      ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, enabled=TRUE
    `, [s.slug, s.name, s.url]);
  }
}
