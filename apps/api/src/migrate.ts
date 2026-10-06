/**
 * Exécuteur de migrations SQL minimaliste : chaque fichier de /migrations est appliqué
 * une seule fois, dans l'ordre alphabétique, dans une transaction.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Sql } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(sql: Sql, log: (msg: string) => void = () => {}): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  // Verrou consultatif : plusieurs instances peuvent démarrer simultanément.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4242001)`;
    const applied = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const content = await readFile(MIGRATIONS_DIR + file, 'utf8');
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      log(`migration appliquée : ${file}`);
    }
  });
}
