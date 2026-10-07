#!/usr/bin/env bash
# Restauration d'une sauvegarde SafeWay.
#
#   restore.sh <fichier.dump.age> <clé-privée-age>            # TEST (par défaut) : restaure dans
#                                                             # une base jetable et compte les lignes
#   restore.sh <fichier.dump.age> <clé-privée-age> --for-real # remplace la base de production
#
# Le test peut se faire sur n'importe quelle machine avec Docker (votre PC, où se trouve la clé
# privée). À faire au moins une fois par mois : une sauvegarde jamais restaurée n'est pas une
# sauvegarde.
set -euo pipefail

backup="${1:?usage: restore.sh <fichier.dump.age> <clé-privée> [--for-real]}"
identity="${2:?clé privée age manquante}"
mode="${3:---test}"
AGE="${AGE:-age}"
PG_IMAGE=postgis/postgis:17-3.5

decrypt() { $AGE --decrypt --identity "$identity" "$backup"; }

if [[ "$mode" == "--test" ]]; then
  name="safeway-restore-test-$$"
  docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test "$PG_IMAGE" >/dev/null
  trap 'docker stop "$name" >/dev/null' EXIT
  # L'image initialise puis redémarre une fois : on attend qu'elle accepte vraiment une requête.
  until docker exec "$name" psql -U postgres -Atc 'SELECT 1' >/dev/null 2>&1 && sleep 3 &&
    docker exec "$name" psql -U postgres -Atc 'SELECT 1' >/dev/null 2>&1; do sleep 1; done
  # Base vierge (template0) : la sauvegarde recrée elle-même ses extensions.
  docker exec "$name" createdb -U postgres -T template0 safeway
  decrypt | docker exec -i "$name" pg_restore -U postgres -d safeway --no-owner --exit-on-error
  docker exec "$name" psql -U postgres -d safeway -Atc "
    SELECT 'comptes : ' || count(*) FROM users
    UNION ALL SELECT 'passkeys : ' || count(*) FROM credentials
    UNION ALL SELECT 'migrations : ' || string_agg(name, ', ' ORDER BY name) FROM schema_migrations
    UNION ALL SELECT 'signalements (doit être 0) : ' || count(*) FROM events"
  echo "Restauration de test réussie : $backup"
  exit 0
fi

[[ "$mode" == "--for-real" ]] || { echo "Mode inconnu : $mode" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose --env-file "${SAFEWAY_ENV_FILE:-.env.prod}" -f infrastructure/docker/docker-compose.prod.yml)

read -r -p "Remplacer la base de PRODUCTION par $backup ? Taper « restaurer » : " answer
[[ "$answer" == "restaurer" ]] || { echo "Annulé."; exit 1; }

"${COMPOSE[@]}" stop api routing gateway
# Base recréée vierge (template0) : la sauvegarde contient le schéma et ses extensions.
"${COMPOSE[@]}" exec -T postgres dropdb -U safeway --force --if-exists --maintenance-db=postgres safeway
"${COMPOSE[@]}" exec -T postgres createdb -U safeway -T template0 safeway
decrypt | "${COMPOSE[@]}" exec -T postgres pg_restore -U safeway -d safeway --no-owner --exit-on-error
"${COMPOSE[@]}" start api routing gateway
echo "Base restaurée. Les sessions (Redis) sont conservées ; les signalements repartent de zéro."
