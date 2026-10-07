#!/usr/bin/env bash
# Déploiement / mise à jour de SafeWay sur le serveur, depuis /opt/safeway (utilisateur `safeway`).
#
#   infrastructure/deploy/deploy.sh             # dernière version de main
#   infrastructure/deploy/deploy.sh v0.3.0      # un tag ou un commit précis
#   infrastructure/deploy/deploy.sh --rollback  # revenir à la version précédente
#
# Déroulé : construction des nouvelles images pendant que l'ancienne version tourne,
# sauvegarde, migrations, puis redémarrage service par service avec contrôle de santé.
# Au premier service en échec : retour automatique à la version précédente (images déjà
# construites, aucun rebuild). Chaque service ne s'interrompt que quelques secondes ; l'app
# les absorbe (envois en attente, reconnexion temps réel, polling).
#
# Les migrations doivent rester rétrocompatibles (ajouts uniquement) : un retour arrière ne
# défait pas une migration.
set -euo pipefail

# `git checkout` réécrit ce fichier pendant son exécution : on s'exécute depuis une copie.
if [[ -z "${SAFEWAY_DEPLOY_ROOT:-}" ]]; then
  SAFEWAY_DEPLOY_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  copy="$(mktemp)"
  cp "$0" "$copy"
  SAFEWAY_DEPLOY_ROOT=$SAFEWAY_DEPLOY_ROOT exec bash "$copy" "$@"
fi
ROOT=$SAFEWAY_DEPLOY_ROOT
trap 'rm -f "$0"' EXIT
cd "$ROOT"
ENV_FILE="${SAFEWAY_ENV_FILE:-.env.prod}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f infrastructure/docker/docker-compose.prod.yml)
STATE=.deploy
SERVICES=(api gateway routing web)
HEALTH_TIMEOUT=120
# Options curl du test final (ex. « -k » pour un essai local avec certificat interne de Caddy).
read -r -a SMOKE_CURL_OPTS <<<"${SAFEWAY_SMOKE_CURL_OPTS:-}"

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE introuvable : lancez d'abord infrastructure/deploy/gen-secrets.sh <domaine>"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "modifications locales dans $ROOT : le serveur ne doit pas être édité à la main"
mkdir -p "$STATE"
DOMAIN="$(grep -E '^SAFEWAY_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
[[ -n "$DOMAIN" ]] || die "SAFEWAY_DOMAIN absent de $ENV_FILE"

current="$(cat "$STATE/current" 2>/dev/null || true)"

wait_healthy() {
  local service=$1 deadline=$((SECONDS + HEALTH_TIMEOUT)) id status
  id="$("${COMPOSE[@]}" ps -q "$service")"
  [[ -n "$id" ]] || return 1
  while ((SECONDS < deadline)); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    case "$status" in
      healthy) return 0 ;;
      running) [[ "$service" == web ]] && return 0 ;; # Caddy : pas de healthcheck d'image
      unhealthy | exited | dead) return 1 ;;
    esac
    sleep 2
  done
  return 1
}

# Démarre une version déjà construite, service par service.
switch_to() {
  local version=$1
  export SAFEWAY_VERSION=$version
  "${COMPOSE[@]}" up -d --no-build postgres redis valhalla
  "${COMPOSE[@]}" run --rm --no-deps migrate
  for service in "${SERVICES[@]}"; do
    log "Démarrage de $service ($version)"
    "${COMPOSE[@]}" up -d --no-build --no-deps "$service"
    wait_healthy "$service" || return 1
  done
}

# Ne garde que les images de la version en ligne et de la précédente (retour arrière).
prune_images() {
  local keep=" $* " repo tag
  for repo in safeway-api safeway-gateway safeway-routing safeway-web; do
    docker image ls "$repo" --format '{{.Tag}}' | while read -r tag; do
      [[ "$keep" == *" $tag "* ]] || docker image rm "$repo:$tag" >/dev/null 2>&1 || true
    done
  done
  docker image prune -f >/dev/null || true
}

smoke_test() {
  local url="https://$DOMAIN"
  for path in /api/ready /api/map/status /; do
    curl -fsS --max-time 10 "${SMOKE_CURL_OPTS[@]}" -o /dev/null "$url$path" || { echo "échec : $url$path" >&2; return 1; }
  done
}

if [[ "${1:-}" == "--rollback" ]]; then
  previous="$(cat "$STATE/previous" 2>/dev/null)" || die "aucune version précédente connue"
  log "Retour à $previous"
  git checkout --quiet --detach "$previous"
  switch_to "$previous" || die "le retour arrière lui-même échoue : voir « docker compose logs »"
  echo "$current" >"$STATE/previous"
  echo "$previous" >"$STATE/current"
  log "Version $previous en ligne"
  exit 0
fi

ref="${1:-origin/main}"
log "Récupération de $ref"
git fetch --quiet --tags origin
target="$(git rev-parse --short=12 "$ref^{commit}")"
[[ "$target" != "$current" ]] || { log "Déjà en $target, rien à faire"; exit 0; }
git checkout --quiet --detach "$target"

log "Construction des images $target (l'ancienne version reste en ligne)"
SAFEWAY_VERSION=$target "${COMPOSE[@]}" build --pull

if [[ -n "$current" ]]; then
  log "Sauvegarde avant migration"
  infrastructure/deploy/backup.sh
fi

if switch_to "$target" && smoke_test; then
  [[ -n "$current" ]] && echo "$current" >"$STATE/previous"
  echo "$target" >"$STATE/current"
  prune_images "$target" "$current"
  log "Version $target en ligne sur https://$DOMAIN"
else
  [[ -n "$current" ]] || die "premier déploiement en échec : voir « ${COMPOSE[*]} logs »"
  echo "!! Échec de $target : retour automatique à $current" >&2
  git checkout --quiet --detach "$current"
  switch_to "$current" || die "retour arrière en échec : intervention manuelle nécessaire"
  prune_images "$current" "$(cat "$STATE/previous" 2>/dev/null || true)"
  die "déploiement annulé, $current toujours en ligne"
fi
