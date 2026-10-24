import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalDataText } from '../js/core/CanonicalData.js';
import { compileSoundContent, reviewSoundContentChanges } from '../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { collectInstrumentArtifactProfiles } from './InstrumentArtifactClosure.js';
import { computeInstrumentArtifacts } from '../js/runtime/InstrumentArtifactManifest.js';
import { getProceduralSoundMaterial } from '../js/midi/content/ProceduralSoundMaterial.js';
import { generateProceduralSoundSource } from '../js/midi/content/ProceduralSoundSources.js';
import { extendSoundIdentityLedger, loadSoundIdentityLedger } from './SoundContentIdentityLedger.js';

const root = fileURLToPath(new URL('../', import.meta.url)), args = process.argv.slice(2), options = {};
for (const argument of args) {
  const match = /^--(input|output|name)=(.+)$/.exec(argument);
  if (!match || Object.hasOwn(options, match[1])) throw new Error('Expected unique --input=, --output= or --name= options.');
  options[match[1]] = match[2];
}
if (options.name && !/^[a-z][a-z0-9-]{0,31}$/i.test(options.name)) throw new Error('Invalid build agent name.');
const inside = (parent, target) => { const relative = path.relative(parent, target); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const input = path.resolve(root, options.input || 'content/sounds'), output = path.resolve(root, options.output || 'dist/sound-content');
if (!inside(root, input) || !inside(path.join(root, 'dist'), output)) throw new Error('Sound input must be in the repository and output inside its dist directory.');
const inputReal = await fs.realpath(input); if (!inside(await fs.realpath(root), inputReal)) throw new Error('Sound source directory escapes the repository.');
const closure = await collectInstrumentArtifactProfiles({ rootDir: root }), artifacts = await computeInstrumentArtifacts(closure.files, closure.profiles);
const descriptors = await describeNativeInstrumentEngines(artifacts), targets = descriptors.map(descriptor => ({ descriptor }));
const files = (await fs.readdir(input, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort();
if (!files.length || files.length > 256) throw new Error('Sound authoring needs 1–256 bounded JSON recipe files.');
let sourceBytes = 0; const compiled = [], identities = new Set();
for (const file of files) {
  const sourcePath = path.join(input, file), real = await fs.realpath(sourcePath), stat = await fs.stat(real);
  if (!inside(inputReal, real) || !stat.isFile() || stat.size > 8 * 1048576 || (sourceBytes += stat.size) > 32 * 1048576) throw new Error(file + ': source file inventory exceeds its bounds.');
  let content;
  try { content = await compileSoundContent(JSON.parse(await fs.readFile(real, 'utf8')), { targets }); }
  catch (error) { throw new Error(file + ': ' + error.message, { cause: error }); }
  const identity = content.prepared.pack.id + '@' + content.prepared.pack.version;
  if (identities.has(identity)) throw new Error(file + ': duplicate immutable pack identity.'); identities.add(identity);
  compiled.push({ file, content });
}
const patches = new Map();
for (const { content } of compiled) for (const patch of content.prepared.pack.patches) {
  const id = patch.definition.id + '@' + patch.definition.revision, bytes = canonicalDataText(patch).text;
  if (patches.has(id) && patches.get(id) !== bytes) throw new Error('Immutable patch revision conflicts across authored packs: ' + id); patches.set(id, bytes);
}
await fs.mkdir(path.dirname(output), { recursive: true });
if (!inside(await fs.realpath(root), await fs.realpath(path.dirname(output)))) throw new Error('Sound output ancestor escapes the repository.');
await fs.mkdir(output, { recursive: true }); const outputReal = await fs.realpath(output);
if (!inside(await fs.realpath(path.join(root, 'dist')), outputReal)) throw new Error('Sound output directory escapes dist.');
const publicationLockPath = path.join(outputReal, '.publication.lock');
let publicationLock;
try { publicationLock = await fs.open(publicationLockPath, 'wx'); }
catch (error) { if (error.code === 'EEXIST') throw new Error('Another sound publication owns this output. A crashed publication lock requires explicit recovery.', { cause: error }); throw error; }
try {
  await publicationLock.writeFile(JSON.stringify({ pid: process.pid, agent: options.name || null }) + '\n');
  let priorMetadataBytes = 0;
  const readPublished = async (relative, expectedHash = null) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid published sound path.');
    const filename = await fs.realpath(path.join(outputReal, relative));
    if (!inside(outputReal, filename)) throw new Error('Published sound data escapes its catalog directory.');
    const stat = await fs.stat(filename); if (!stat.isFile() || stat.size > 4 * 1048576 || (priorMetadataBytes += stat.size) > 128 * 1048576) throw new Error('Published sound metadata exceeds its bounds.');
    const data = await fs.readFile(filename, 'utf8'); if (Buffer.byteLength(data) !== stat.size || Buffer.byteLength(data) > 4 * 1048576) throw new Error('Published sound metadata changed beyond its byte bound.');
    if (expectedHash && createHash('sha256').update(data).digest('hex') !== expectedHash) throw new Error('Published sound catalog hash changed.');
    return JSON.parse(data);
  };
  const previousPacks = new Map(), previousContents = [];
  let head = null;
  try { head = await readPublished('current.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (head) {
    if (head.schema !== 'lemmings-sound-catalog-head/v1' || !/^[a-f0-9]{64}$/.test(head.catalogHash) || head.path !== head.catalogHash + '/catalog.json') throw new Error('Invalid prior sound catalog head.');
    const previous = await readPublished(head.path, head.catalogHash);
    if (previous.schema !== 'lemmings-sound-catalog/v1' || !Array.isArray(previous.packs) || previous.packs.length > 256) throw new Error('Invalid prior sound catalog inventory.');
    for (const pack of previous.packs) {
      if (!/^[a-f0-9]{64}$/.test(pack.contentHash)) throw new Error('Invalid prior sound pack reference.');
      if (pack.manifest !== pack.contentHash + '/pack.json') throw new Error('Invalid prior sound manifest path.');
      const manifest = await readPublished(head.catalogHash + '/' + pack.manifest);
      if (manifest.id !== pack.id || manifest.version !== pack.version) throw new Error('Published sound manifest identity changed.');
      previousContents.push({ pack: manifest, contentHash: pack.contentHash });
      previousPacks.set(pack.id, await readPublished(head.catalogHash + '/' + pack.contentHash + '/artifacts.json'));
    }
  }
  const previousIdentities = extendSoundIdentityLedger(await loadSoundIdentityLedger({ outputDir: outputReal, head }), previousContents);
  const identityPublication = extendSoundIdentityLedger(previousIdentities.ledger,
    compiled.map(({ content }) => ({ pack: content.prepared.pack, contentHash: content.prepared.contentHash })));
  const inventory = compiled.map(({ file, content }) => ({ source: file, id: content.prepared.pack.id, version: content.prepared.pack.version,
    contentHash: content.prepared.contentHash, sourceHash: content.sourceHash, compilerRevision: content.compilerRevision,
    manifest: content.prepared.contentHash + '/pack.json', qualification: content.qualification }));
  const catalogText = canonicalDataText({ schema: 'lemmings-sound-catalog/v1', packs: inventory, qualification: 'compiled-data-not-render-qualified' }, { maxBytes: 4 * 1048576 }).text + '\n';
  const catalogHash = createHash('sha256').update(catalogText).digest('hex');
  const stage = await fs.mkdtemp(path.join(outputReal, '.staging-'));
  const cleanup = async () => {
    const resolved = path.resolve(stage);
    if (path.dirname(resolved) !== outputReal || !path.basename(resolved).startsWith('.staging-')) throw new Error('Unexpected sound build cleanup target.');
    await fs.rm(resolved, { recursive: true, force: true });
  };
  const reviews = []; let stagedMaterialBytes = 0, stagedMetadataBytes = 0;
  try {
    for (const { content } of compiled) {
      const folder = path.join(stage, content.prepared.contentHash); await fs.mkdir(folder);
      const packText = canonicalDataText(content.prepared.pack, { maxBytes: 4 * 1048576 }).text + '\n';
      const artifactText = canonicalDataText({ artifacts: content.artifacts, qualification: content.qualification }, { maxBytes: 4 * 1048576 }).text + '\n';
      stagedMetadataBytes += Buffer.byteLength(packText) + Buffer.byteLength(artifactText);
      if (stagedMetadataBytes > 64 * 1048576) throw new Error('Compiled sound metadata exceeds the catalog byte budget.');
      await fs.writeFile(path.join(folder, 'pack.json'), packText); await fs.writeFile(path.join(folder, 'artifacts.json'), artifactText);
      for (const file of content.prepared.pack.files) {
        const original = getProceduralSoundMaterial(file); let bytes;
        if (original) bytes = generateProceduralSoundSource(original);
        else {
          const source = await fs.realpath(path.resolve(input, 'assets', file.path));
          if (!inside(path.join(inputReal, 'assets'), source)) throw new Error('Sound material escapes the authoring asset directory.');
          const stat = await fs.stat(source); if (!stat.isFile() || stat.size !== file.bytes) throw new Error('Sound material byte inventory changed: ' + file.path);
          bytes = await fs.readFile(source);
        }
        stagedMaterialBytes += file.bytes; if (stagedMaterialBytes > 256 * 1048576) throw new Error('Compiled sound material exceeds the catalog byte budget.');
        if (bytes.byteLength !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Sound material content hash changed: ' + file.path);
        const destination = path.join(folder, 'assets', file.sha256); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes);
      }
      reviews.push({ contentHash: content.prepared.contentHash, changes: reviewSoundContentChanges(previousPacks.get(content.prepared.pack.id), content) });
    }
    await fs.writeFile(path.join(stage, 'catalog.json'), catalogText);
    const destination = path.join(outputReal, catalogHash);
    try { await fs.rename(stage, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      const resolved = await fs.realpath(destination);
      if (path.dirname(resolved) !== outputReal || path.basename(resolved) !== catalogHash) throw new Error('Existing sound catalog escapes its immutable output path.');
      if (await fs.readFile(path.join(destination, 'catalog.json'), 'utf8') !== catalogText) throw new Error('An immutable sound catalog has conflicting bytes.');
      for (const { content } of compiled) {
        const manifest = path.join(destination, content.prepared.contentHash, 'pack.json');
        if (await fs.readFile(manifest, 'utf8') !== canonicalDataText(content.prepared.pack, { maxBytes: 4 * 1048576 }).text + '\n') throw new Error('An immutable sound manifest has changed bytes.');
        if (await fs.readFile(path.join(destination, content.prepared.contentHash, 'artifacts.json'), 'utf8') !== canonicalDataText({ artifacts: content.artifacts, qualification: content.qualification }, { maxBytes: 4 * 1048576 }).text + '\n')
          throw new Error('An immutable sound explanation artifact has changed bytes.');
        for (const file of content.prepared.pack.files) if (createHash('sha256').update(await fs.readFile(path.join(destination, content.prepared.contentHash, 'assets', file.sha256))).digest('hex') !== file.sha256)
          throw new Error('Immutable sound material has changed bytes.');
      }
      await cleanup();
    }
    const identityPath = identityPublication.identityHash + '.identities.json', identityFile = path.join(outputReal, identityPath);
    try { await fs.writeFile(identityFile, identityPublication.text, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (path.dirname(await fs.realpath(identityFile)) !== outputReal) throw new Error('Immutable sound identity history escapes its output directory.');
      if (await fs.readFile(identityFile, 'utf8') !== identityPublication.text) throw new Error('Immutable sound identity history has changed bytes.');
    }
    const temporary = path.join(outputReal, '.publish-' + catalogHash + '.json');
    try { await fs.writeFile(temporary, canonicalDataText({ schema: 'lemmings-sound-catalog-head/v1', catalogHash, path: catalogHash + '/catalog.json',
      identityHash: identityPublication.identityHash, identityPath }).text + '\n'); await fs.rename(temporary, path.join(outputReal, 'current.json')); }
    finally { await fs.rm(temporary, { force: true }); }
    console.log(JSON.stringify({ agent: options.name || null, catalogHash, packs: inventory.length, patches: patches.size, output: destination,
      qualification: 'compiled-data-not-render-qualified', review: reviews }));
  } finally { await cleanup(); }
} finally { await publicationLock.close(); await fs.rm(publicationLockPath); }
