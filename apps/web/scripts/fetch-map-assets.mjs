#!/usr/bin/env node
/**
 * Récupère les assets cartographiques auto-hébergés (choix privacy, cf. docs/architecture.md) :
 *   - extrait PMTiles d'une zone (par défaut Besançon) depuis le build Protomaps du jour ;
 *   - polices (glyphes) et sprites du style Protomaps.
 *
 * Sources officielles uniquement : build.protomaps.com, github.com/protomaps.
 * Usage : npm run fetch-map-assets -w @safeway/web
 *   SAFEWAY_BBOX="minLon,minLat,maxLon,maxLat"  zone à extraire (défaut Besançon)
 *   SAFEWAY_MAXZOOM=14                           zoom maximum (celui attendu par le style, MAP_MAX_ZOOM)
 *   SAFEWAY_REGION_NAME="Besançon"               nom affiché pour le téléchargement hors ligne
 *   SAFEWAY_REGIONS=france                       une carte par région de France métropolitaine
 *                                                (≈ 4,7 Go au total), au lieu d'une seule zone
 *   SAFEWAY_REFRESH=1                            ré-extraire les régions déjà présentes
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(WEB, 'public');
const TOOLS = join(WEB, '..', '..', '.tools');
const BBOX = process.env.SAFEWAY_BBOX ?? '5.930,47.195,6.100,47.290';
const MAXZOOM = process.env.SAFEWAY_MAXZOOM ?? '14';
const REGIONS = process.env.SAFEWAY_REGIONS;
// Contours des régions : IGN Admin Express (Licence Ouverte), version simplifiée, commit figé.
const OUTLINES_URL =
  'https://raw.githubusercontent.com/gregoiredavid/france-geojson/5d34ee6d0140c29f785fdb047d9329f1aab58833/regions-version-simplifiee.geojson';
// Marge autour de chaque région (degrés) : les tuiles des frontières sont dans les deux fichiers.
const MARGIN = 0.05;
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const SPRITES = ['grayscale', 'black'];
const ASSETS_RAW = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main';

const log = (msg) => process.stdout.write(msg + '\n');

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function pmtilesCli() {
  const exe = join(TOOLS, platform() === 'win32' ? 'pmtiles.exe' : 'pmtiles');
  if (existsSync(exe)) return exe;
  const os = { win32: 'Windows', darwin: 'Darwin', linux: 'Linux' }[platform()];
  const cpu = { x64: 'x86_64', arm64: 'arm64' }[arch()];
  if (!os || !cpu) throw new Error(`plateforme non supportée : ${platform()}/${arch()}`);

  log('→ recherche de la dernière version de go-pmtiles');
  const release = await (await fetch('https://api.github.com/repos/protomaps/go-pmtiles/releases/latest')).json();
  const asset = release.assets.find((a) => a.name.includes(`_${os}_${cpu}`));
  if (!asset) throw new Error(`binaire go-pmtiles introuvable pour ${os}_${cpu}`);
  const archive = join(TOOLS, asset.name);
  if (!existsSync(archive)) {
    log(`→ téléchargement ${asset.name} (${(asset.size / 1e6).toFixed(1)} Mo)`);
    await download(asset.browser_download_url, archive);
  }
  // bsdtar extrait .zip et .tar.gz. Sous Windows on force celui du système : le GNU tar
  // de Git Bash prendrait « C: » pour un hôte distant.
  const tar = platform() === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', TOOLS]);
  await rm(archive);
  if (!existsSync(exe)) throw new Error('extraction de go-pmtiles échouée');
  return exe;
}

async function latestBuild() {
  const builds = await (await fetch('https://build-metadata.protomaps.dev/builds.json')).json();
  return builds.map((b) => b.key).sort().at(-1);
}

async function extract(build, dest, bbox) {
  await mkdir(dirname(dest), { recursive: true });
  const cli = await pmtilesCli();
  // Écrit dans un fichier temporaire : un extrait interrompu ne doit jamais être servi.
  execFileSync(cli, ['extract', `https://build.protomaps.com/${build}`, `${dest}.part`, `--bbox=${bbox}`, `--maxzoom=${MAXZOOM}`], {
    stdio: 'inherit',
  });
  await rename(`${dest}.part`, dest);
}

async function tiles() {
  const build = await latestBuild();
  log(`→ extrait ${BBOX} (zoom ≤ ${MAXZOOM}) depuis le build ${build}`);
  await extract(build, join(PUBLIC, 'tiles', 'basemap.pmtiles'), BBOX);
}

const round = (value) => Math.round(value * 1000) / 1000;

/** Une carte par région de France métropolitaine, avec son contour (pour trouver sa région sur l'appareil). */
async function regionalTiles() {
  const outlines = await (await fetch(OUTLINES_URL)).json();
  const build = await latestBuild();
  const regions = [];
  for (const feature of outlines.features) {
    const { code, nom } = feature.properties;
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const outline = polygons.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [round(lng), round(lat)])));
    const points = outline.flat(2);
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const bbox = [Math.min(...lngs) - MARGIN, Math.min(...lats) - MARGIN, Math.max(...lngs) + MARGIN, Math.max(...lats) + MARGIN].map(round);
    const file = join(PUBLIC, 'tiles', 'regions', `${code}.pmtiles`);
    if (process.env.SAFEWAY_REFRESH || !existsSync(file)) {
      log(`→ ${nom} (zoom ≤ ${MAXZOOM}) depuis le build ${build}`);
      await extract(build, file, bbox.join(','));
    }
    const { size } = await stat(file);
    regions.push({ id: `fr-${code}`, name: nom, url: `/tiles/regions/${code}.pmtiles`, bytes: size, bbox, outline });
  }
  regions.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  await writeFile(join(PUBLIC, 'tiles', 'regions.json'), JSON.stringify(regions) + '\n');
  const total = regions.reduce((sum, r) => sum + r.bytes, 0);
  log(`→ regions.json : ${regions.length} régions, ${(total / 1e9).toFixed(1)} Go`);
}

