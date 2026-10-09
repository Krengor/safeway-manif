#!/usr/bin/env bash
# Prépare les données cartographiques sur le serveur (à lancer avant le premier déploiement,
# puis pour changer de zone) :
#   - fond de carte PMTiles + polices + sprites (Protomaps), servis par Caddy ;
#   - extrait OpenStreetMap pour l'itinéraire (Geofabrik), lu par Valhalla.
#
#   infrastructure/deploy/map-assets.sh                    # Besançon + Franche-Comté (zone de test)
#   SAFEWAY_REGIONS=france infrastructure/deploy/map-assets.sh   # une carte par région (≈ 4,7 Go)
#   SAFEWAY_BBOX="minLon,minLat,maxLon,maxLat" SAFEWAY_REGION_NAME="Lyon" \
#   OSM_EXTRACT=europe/france/rhone-alpes infrastructure/deploy/map-assets.sh
#
# Le fond de carte d'une région est aussi ce que les téléphones téléchargent pour le hors ligne :
# zone unique de la taille d'une ville (quelques dizaines de Mo), ou découpage par région de France
# (24 à 680 Mo chacune, zoom 14) ; l'app propose alors la région où se trouve le téléphone.
# Après un changement d'extrait OSM, Valhalla reconstruit son graphe au démarrage (long).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OSM_EXTRACT="${OSM_EXTRACT:-europe/france/franche-comte}"
VALHALLA_DIR=infrastructure/valhalla/custom_files

echo "==> Fond de carte (${SAFEWAY_REGION_NAME:-Besançon})"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e SAFEWAY_BBOX -e SAFEWAY_MAXZOOM -e SAFEWAY_REGION_NAME -e SAFEWAY_REGIONS -e SAFEWAY_REFRESH \
  -v "$ROOT:/app" -w /app node:22-alpine node apps/web/scripts/fetch-map-assets.mjs

echo "==> Extrait OpenStreetMap pour l'itinéraire ($OSM_EXTRACT)"
mkdir -p "$VALHALLA_DIR"
pbf="$VALHALLA_DIR/$(basename "$OSM_EXTRACT")-latest.osm.pbf"
url="https://download.geofabrik.de/$OSM_EXTRACT-latest.osm.pbf"
expected="$(curl -fsSL "$url.md5" | awk '{print $1}')"
if [[ -f "$pbf" && "$(md5sum "$pbf" | awk '{print $1}')" == "$expected" ]]; then
  echo "Extrait inchangé : graphe d'itinéraire conservé."
else
  curl -fL --progress-bar -o "$pbf.part" "$url"
  [[ "$(md5sum "$pbf.part" | awk '{print $1}')" == "$expected" ]] || { rm -f "$pbf.part"; echo "Somme de contrôle invalide" >&2; exit 1; }
  mv "$pbf.part" "$pbf"
  # Un autre extrait serait fusionné au graphe : on ne garde que celui-ci, et l'ancien graphe
  # est effacé (Valhalla ignore sinon le nouvel extrait tant que des tuiles existent).
  find "$VALHALLA_DIR" -maxdepth 1 -name '*.osm.pbf' ! -name "$(basename "$pbf")" -delete
  # Le graphe est écrit par le conteneur Valhalla (root) : on l'efface depuis un conteneur aussi.
  docker run --rm -v "$ROOT/$VALHALLA_DIR:/data" node:22-alpine \
    rm -rf /data/valhalla_tiles /data/valhalla_tiles.tar /data/admins.sqlite /data/file_hashes.txt
  echo "Nouvel extrait : Valhalla reconstruira son graphe au prochain démarrage (de quelques minutes à plus d'une heure)."
  echo "Pour l'appliquer à un service déjà lancé : docker compose ... restart valhalla"
fi
