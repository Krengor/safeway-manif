# Architecture

## Vue d'ensemble (V0.1)

```text
 Téléphone (PWA)                                   Serveur
 ┌─────────────────────────────┐   HTTPS   ┌──────────────────────────────────────┐
 │ GPS ──► cellule H3 rés. 10  │──────────►│ Caddy : TLS, CSP, statiques, tuiles   │
 │   (coordonnées en RAM,      │           │   │                                   │
 │    jamais envoyées)         │           │   ▼ /api                              │
 │ MapLibre + PMTiles          │◄──────────│ API Fastify (stateless)               │
 │ couleur des rues calculée   │           │   ├─ PostgreSQL : comptes, événements │
 │ localement                  │           │   └─ Redis : sessions, rate limiting  │
 └─────────────────────────────┘           └──────────────────────────────────────┘
```

## Discrétisation géographique (H3)

| Usage | Résolution | Taille | Pourquoi |
|---|---|---|---|
| Signalement / preuve de présence | 10 | arête ≈ 66 m | assez fin pour décrire une rue, assez large pour ne pas pointer une personne |
| Zone de lecture / canal temps réel | 7 | arête ≈ 1,4 km | une requête de carte ne révèle qu'un quartier ; URL identique pour tous → cache CDN |
| Proximité requise | k = 2 anneaux | ≈ 200-250 m | on ne signale/vote que ce que l'on peut voir |

Pourquoi H3 plutôt que des segments OSM côté serveur : pas besoin d'importer et maintenir un graphe routier
dans PostGIS pour la V0.1, cellules de taille homogène, voisinage calculable sur l'appareil. La couleur des
rues est obtenue **sur le client** en découpant les tronçons de route des tuiles vectorielles par les
hexagones (Cyrus–Beck, [`map/clip.ts`](../apps/web/src/map/clip.ts)). PostGIS est installé pour le routage (V0.2).

## Cycle de vie d'un signalement

1. Le client calcule sa cellule (rés. 10) et la cellule visée (sa position, ou un appui long à ≤ 200 m).
2. `POST /api/events { type, cell, presenceCell }` — le serveur vérifie la proximité, puis oublie `presenceCell`.
3. Si le même type est déjà actif sur la cellule, la requête devient une confirmation (pas de doublon).
4. Les votes stockent `HMAC(VOTE_TOKEN_SECRET, user_id:event_id)` : un jeton par couple, impossible de relier
   deux votes d'une même personne sans le secret, et supprimé avec l'événement.
5. Chaque confirmation prolonge légèrement l'expiration (plafond : 2 × durée initiale). 3 invalidations
   majoritaires retirent immédiatement le signalement.
6. Un job (chaque instance, toutes les ~60 s, idempotent) supprime physiquement les événements expirés.

## Temps réel (V0.2)

```text
API ──PUBLISH ev:<zone>──► Redis Pub/Sub ──► realtime-gateway (N instances) ──WebSocket──► clients
```

- Un client envoie `{ t: 'sub', zones: [...] }` (zones H3 rés. 7 de sa vue, 12 max) ; le gateway ne
  s'abonne au bus que pour les zones suivies par au moins un client.
- Les changements sont regroupés par zone pendant 250 ms ; pour un même événement seule la révision la plus
  haute est gardée. Chaque lot est sérialisé **une fois** puis envoyé à tous les abonnés de la zone.
- Contre-pression : un client dont le tampon d'envoi dépasse 512 Ko est déconnecté (il se resynchronise).
- Protection : origine vérifiée, messages de 2 Ko max, 20 messages / 10 s, ping toutes les 30 s.
- Le gateway n'a ni base de données ni authentification : il ne voit que des zones, en mémoire.
- Côté client : reconnexion avec backoff exponentiel + jitter ; polling toutes les 30 s quand le temps réel
  est actif (resynchronisation), 10 s sinon. Fusion par révision (`rev`) quelle que soit la source.
- Panne du bus ou d'un gateway : les écritures ne sont pas affectées, l'app retombe sur le polling
  (indicateur « Différé »). Arrêt propre d'un gateway : code 1012, les clients se reconnectent ailleurs.

Mesuré en local : ~230 ms entre l'écriture d'un signalement et son affichage chez un autre client.

## Score et couleurs

[`packages/shared/src/confidence.ts`](../packages/shared/src/confidence.ts) — partagé client/serveur.

- `confiance = accord × fraîcheur`, avec `accord = conf / (conf + inv + 1,5)` et une fraîcheur qui décroît
  de 1 à 0,5 sur la durée de vie.
- Danger non contesté et confiance ≥ 0,35 → **rouge** (un seul signalement suffit : on privilégie la prudence).
- Passage libre confirmé (confiance ≥ 0,5, donc ≥ 2 personnes) → **vert**.
- Tout le reste (contesté, faible, vigilance) → **orange**. Aucune info → **gris**. Le danger prime toujours.

La réputation des auteurs (§21) n'est pas encore intégrée : elle nécessite de relier un événement à son auteur
de façon éphémère (piste : Redis avec TTL = durée de vie de l'événement). Prévu en V0.2.

## Sécurité applicative

- Passkeys uniquement (WebAuthn, `attestation: none`, clés découvrables). Pas de mot de passe.
- Session : jeton 256 bits en cookie `__Host-` HttpOnly, Secure, SameSite=Strict ; Redis stocke `sha256(jeton)`.
- CSRF : SameSite=Strict + en-tête `x-safeway: 1` obligatoire + contrôle de l'en-tête Origin.
- CSP stricte sans `unsafe-inline` (testée avec `vite preview`), HSTS preload, Permissions-Policy minimale.
- Validation zod de tous les payloads, aucune lat/lng acceptée, corps limité à 16 Ko, requêtes SQL paramétrées,
  `statement_timeout` 3 s.
- Logs : méthode, route (motif, sans paramètres), code HTTP, durée, id de requête aléatoire. Ni IP, ni URL,
  ni en-têtes, ni corps.

## Résilience

- Redis indisponible → la carte reste lisible (PostgreSQL), le rate limiting bascule en mémoire locale ;
  les écritures (session requise) échouent proprement.
- Réseau mobile saturé → la dernière carte reste affichée en mémoire avec « Données non actualisées depuis X min ».
- La coquille de l'app est en cache (service worker). Les réponses d'API et les tuiles ne sont **pas** mises en
  cache par le service worker : ce cache constituerait sur l'appareil un historique des zones consultées.

## Trajectoire vers 500 000 utilisateurs (non validée)

Ce qui est déjà compatible : API stateless, sessions dans Redis, lecture par zone cacheable au CDN (5 s),
statiques et tuiles servis hors API, pas de broadcast global, index `(zone_id, expires_at)`.

À faire, par ordre de priorité :

1. **Bus d'événements** : le gateway (fait en V0.2) passe par Redis Pub/Sub. Au-delà d'une instance Redis,
   passer à Redis Cluster (SPUBLISH par zone) ou NATS — l'interface `EventBus` de l'API est prévue pour.
2. **Compteurs de votes chauds** : le verrou de ligne par événement limite un événement « viral ».
   Compteurs Redis + flush asynchrone par lots.
3. **PgBouncer + réplicas de lecture** pour `/map/zones`, cache applicatif court en Redis.
4. **Niveaux de dégradation** (§56) pilotés par la charge, exposés par `/api/map/status`.
5. **Tests de charge** `tests/load` exécutés en préproduction, rapports dans `docs/performance/`.

Aucune revendication de capacité tant que l'étape 5 n'a pas produit de rapport.
