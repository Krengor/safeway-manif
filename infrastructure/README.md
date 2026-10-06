# Infrastructure

## Développement

`docker-compose.dev.yml` : PostgreSQL/PostGIS + Redis liés à `127.0.0.1`, mots de passe lus dans `.env`.
Redis sans persistance disque (données éphémères uniquement).

## Production mono-serveur (V0.1)

Prérequis : un serveur en Europe avec Docker, un domaine pointant dessus, un disque chiffré pour le volume
PostgreSQL.

```bash
# sur le serveur, à la racine du dépôt
cp .env.example .env.prod    # SAFEWAY_DOMAIN, POSTGRES_PASSWORD, REDIS_PASSWORD, VOTE_TOKEN_SECRET, RATE_LIMIT_SECRET
SAFEWAY_BBOX="-5.2,41.3,9.6,51.1" npm run fetch-map-assets -w @safeway/web   # France métropolitaine
docker compose --env-file .env.prod -f infrastructure/docker/docker-compose.prod.yml up -d --build
```

Caddy obtient le certificat TLS, redirige HTTP → HTTPS, applique HSTS/CSP et n'écrit **aucun journal d'accès**.

Tester les passkeys sur téléphone exige ce domaine HTTPS (WebAuthn refuse les origines non sécurisées hors
`localhost`).

## Montée en charge

Voir [docs/architecture.md](../docs/architecture.md#trajectoire-vers-500-000-utilisateurs-non-validée).
Exemples Kubernetes / Terraform à venir avec la realtime-gateway (V0.2).
