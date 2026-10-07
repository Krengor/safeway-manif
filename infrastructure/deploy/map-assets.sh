#!/usr/bin/env bash
# Prépare les données cartographiques sur le serveur (à lancer avant le premier déploiement,
# puis pour changer de zone) :
#   - fond de carte PMTiles + polices + sprites (Protomaps), servis par Caddy ;
#   - extrait OpenStreetMap pour l'itinéraire (Geofabrik), lu par Valhalla.
#
#   infrastructure/deploy/map-assets.sh                    # Besançon + Franche-Comté (zone de test)
#   SAFEWAY_BBOX="minLon,minLat,maxLon,maxLat" SAFEWAY_REGION_NAME="Lyon" \
#   OSM_EXTRACT=europe/france/rhone-alpes infrastructure/deploy/map-assets.sh
#
# Le fond de carte d'une région est aussi ce que les téléphones téléchargent pour le hors ligne :
# garder une zone de la taille d'une ville (quelques dizaines de Mo au plus).
# Après un changement d'extrait OSM, Valhalla reconstruit son graphe au démarrage (long).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OSM_EXTRACT="${OSM_EXTRACT:-europe/france/franche-comte}"
VALHALLA_DIR=infrastructure/valhalla/custom_files

echo "==> Fond de carte (${SAFEWAY_REGION_NAME:-Besançon})"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e SAFEWAY_BBOX -e SAFEWAY_MAXZOOM -e SAFEWAY_REGION_NAME \
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
  rm -rf "$VALHALLA_DIR"/valhalla_tiles "$VALHALLA_DIR"/valhalla_tiles.tar "$VALHALLA_DIR"/admins.sqlite "$VALHALLA_DIR"/file_hashes.txt
  echo "Nouvel extrait : Valhalla reconstruira son graphe au prochain démarrage (de quelques minutes à plus d'une heure)."
  echo "Pour l'appliquer à un service déjà lancé : docker compose ... restart valhalla"
fi
