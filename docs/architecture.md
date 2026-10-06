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

1. **V0.2 — realtime-gateway** : service WebSocket séparé, abonnement par zone H3 rés. 7, fan-out via NATS,
   batching 100-500 ms, backpressure. Le polling 10 s actuel est le repli.
2. **Compteurs de votes chauds** : le verrou de ligne par événement limite un événement « viral ».
   Compteurs Redis + flush asynchrone par lots.
3. **PgBouncer + réplicas de lecture** pour `/map/zones`, cache applicatif court en Redis.
4. **Niveaux de dégradation** (§56) pilotés par la charge, exposés par `/api/map/status`.
5. **Tests de charge** `tests/load` exécutés en préproduction, rapports dans `docs/performance/`.

Aucune revendication de capacité tant que l'étape 5 n'a pas produit de rapport.
