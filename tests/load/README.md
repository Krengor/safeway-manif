# Tests de charge (cahier §62)

Scénarios [k6](https://k6.io). **Uniquement contre un environnement de test qui vous appartient.**
Aucune affirmation de capacité (« tient 500 000 utilisateurs ») sans rapport issu de ces tests sur
l'infrastructure réelle.

## Préparer

```bash
# Comptes de test t_load_* (hors période probatoire) + sessions + cellules autour de Besançon
npm run loadtest -w @safeway/api -- seed 1000
```

`fixtures.json` contient des jetons de session : il est ignoré par git. À la fin :
`npm run loadtest -w @safeway/api -- clean` (supprime comptes, sessions et fichier).

Pour simuler beaucoup d'appareils depuis un seul injecteur, viser l'API **directement** avec
`TRUST_PROXY_HOPS=1` : k6 joue le rôle du proxy et chaque utilisateur virtuel annonce sa propre adresse
(`X-Forwarded-For`, plage de test 198.18.0.0/15). Sinon toutes les requêtes partagent une IP et butent sur
les limites par adresse — ce qui est d'ailleurs le comportement voulu face à un attaquant.

```bash
API_PORT=4390 API_HOST=0.0.0.0 TRUST_PROXY_HOPS=1 METRICS_PORT=9390 npm run dev -w @safeway/api
```

## Lancer

Sans k6 installé, via Docker :

```bash
docker run --rm -v "$PWD/tests/load:/load" -w /load/k6 -e BASE_URL=http://host.docker.internal:4390 grafana/k6 run a-ramp.js
```

| Test | Script | Ce qui est vérifié |
|---|---|---|
| A — montée progressive | `a-ramp.js` (`PEAK`) | paliers 0,2 % → 100 % de `PEAK`, SLO §61 |
| B — pic | `b-spike.js` (`BASE`, `PEAK`, `RISE`) | pas d'effondrement, le niveau §56 monte puis redescend |
| C — votes massifs | `c-votes.js` (`RATE` votes/s) | milliers de confirmations sur une même cellule |
| D — événement viral | `d-viral.js` (`PEAK`) | tout le monde lit les 3 mêmes zones (micro-cache) |
| E — panne Redis | manuel, voir ci-dessous | lecture maintenue, écritures en 503 (gardées par l'app) |
| F — panne PostgreSQL | manuel | failover (nécessite un primaire + réplica) |
| G — perte d'un gateway | `g-realtime.js` (`CONNECTIONS`) + arrêt d'un gateway | reconnexion des clients |
| H — réseau lent | `a-ramp.js` derrière `tc netem` / toxiproxy | délais et pertes côté client |
| I — DDoS applicatif | `i-flood.js` (`ATTACK_RATE`, `USERS`) | attaquants en 429, manifestants dans les SLO |

Pendant un test : métriques internes sur `http://<api>:9390/metrics` et `http://<gateway>:9391/metrics`,
niveau de charge sur `/api/map/status`. Le test « soak » (§63) est `a-ramp.js` avec `STEP_HOLD=6h`.

### E — panne Redis

```bash
docker compose stop redis   # pendant a-ramp.js
# attendu : /api/map/zones 200, POST /api/events 503 « réessayez », /api/ready → redis:false
docker compose start redis
```

Redis n'a volontairement aucune persistance (liens éphémères de réputation, jamais sur disque) : après un
redémarrage, les sessions sont perdues et chacun se reconnecte par passkey ; les envois gardés par l'app
repartent ensuite. En production : réplique Redis (Sentinel) plutôt que persistance.

### H — réseau lent

Sous Linux, sur l'injecteur : `tc qdisc add dev eth0 root netem delay 400ms 150ms loss 3%` (3G
dégradée), puis `a-ramp.js`. À retirer avec `tc qdisc del dev eth0 root`.

## Premiers résultats (local, non représentatifs)

Poste de développement Windows, API et gateway en une instance chacun, PostgreSQL et Redis en Docker,
k6 en Docker. Ces chiffres valident les scripts et le comportement, **pas une capacité**.

| Scénario | Charge | Résultat |
|---|---|---|
| A | 150 utilisateurs | lecture p95 4,7 ms, signalement p95 22 ms, vote p95 32 ms, 0 % d'erreur |
| C | 150 votes/s pendant 40 s | vote p95 10,6 ms, 0 % d'erreur |
| D | 800 utilisateurs sur 3 zones | lecture p95 6,4 ms, 0 % d'erreur |
| I | 300 req/s d'attaque (3 IP) + 200 utilisateurs | attaquants limités (429), utilisateurs 100 % servis, lecture p95 4,5 ms |
| E | Redis arrêté | lecture 200, signalement 503 puis gardé par l'app |
| G | 800 WebSockets, gateway tué puis relancé | ~700 reconnectées 20 s après le redémarrage, ~300 messages/s relayés |
| D | 6 000 utilisateurs | **non concluant** : refus de connexion par le pont réseau Docker Desktop, alors que l'API restait au repos (boucle d'événements ~30 ms, ~0 requête en cours) |

Les vrais paliers (10k → 500k) se mesurent sur l'infrastructure cible, avec plusieurs injecteurs.
