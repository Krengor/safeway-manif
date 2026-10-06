/**
 * Préparation des tests de charge (cahier §62) — environnement de test uniquement.
 *
 *   npm run loadtest -w @safeway/api -- seed 500 [lat lng]
 *   npm run loadtest -w @safeway/api -- clean
 *
 * `seed` crée N comptes `t_load_*` (anciens : hors période probatoire) avec une session chacun,
 * et écrit `tests/load/fixtures.json` : cookies de session + cellules et zones H3 autour
 * du point choisi (Besançon par défaut). Ce fichier contient des jetons de session : il est
 * ignoré par git et doit être supprimé après usage (`clean` le fait).
 *
 * Ce script n'est pas inclus dans l'image de production (absent des entrées tsup).
 */
import { toEventCell, zoneOf } from '@safeway/shared';
import { gridDisk } from 'h3-js';
import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { SessionStore } from './lib/sessions.js';
import { createRedis } from './redis.js';

const FIXTURES = fileURLToPath(new URL('../../../tests/load/fixtures.json', import.meta.url));
const PREFIX = 't_load_';
const BESANCON = [47.2378, 6.0241] as const;

const [command, countArg, latArg, lngArg] = process.argv.slice(2);
const out = (msg: string) => process.stdout.write(msg + '\n');

if (process.env.NODE_ENV === 'production' && process.env.LOADTEST_ALLOW !== '1') {
  out('Refusé : NODE_ENV=production. Les tests de charge se font sur un environnement dédié (LOADTEST_ALLOW=1 pour forcer).');
  process.exit(2);
}

const sql = createDb(process.env.DATABASE_URL!);
const redis = createRedis(process.env.REDIS_URL!);
const sessions = new SessionStore(redis);

async function clean(): Promise<number> {
  const users = await sql<{ id: string }[]>`DELETE FROM users WHERE pseudo LIKE ${PREFIX + '%'} RETURNING id`;
  for (const { id } of users) await sessions.destroyAllForUser(id);
  await rm(FIXTURES, { force: true });
  return users.length;
}

try {
  if (command === 'seed') {
    const count = Math.min(Number(countArg ?? 200), 20_000);
    const [lat, lng] = latArg && lngArg ? [Number(latArg), Number(lngArg)] : BESANCON;
    await clean();
    const cookieName = process.env.NODE_ENV === 'production' ? '__Host-sw_session' : 'sw_session';
    const cookies: string[] = [];
    for (let i = 0; i < count; i++) {
      const pseudo = `${PREFIX}${String(i).padStart(5, '0')}`;
      const [user] = await sql<{ id: string }[]>`
        INSERT INTO users (pseudo, created_at) VALUES (${pseudo}, current_date - 30) RETURNING id`;
      cookies.push(`${cookieName}=${await sessions.create(user!.id)}`);
    }
    // ≈ 1 km autour du point : de quoi répartir les signalements sur plusieurs zones.
    const cells = gridDisk(toEventCell(lat, lng), 8);
    const zones = [...new Set(cells.map(zoneOf))];
    await writeFile(FIXTURES, JSON.stringify({ cookies, cells, zones }));
    out(`${count} comptes de test, ${cells.length} cellules, ${zones.length} zones → ${FIXTURES}`);
  } else if (command === 'clean') {
    out(`${await clean()} comptes de test supprimés, fixtures effacées.`);
  } else {
    out('Usage : loadtest-cli seed <n> [lat lng] | loadtest-cli clean');
    process.exitCode = 2;
  }
} finally {
  await sql.end();
  redis.disconnect();
}
