import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createOriginalShapeBodySource, ORIGINAL_SHAPE_BODY_IDS } from '../js/midi/content/OriginalShapeMeshes.js';
import { solveShapeBody } from '../js/app/resources/ShapeBodySolver.js';
import { renderShapeBodyCalibration } from '../js/app/resources/ShapeBodyCalibration.js';
import { createShapeBodyRecipe } from '../js/midi/content/ShapeBodyRecipe.js';
import { canonicalDataText } from '../js/core/CanonicalData.js';
import { compileSoundContent } from '../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { collectInstrumentArtifactProfiles } from './InstrumentArtifactClosure.js';
import { computeInstrumentArtifacts } from '../js/runtime/InstrumentArtifactManifest.js';

const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(shape|mode-count|sample-rate|seconds|output|name)=(.+)$/.exec(argument);
  if (!match || Object.hasOwn(options, match[1])) throw new Error('Expected unique --shape=, --mode-count=, --sample-rate=, --seconds=, --output= or --name= options.'); options[match[1]] = match[2];
}
if (options.name && !/^[a-z][a-z0-9-]{0,31}$/i.test(options.name)) throw new TypeError('Invalid build agent name.');
const shapes = options.shape && options.shape !== 'all' ? [options.shape] : ORIGINAL_SHAPE_BODY_IDS, counts = options['mode-count'] && options['mode-count'] !== 'all' ? [Number(options['mode-count'])] : [8, 16, 32], sampleRate = Number(options['sample-rate'] || 48000), seconds = Number(options.seconds || 2);
if (shapes.some(id => !ORIGINAL_SHAPE_BODY_IDS.includes(id)) || counts.some(count => ![8, 16, 32].includes(count)) || ![44100, 48000, 96000].includes(sampleRate) || !Number.isFinite(seconds) || seconds < 0.1 || seconds > 4) throw new TypeError('Unknown original shape, explicit tier, sample rate or calibration duration.');
const inside = (parent, target) => { const relative = path.relative(parent, target); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const output = path.resolve(root, options.output || 'dist/shape-foundry'); if (!inside(path.join(root, 'dist'), output)) throw new Error('Shape foundry output must be inside the repository dist directory.');
await fs.mkdir(output, { recursive: true }); const outputReal = await fs.realpath(output), rootReal = await fs.realpath(root); if (!inside(path.join(rootReal, 'dist'), outputReal)) throw new Error('Shape output ancestor escapes the repository.');
const lock = await fs.open(path.join(outputReal, '.publication.lock'), 'wx'), stage = path.join(outputReal, '.build-' + randomUUID());
const controller = new AbortController(), abort = () => controller.abort(new Error('Shape foundry canceled.')); process.once('SIGINT', abort); process.once('SIGTERM', abort);
const cleanup = async () => { if (path.dirname(stage) !== outputReal || !path.basename(stage).startsWith('.build-')) throw new Error('Invalid foundry stage cleanup target.'); await fs.rm(stage, { recursive: true, force: true }); };
try {
  await fs.mkdir(stage);
  await lock.writeFile(JSON.stringify({ pid: process.pid, agent: options.name || null }) + '\n');
  const solverFiles = ['js/app/resources/ShapeBodySolver.js', 'js/midi/content/ShapeBodyAsset.js', 'js/core/CanonicalData.js'], solverDigest = createHash('sha256');
  for (const file of solverFiles) solverDigest.update(file).update('\0').update(await fs.readFile(path.join(root, file))).update('\0'); const solverBuildHash = solverDigest.digest('hex');
  const closure = await collectInstrumentArtifactProfiles({ rootDir: root }), artifacts = await computeInstrumentArtifacts(closure.files, closure.profiles), targets = (await describeNativeInstrumentEngines(artifacts)).map(descriptor => ({ descriptor })), packs = [], unavailable = [];
  for (const id of shapes) {
    controller.signal.throwIfAborted(); const source = createOriginalShapeBodySource(id), asset = await solveShapeBody({ source, solverBuildHash }, { signal: controller.signal });
    for (const modeCount of counts) {
      controller.signal.throwIfAborted(); let calibration;
      try { calibration = await renderShapeBodyCalibration({ asset, modeCount, sampleRate, seconds }, { signal: controller.signal }); }
      catch (error) { if (error.code === 'invalid-shape-body' && error.message.includes('enough supported audible modes')) { unavailable.push({ id, modeCount, sampleRate, reason: error.message }); continue; } throw error; }
      const recipe = await createShapeBodyRecipe({ asset, calibration }), content = await compileSoundContent(recipe.source, { targets }), folder = path.join(stage, content.prepared.contentHash); await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, 'pack.json'), canonicalDataText(content.prepared.pack, { maxBytes: 4 * 1048576 }).text + '\n');
      await fs.writeFile(path.join(folder, 'recipe.json'), canonicalDataText(recipe.source, { maxBytes: 4 * 1048576 }).text + '\n'); await fs.writeFile(path.join(folder, 'receipt.json'), canonicalDataText(recipe.receipt).text + '\n');
      await fs.mkdir(path.join(folder, 'assets'));
      for (const entry of recipe.contents) { controller.signal.throwIfAborted(); if (createHash('sha256').update(entry.bytes).digest('hex') !== entry.sha256) throw new Error('Generated foundry material hash changed.'); await fs.writeFile(path.join(folder, 'assets', entry.sha256), entry.bytes); }
      packs.push({ id, modeCount, sampleRate, contentHash: content.prepared.contentHash, assetHash: asset.assetHash, path: content.prepared.contentHash + '/pack.json', qualification: recipe.receipt.qualification });
    }
  }
  if (!packs.length) throw new Error('The requested geometry tiers produced no supported playable pack; the previous publication remains intact.');
  const catalog = { schema: 'lemmings-shape-foundry-catalog/v1', solverBuildHash, packs, unavailable, qualification: 'experimental-algebraic-calibration;mesh-refinement-listening-and-runtime-device-qualification-pending' }, text = canonicalDataText(catalog).text + '\n', catalogHash = createHash('sha256').update(text).digest('hex'), destination = path.join(outputReal, catalogHash);
  await fs.writeFile(path.join(stage, 'catalog.json'), text); controller.signal.throwIfAborted();
  try { await fs.rename(stage, destination); }
  catch (error) {
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
    if (path.dirname(await fs.realpath(destination)) !== outputReal || await fs.readFile(path.join(destination, 'catalog.json'), 'utf8') !== text) throw new Error('An immutable foundry catalog has conflicting identity.');
    for (const pack of packs) for (const name of ['pack.json', 'recipe.json', 'receipt.json', ...await fs.readdir(path.join(stage, pack.contentHash, 'assets')).then(files => files.map(file => 'assets/' + file))]) {
      const published = await fs.realpath(path.join(destination, pack.contentHash, name)); if (!inside(destination, published) || !(await fs.readFile(published)).equals(await fs.readFile(path.join(stage, pack.contentHash, name)))) throw new Error('Immutable foundry content differs from this exact rebuild.');
    }
    await cleanup();
  }
  const temporary = path.join(outputReal, '.head-' + randomUUID() + '.json');
  try { controller.signal.throwIfAborted(); await fs.writeFile(temporary, canonicalDataText({ schema: 'lemmings-shape-foundry-head/v1', catalogHash, path: catalogHash + '/catalog.json' }).text + '\n'); await fs.rename(temporary, path.join(outputReal, 'current.json')); }
  finally { await fs.rm(temporary, { force: true }); }
  console.log(JSON.stringify({ agent: options.name || null, catalogHash, packs: packs.length, unavailable, output: destination, qualification: catalog.qualification }));
} finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); await cleanup(); await lock.close(); await fs.rm(path.join(outputReal, '.publication.lock')); }
