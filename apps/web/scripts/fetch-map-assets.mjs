#!/usr/bin/env node
/**
 * Récupère les assets cartographiques auto-hébergés (choix privacy, cf. docs/architecture.md) :
 *   - extrait PMTiles d'une zone (par défaut Besançon) depuis le build Protomaps du jour ;
 *   - polices (glyphes) et sprites du style Protomaps.
 *
 * Sources officielles uniquement : build.protomaps.com, github.com/protomaps.
 * Usage : npm run fetch-map-assets -w @safeway/web
 *   SAFEWAY_BBOX="minLon,minLat,maxLon,maxLat"  zone à extraire (défaut Besançon)
 *   SAFEWAY_MAXZOOM=15                           zoom maximum
 * En production, extraire la France entière (ou plusieurs villes) et servir le fichier via CDN.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(WEB, 'public');
const TOOLS = join(WEB, '..', '..', '.tools');
const BBOX = process.env.SAFEWAY_BBOX ?? '5.930,47.195,6.100,47.290';
const MAXZOOM = process.env.SAFEWAY_MAXZOOM ?? '15';
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

async function tiles() {
  const dest = join(PUBLIC, 'tiles', 'basemap.pmtiles');
  const builds = await (await fetch('https://build-metadata.protomaps.dev/builds.json')).json();
  const latest = builds.map((b) => b.key).sort().at(-1);
  log(`→ extrait ${BBOX} (zoom ≤ ${MAXZOOM}) depuis le build ${latest}`);
  await mkdir(dirname(dest), { recursive: true });
  const cli = await pmtilesCli();
  execFileSync(cli, ['extract', `https://build.protomaps.com/${latest}`, dest, `--bbox=${BBOX}`, `--maxzoom=${MAXZOOM}`], {
    stdio: 'inherit',
  });
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

await sprites();
await fonts();
await tiles();
log('✓ assets cartographiques prêts dans apps/web/public/');
