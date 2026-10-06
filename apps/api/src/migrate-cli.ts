import { createDb } from './db.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquant');

const sql = createDb(url);
try {
  await migrate(sql, (m) => process.stdout.write(m + '\n'));
  process.stdout.write('migrations à jour\n');
} finally {
  await sql.end();
}
