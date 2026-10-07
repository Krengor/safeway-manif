# Infrastructure

## Développement

`docker-compose.dev.yml` : PostgreSQL/PostGIS + Redis liés à `127.0.0.1`, mots de passe lus dans `.env`.
Redis sans persistance disque (données éphémères uniquement).

## Production mono-serveur

Guide complet : [docs/deploiement.md](../docs/deploiement.md). Scripts dans `deploy/` :

| Script | Rôle |
|---|---|
| `provision.sh` | prépare un VPS Ubuntu 24.04 neuf (pare-feu, SSH par clé, Docker, sauvegardes programmées) |
| `gen-secrets.sh` | crée `.env.prod` avec des secrets forts (refuse d'écraser) |
| `map-assets.sh` | fond de carte (Protomaps) + extrait OSM pour l'itinéraire (Geofabrik) |
| `deploy.sh` | met à jour service par service, retour arrière automatique en cas d'échec |
| `backup.sh` / `restore.sh` | sauvegarde chiffrée (age) des comptes uniquement, restauration de test ou réelle |

Caddy obtient le certificat TLS, redirige HTTP → HTTPS, applique HSTS/CSP et n'écrit **aucun journal
d'accès**. Tester les passkeys sur téléphone exige ce domaine HTTPS.

## Montée en charge

Voir [docs/architecture.md](../docs/architecture.md#trajectoire-vers-500-000-utilisateurs-non-validée).
Exemples Kubernetes / Terraform à venir avec la realtime-gateway (V0.2).
