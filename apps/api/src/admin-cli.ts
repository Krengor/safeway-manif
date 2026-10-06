/**
 * Gestion du rôle administrateur — uniquement depuis le serveur, jamais via l'API.
 *
 *   npm run admin -w @safeway/api -- grant  <pseudo>
 *   npm run admin -w @safeway/api -- revoke <pseudo>
 *   npm run admin -w @safeway/api -- list
 * En production : docker compose exec api node dist/admin-cli.js grant <pseudo>
 */
import { createDb } from './db.js';

const [command, pseudo] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquant');
const sql = createDb(url);
const out = (msg: string) => process.stdout.write(msg + '\n');

try {
  if (command === 'list') {
    const admins = await sql<{ pseudo: string }[]>`SELECT pseudo FROM users WHERE role = 'admin' ORDER BY pseudo`;
    out(admins.length ? admins.map((a) => `- ${a.pseudo}`).join('\n') : 'Aucun administrateur.');
  } else if ((command === 'grant' || command === 'revoke') && pseudo) {
    const role = command === 'grant' ? 'admin' : 'user';
    const result = await sql`UPDATE users SET role = ${role} WHERE lower(pseudo) = lower(${pseudo})`;
    out(result.count ? `${pseudo} : rôle « ${role} ».` : `Pseudo introuvable : ${pseudo}`);
    if (!result.count) process.exitCode = 1;
  } else {
    out('Usage : admin-cli <grant|revoke> <pseudo> | admin-cli list');
    process.exitCode = 2;
  }
} finally {
  await sql.end();
}
