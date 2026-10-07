#!/usr/bin/env node
// Compare checked-out sources with --source=/path/to/checkout; run with --expose-gc.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(option('source') || '.');
const load = file => import(pathToFileURL(path.join(root, file)).href);
const { CharacterSpriteSet } = await load('js/lemmings/CharacterSpriteSet.js');
const { PixelSpriteSkin } = await load('js/lemmings/PixelSpriteSkin.js');
const { SpriteTypes } = await load('js/lemmings/SpriteTypes.js');
const { Frame } = await load('js/render/Frame.js');
const read = file => fs.readFile(path.join(root, file), 'utf8');
const catalog = JSON.parse(await read('assets/characters/catalog.json'));
const manifest = JSON.parse(await read('assets/hydro/hydro-skin.json'));
const turn = () => new Promise(resolve => setImmediate(resolve));
const collect = async () => {
  for (let pass = 0; pass < 4; pass++) { await turn(); global.gc?.(); }
  await turn();
  return process.memoryUsage();
};
const setup = async (randomColors = true) => {
  let preference = { shape: 'mixed', seed: 42, bodyColor: randomColors ? 'random' : '#4778ff',
    propColor: randomColors ? 'random' : '#ff8066', eyewearColor: randomColors ? 'random' : '#1f1f1f',
    accessory: 'crown', eyewear: 'classic_sunglasses' };
  const sprites = new CharacterSpriteSet(new PixelSpriteSkin(manifest), catalog, read, () => preference);
  if (!await sprites.prepare()) throw new Error(sprites.error);
  return { sprites, update: next => { preference = { ...preference, ...next }; } };
};

async function crowd(randomColors) {
  const { sprites, update } = await setup(randomColors);
  const before = await collect();
  let actors = Array.from({ length: 16384 }, (_, id) => ({ id, appearanceIndex: id % 1024, frameIndex: id % 8 }));
  const appearances = new Set(actors.map(actor => JSON.stringify(sprites.appearanceForActor(actor))));
  let skins = new Set(), constructions = 0, remappedFrames = 0;
  const withPalette = PixelSpriteSkin.prototype.withPalette, spans = Frame.prototype.getSpanCache;
  PixelSpriteSkin.prototype.withPalette = function(...args) { constructions++; return withPalette.apply(this, args); };
  Frame.prototype.getSpanCache = function() { remappedFrames++; return spans.call(this); };
  let elapsedMs;
  try {
    const start = performance.now();
    for (const actor of actors) {
      const skin = sprites.skinForActor(actor);
      skin.getAnimation(SpriteTypes.WALKING, true).getFrame(actor.frameIndex);
      skins.add(skin);
    }
    elapsedMs = performance.now() - start;
  } finally {
    PixelSpriteSkin.prototype.withPalette = withPalette;
    Frame.prototype.getSpanCache = spans;
  }
  const retained = await collect();
  const result = { randomColors, actors: actors.length, appearanceKeys: appearances.size, liveSkins: skins.size,
    strongPaletteEntries: sprites.paletteSkins.size, paletteConstructions: constructions, remappedFrames,
    coldLookupMs: elapsedMs, retainedHeapBytes: retained.heapUsed - before.heapUsed,
    retainedArrayBufferBytes: retained.arrayBuffers - before.arrayBuffers };
  let checksum = 0;
  const start = performance.now();
  for (let repeat = 0; repeat < 20; repeat++) for (const actor of actors) {
    checksum += sprites.skinForActor(actor).getAnimation(SpriteTypes.WALKING, true).getFrame(actor.frameIndex).width;
  }
  result.warmLookupMs = performance.now() - start;
  result.warmLookups = actors.length * 20;
  result.checksum = checksum;
  skins = null; actors = null;
  const released = await collect();
  result.heapAfterActorsReleasedBytes = released.heapUsed - before.heapUsed;
  result.buffersAfterActorsReleasedBytes = released.arrayBuffers - before.arrayBuffers;
  update({ shape: 'classic' }); await sprites.prepare();
  const inactive = await collect();
  result.heapAfterClassicPreferenceBytes = inactive.heapUsed - before.heapUsed;
  result.buffersAfterClassicPreferenceBytes = inactive.arrayBuffers - before.arrayBuffers;
  result.strongPaletteEntriesAfterClassic = sprites.paletteSkins.size;
  return result;
}

async function lifecycle() {
  const { sprites, update } = await setup();
  let actors = Array.from({ length: 1024 }, (_, id) => ({ id, appearanceIndex: id }));
  let skins = actors.map(actor => sprites.skinForActor(actor));
  const references = [...new Set(skins)].map(skin => new WeakRef(skin));
  const templates = sprites.activeTemplates.map(template => new WeakRef(template));
  const identityCount = () => templates.reduce((count, reference) =>
    count + (sprites.paletteIdentities?.get(reference.deref())?.size || 0), 0);
  skins = null;
  await collect();
  const withActors = references.filter(reference => reference.deref()).length;
  actors = null;
  await collect();
  const afterActors = references.filter(reference => reference.deref()).length;
  const weakEntriesAfterActors = identityCount();
  update({ shape: 'classic' }); await sprites.prepare();
  await collect();
  const afterClassic = references.filter(reference => reference.deref()).length;
  const weakEntriesAfterClassic = identityCount();
  const cycles = [];
  for (let index = 0; index < 6; index++) {
    update({ shape: 'mixed', accessory: ['crown', 'hat', 'beanie'][index % 3], seed: index });
    await sprites.prepare();
    let history = Array.from({ length: 1024 }, (_, id) => ({ id, appearanceIndex: id }));
    let live = history.map(actor => sprites.skinForActor(actor));
    const refs = [...new Set(live)].map(skin => new WeakRef(skin));
    history = null; live = null;
    update({ shape: 'classic' }); await sprites.prepare();
    const memory = await collect();
    cycles.push({ cycle: index, retainedPaletteSkins: refs.filter(reference => reference.deref()).length,
      strongTemplates: sprites.skins.size, strongPalettes: sprites.paletteSkins.size,
      weakTemplateEntries: sprites.skinIdentities?.size,
      heapBytes: memory.heapUsed, arrayBufferBytes: memory.arrayBuffers });
  }
  return { withActors, afterActors, afterClassic, weakEntriesAfterActors, weakEntriesAfterClassic, cycles,
    passed: withActors === 396 && afterActors <= 256 && afterClassic === 0 &&
      weakEntriesAfterActors <= 256 && weakEntriesAfterClassic === 0 &&
      cycles.every(cycle => cycle.retainedPaletteSkins === 0 && cycle.strongTemplates <= 32 && cycle.strongPalettes === 0 && (cycle.weakTemplateEntries ?? 0) <= 32) };
}

const lifecycleOnly = process.argv.includes('--lifecycle-only');
const results = { source: root, node: process.version, forcedGc: !!global.gc,
  scope: 'Node-only retained-memory, construction and lookup study; no native browser rendering or allocation-rate claim.' };
if (!lifecycleOnly) results.crowds = [await crowd(false), await crowd(true)];
results.lifecycle = await lifecycle();
const output = JSON.stringify(results, null, 2);
if (option('output')) await fs.writeFile(option('output'), `${output}\n`);
console.log(output);
if (lifecycleOnly && !results.lifecycle.passed) process.exitCode = 1;