async function fonts() {
  for (const font of FONTS) {
    const dir = join(PUBLIC, 'fonts', font);
    if (existsSync(dir) && (await readdir(dir)).length >= 256) continue;
    log(`→ glyphes ${font}`);
    const ranges = Array.from({ length: 256 }, (_, i) => `${i * 256}-${i * 256 + 255}`);
    for (let i = 0; i < ranges.length; i += 16) {
      await Promise.all(
        ranges.slice(i, i + 16).map((r) => download(`${ASSETS_RAW}/fonts/${encodeURIComponent(font)}/${r}.pbf`, join(dir, `${r}.pbf`))),
      );
    }
  }
}

async function sprites() {
  log('→ sprites');
  for (const name of SPRITES) {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
      await download(`${ASSETS_RAW}/sprites/v4/${name}${suffix}`, join(PUBLIC, 'sprites', 'v4', `${name}${suffix}`));
    }
  }
}

/** Liste des régions proposées au téléchargement hors ligne dans l'app. */
async function regionsManifest() {
  const file = join(PUBLIC, 'tiles', 'basemap.pmtiles');
  const { size } = await stat(file);
  const bbox = BBOX.split(',').map(Number);
  const regions = [{ id: 'default', name: process.env.SAFEWAY_REGION_NAME ?? 'Besançon', url: '/tiles/basemap.pmtiles', bytes: size, bbox }];
  await writeFile(join(PUBLIC, 'tiles', 'regions.json'), JSON.stringify(regions, null, 2) + '\n');
  log(`→ regions.json (${(size / 1e6).toFixed(1)} Mo)`);
}

await sprites();
await fonts();
if (REGIONS === 'france') {
  await regionalTiles();
} else {
  await tiles();
  await regionsManifest();
}
log('✓ assets cartographiques prêts dans apps/web/public/');
