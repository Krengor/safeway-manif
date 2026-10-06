/**
 * Temps réel — connexions WebSocket en masse (A) et perte d'un gateway (G, §62).
 *
 *   k6 run -e CONNECTIONS=5000 tests/load/k6/g-realtime.js
 *
 * Chaque connexion s'abonne à quelques zones et reste ouverte SESSION_S secondes. Si le
 * gateway tombe, elle se reconnecte avec un délai aléatoire (comme l'app), sur une autre
 * instance derrière le répartiteur. Pendant le test, arrêter un gateway
 * (`docker compose stop gateway` ou une réplique) : `ws_reconnects` compte les connexions
 * coupées côté serveur. Avec au moins deux gateways derrière Caddy, `ws_sessions_ok` doit
 * rester au-dessus de 99 % ; avec une seule instance, les tentatives échouent tant qu'elle
 * est arrêtée (attendu) et l'on mesure plutôt le temps de retour des connexions
 * (`safeway_ws_connections` côté gateway).
 */
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import ws from 'k6/ws';
import { ORIGIN, WS_URL, device, viewOf } from './lib.js';

const reconnects = new Counter('ws_reconnects');
const updates = new Counter('ws_updates');
const sessionsOk = new Rate('ws_sessions_ok');
const connections = Number(__ENV.CONNECTIONS || 1000);

export const options = {
  scenarios: {
    sockets: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: connections },
        { duration: __ENV.HOLD || '5m', target: connections },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: { ws_sessions_ok: ['rate>0.99'] },
};

export default function () {
  const dev = device(__VU);
  let planned = false;
  let closedEarly = false;
  const res = ws.connect(WS_URL, { headers: { origin: ORIGIN } }, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ t: 'sub', zones: viewOf(dev) })));
    socket.on('message', (raw) => {
      if (JSON.parse(raw).t === 'upd') updates.add(1);
    });
    // Fermeture non demandée par le client = coupure côté serveur (gateway arrêté, redémarré…).
    socket.on('close', () => {
      closedEarly = !planned;
    });
    socket.setTimeout(() => {
      planned = true;
      socket.close();
    }, Number(__ENV.SESSION_S || 120) * 1000);
  });
  const ok = check(res, { 'connexion établie': (r) => r && r.status === 101 });
  sessionsOk.add(ok);
  if (closedEarly) reconnects.add(1);
  // Délai aléatoire avant reconnexion, comme l'app : pas de retour simultané après une panne.
  sleep(ok && !closedEarly ? 0.5 + Math.random() : 1 + Math.random() * 4);
}
