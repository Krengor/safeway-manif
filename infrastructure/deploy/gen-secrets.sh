#!/usr/bin/env bash
# Génère le fichier d'environnement de production avec des secrets forts.
#
#   infrastructure/deploy/gen-secrets.sh safeway-manif.fr [.env.prod]
#
# - Refuse d'écraser un fichier existant : changer VOTE_TOKEN_SECRET ou EVENT_SIGNING_KEY
#   en production a des effets (anti-double vote, signatures hors réseau) ; voir docs/deploiement.md.
# - Le fichier est créé en 600 (lisible par son seul propriétaire). Ne jamais le committer.
set -euo pipefail

domain="${1:?usage: gen-secrets.sh <domaine> [fichier]}"
out="${2:-.env.prod}"

if [[ -e "$out" ]]; then
  echo "Refusé : $out existe déjà (les secrets de production ne se régénèrent pas par accident)." >&2
  exit 1
fi
if [[ ! "$domain" =~ ^[a-z0-9.-]+\.[a-z]{2,}$|^localhost$ ]]; then
  echo "Domaine invalide : $domain" >&2
  exit 1
fi

rand() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }

# Clé Ed25519 de signature des signalements (format PKCS#8 DER, base64url), via Node.
signing_key() {
  local js="const c=require('crypto');process.stdout.write(c.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'))"
  if command -v node >/dev/null 2>&1; then node -e "$js"; else docker run --rm node:22-alpine node -e "$js"; fi
}

umask 077
cat >"$out" <<EOF
# SafeWay — production. Généré le $(date -u +%Y-%m-%dT%H:%M:%SZ). NE PAS COMMITTER.
SAFEWAY_DOMAIN=$domain
POSTGRES_PASSWORD=$(rand)
REDIS_PASSWORD=$(rand)
VOTE_TOKEN_SECRET=$(rand)
RATE_LIMIT_SECRET=$(rand)
EVENT_SIGNING_KEY=$(signing_key)
EOF
chmod 600 "$out"
echo "Secrets écrits dans $out (600). Gardez-en une copie hors du serveur (gestionnaire de mots de passe)."
