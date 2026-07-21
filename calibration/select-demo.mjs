#!/usr/bin/env node

/** Reproducibly select a strong, coastal-crossing ambient demo after physics changes. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maximumSeed = Math.max(1, Number(process.argv[2] ?? 2000));
const vite = await createServer({
  root: ROOT,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [{ parseBin }, { makeEnvSampler, synopticCount }, { sampleLayerBilinear }, { createSimEngine }] =
  await Promise.all([
    vite.ssrLoadModule('/src/loader.ts'),
    vite.ssrLoadModule('/src/env-sampler.ts'),
    vite.ssrLoadModule('/src/raster-sampler.ts'),
    vite.ssrLoadModule('/src/sim.ts'),
  ]);

function parse(bytes) {
  return parseBin(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const [environmentBytes, terrainBytes] = await Promise.all([
  readFile(resolve(ROOT, 'public/data/env.bin')),
  readFile(resolve(ROOT, 'public/data/terrain.bin')),
]);
const environment = parse(environmentBytes);
const terrain = parse(terrainBytes);
const land = terrain.layers.get('landmask');
if (!land) throw new Error('terrain missing landmask');
const isLand = (lat, lon) => sampleLayerBilinear(land, 0, lat, lon) > 0.5;
const sampler = makeEnvSampler(() => environment);
const monthIndex = 4;
const results = [];
for (let seed = 0; seed <= maximumSeed; seed += 1) {
  sampler.setSamplingMode({
    kind: 'synoptic-plane',
    plane: seed % synopticCount(environment, monthIndex),
  });
  const engine = createSimEngine({ env: sampler, isLand, structureDetail: 'dynamics' });
  engine.spawn({ lat: 17.5, lon: 61, monthIndex, seed, isDemo: true });
  let peakKt = 0;
  let landfall = false;
  let ticks = 0;
  for (; ticks < 4000; ticks += 1) {
    const events = engine.tick(15);
    const state = engine.getState();
    if (!state) break;
    peakKt = Math.max(peakKt, state.vKt);
    if (events.some((event) => event.type === 'landfall')) landfall = true;
    if (!state.alive) break;
  }
  const final = engine.getState();
  if (
    final &&
    landfall &&
    isLand(final.lat, final.lon) &&
    final.lon > 52.5 &&
    final.lon < 60 &&
    final.lat > 16.5 &&
    final.lat < 26.5 &&
    ticks * 0.25 > 96
  ) {
    results.push({ seed, peakKt, lifetimeH: ticks * 0.25, lat: final.lat, lon: final.lon });
  }
}
results.sort((left, right) => right.peakKt - left.peakKt || left.seed - right.seed);
process.stdout.write(`${JSON.stringify(results.slice(0, 20), null, 2)}\n`);
await vite.close();
