# SafeWay Manif

Application web mobile (PWA) d'aide aux déplacements piétons pendant les manifestations, basée sur des
informations **communautaires, anonymes et éphémères**.

> Collecter le minimum. Chiffrer le nécessaire. Supprimer le temporaire.
> Ne jamais transformer la sécurité collective en surveillance individuelle.

- Carte des rues colorées : 🟢 passage confirmé · 🟠 incertain · 🔴 danger / blocage · ⚪ pas d'info récente
- Signalement en deux gestes, confirmation / invalidation par les personnes à proximité
- Expiration automatique (10 à 30 min) puis suppression physique
- Aucune position individuelle visible, aucun historique de déplacement

⚠️ Les informations sont fournies par la communauté et peuvent être incomplètes, anciennes ou incorrectes.
Aucun itinéraire n'est garanti « sûr ».

## Garanties de confidentialité (vérifiables dans le code)

| Donnée | Traitement |
|---|---|
| Coordonnées GPS | Restent sur l'appareil, en mémoire uniquement ([`useManifMode.ts`](apps/web/src/lib/useManifMode.ts)). Converties en cellule H3 (~66 m) avant tout envoi. |
| Cellule de présence | Envoyée seulement pour signaler/voter, vérifiée puis oubliée ([`routes/events.ts`](apps/api/src/routes/events.ts)). Jamais stockée ni journalisée. |
| Auteur d'un signalement | Non stocké. Les votes sont liés à `HMAC(secret, user:event)`, différent pour chaque événement. |
| Compte | Pseudo + clé **publique** de passkey. Pas d'e-mail, de téléphone ni de mot de passe. |
| Adresses IP | Jamais journalisées ; pseudonymisées par HMAC pour le rate limiting, TTL de quelques minutes. |
| Tuiles cartographiques | Auto-hébergées (PMTiles) : aucun fournisseur tiers ne voit la zone consultée. |
| Cache hors ligne | Seule la coquille de l'app est mise en cache ; jamais les zones consultées. |

Détails : [docs/architecture.md](docs/architecture.md) · [docs/privacy.md](docs/privacy.md)

## Structure

```text
apps/web         PWA — Vite, React, TypeScript, MapLibre GL, PMTiles, Tailwind
apps/api         API — Fastify, TypeScript, PostgreSQL (+PostGIS), Redis
packages/shared  Types, catalogue des signalements, règles H3, score de confiance
infrastructure   Docker Compose (dev et prod), Caddy
tests/load       Scénarios de charge k6
docs             Architecture, confidentialité, rapports de performance
```

## Démarrage local

Prérequis : Node.js ≥ 22, Docker.

```bash
cp .env.example .env        # puis remplacer chaque CHANGE_ME (voir la commande en tête du fichier)
npm install
npm run dev:infra           # PostgreSQL/PostGIS + Redis (ports liés à 127.0.0.1)
npm run migrate
npm run fetch-map-assets -w @safeway/web   # tuiles + polices (Besançon par défaut, voir SAFEWAY_BBOX)
npm run dev:api             # http://127.0.0.1:4380
npm run dev:web             # http://localhost:5173
```

Les passkeys fonctionnent sur `localhost` sans HTTPS. Pour tester sur téléphone, il faut un domaine en HTTPS
(WebAuthn l'exige) : voir [infrastructure/README.md](infrastructure/README.md).

## Qualité

```bash
npm run typecheck && npm run lint && npm test
```

Les tests d'API tournent sur une vraie base PostgreSQL/Redis (celle de `npm run dev:infra`).

## Feuille de route

- **V0.1** (en cours) — compte pseudo + passkey, carte, Mode Manif, signalements, confirmations, expiration, couleur des rues
- **V0.2** — routage sécurisé, réputation, temps réel (gateway WebSocket par zone H3), alertes sur trajet
- **V0.3** — anti-abus avancé, réseau dégradé, modération, tests de charge 500k

Aucune mention « supporte 500 000 utilisateurs » ne sera faite sans rapport de charge publié dans
[docs/performance](docs/performance/).

## Contribuer / sécurité

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Licence

[GNU AGPL-3.0-or-later](LICENSE). Toute instance publique d'une version modifiée doit publier son code source
à ses utilisateurs — une garantie de plus que personne ne peut faire tourner en secret une version qui collecte
davantage de données.
