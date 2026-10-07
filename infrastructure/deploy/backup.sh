#!/usr/bin/env bash
# Sauvegarde chiffrée de la base SafeWay (lancée chaque nuit par safeway-backup.timer,
# et par deploy.sh avant toute migration).
#
# Contenu : schéma complet + comptes (pseudo, réputation, statut) + clés publiques des passkeys.
# Exclu volontairement : signalements et votes (éphémères, < 1 h de vie, §30) — une sauvegarde
# ne doit jamais devenir un historique des manifestations.
#
# Chiffrement : age, vers la (ou les) clé(s) PUBLIQUE(S) de `.backup-recipient`. La clé privée
# n'est jamais sur le serveur : un serveur compromis ne peut pas relire ses sauvegardes.
# Rétention : 14 jours. Copie hors serveur optionnelle : SAFEWAY_BACKUP_RCLONE=remote:bucket.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ENV_FILE="${SAFEWAY_ENV_FILE:-.env.prod}"
RECIPIENTS="${SAFEWAY_BACKUP_RECIPIENTS:-$ROOT/.backup-recipient}"
DEST="${SAFEWAY_BACKUP_DIR:-/var/backups/safeway}"
KEEP_DAYS="${SAFEWAY_BACKUP_KEEP_DAYS:-14}"
AGE="${AGE:-age}"

[[ -s "$RECIPIENTS" ]] || { echo "Refusé : $RECIPIENTS absent — aucune sauvegarde n'est écrite en clair." >&2; exit 1; }
mkdir -p "$DEST"
umask 077

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$DEST/safeway-$stamp.dump.age"

docker compose --env-file "$ENV_FILE" -f infrastructure/docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U safeway -d safeway --format=custom --compress=9 \
  --exclude-table-data=events --exclude-table-data=event_votes |
  $AGE --encrypt --recipients-file "$RECIPIENTS" >"$file.part"

# Une sauvegarde vide ou tronquée ne remplace jamais les précédentes.
(($(stat -c %s "$file.part" 2>/dev/null || wc -c <"$file.part") > 1024)) || { rm -f "$file.part"; echo "Sauvegarde vide : échec" >&2; exit 1; }
mv "$file.part" "$file"

if [[ -n "${SAFEWAY_BACKUP_RCLONE:-}" ]]; then
  rclone copy --quiet "$file" "$SAFEWAY_BACKUP_RCLONE"
fi

find "$DEST" -name 'safeway-*.dump.age' -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde chiffrée : $file"
