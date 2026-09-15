// Copy MapLibre's worker bundle into public/ so the browser can load it.
//
// MapLibre derives its own worker URL from `import.meta.url`:
//
//   if (!/^https?:/.test(url)) return '';
//   new URL('./maplibre-gl-worker.mjs', url).href
//
// Webpack rewrites `import.meta.url` when it bundles, so the test fails, the
// URL comes back empty and the worker is never created. No error is raised —
// the map mounts, reports a loaded style, and then quietly never requests a
// single tile, which renders as a blank world.
//
// Serving the worker from our own origin and pointing setWorkerUrl at it side-
// steps the whole problem. The worker imports './maplibre-gl-shared.mjs' by
// relative path, so both files are copied and must stay side by side.
//
// Generated at build time rather than committed, so the files can never drift
// from the installed maplibre-gl version.

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'maplibre-gl', 'dist');
const to = join(root, 'public', 'maplibre');

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

await mkdir(to, { recursive: true });
for (const file of FILES) {
  await copyFile(join(from, file), join(to, file));
}

const { version } = JSON.parse(
  await readFile(join(root, 'node_modules', 'maplibre-gl', 'package.json'), 'utf8')
);
console.log(`maplibre worker ${version} -> public/maplibre/ (${FILES.join(', ')})`);
