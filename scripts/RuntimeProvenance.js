import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const fail = message => { throw new Error(`Runtime provenance: ${message}`); };
const validPath = value => typeof value === 'string' && value.length > 0 && value.length <= 512 &&
  /^[A-Za-z0-9_./@-]+$/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
const before = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const firstPartyRepository = 'https://github.com/doublemover/LemmingsJS-MIDI';
const sharedArtifact = component => component.inventoryScope === 'first-party-artifact' && component.classification === 'source' && component.upstream === firstPartyRepository;
export function findRuntimeWorkerSources(files, read) {
  const workerSources = [];
  for (const file of files.filter(file => file.startsWith('js/') && !file.startsWith('js/vendor/') && /\.[cm]?js$/.test(file)).sort(before)) {
    const source = ts.createSourceFile(file, read(file).toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); let worker = false;
    const visit = node => {
      if (ts.isNewExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === 'Worker' ||
          ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'Worker')) worker = true;
      ts.forEachChild(node, visit);
    };
    visit(source); if (worker) workerSources.push(file);
  }
  return workerSources;
}

export function verifyRuntimeProvenance({ rootDir, sourceInventory = null } = {}) {
  const root = realpathSync(path.resolve(rootDir)), hashes = new Map(), covered = new Set(), inventory = new Map(sourceInventory?.map(file => [file.path, file]));
  const resolve = name => {
    if (!validPath(name)) fail(`invalid local path ${name}`);
    const filename = path.join(root, name), real = realpathSync(filename), relative = path.relative(root, real);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || lstatSync(filename).isSymbolicLink()) fail(`escaping or linked input ${name}`);
    return filename;
  };
  const exists = name => { try { lstatSync(path.join(root, name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  const filesUnder = directory => readdirSync(resolve(directory), { withFileTypes: true }).flatMap(entry => {
    const name = directory + '/' + entry.name;
    if (entry.isSymbolicLink()) fail(`linked input ${name}`);
    return entry.isDirectory() ? filesUnder(name) : entry.isFile() ? [name] : [];
  }).sort(before);
  const read = name => {
    const filename = resolve(name), stat = lstatSync(filename);
    if (!stat.isFile() || stat.size > 32 * 1048576) fail(`invalid file ${name}`);
    const bytes = readFileSync(filename), sha256 = createHash('sha256').update(bytes).digest('hex');
    const expected = inventory.get(name);
    if (expected && (expected.bytes !== bytes.byteLength || expected.sha256 !== sha256)) fail(`source changed during inventory: ${name}`);
    hashes.set(name, { path: name, bytes: bytes.byteLength, sha256 });
    return bytes;
  };
  const owners = new Map(), raw = read('provenance/runtime-artifacts.json');
  if (raw.byteLength > 2 * 1048576) fail('manifest exceeds its byte bound');
  const manifest = JSON.parse(raw), seen = new Set();
  if (manifest.version !== 1 || !Array.isArray(manifest.components) || manifest.components.length > 1024 || !manifest.selectedBackends ||
      ['browserMidi', 'nativeUmp', 'audioRuntime', 'optionalAudioBank'].some(key => typeof manifest.selectedBackends[key] !== 'string' || !manifest.selectedBackends[key]) ||
      !Array.isArray(manifest.workerSources) || manifest.workerSources.length > 1024 || new Set(manifest.workerSources).size !== manifest.workerSources.length) fail('invalid manifest schema');
  const components = manifest.components.map(component => {
    if (!component.id || seen.has(component.id) || !component.upstream || !component.license || !component.reproductionStatus ||
        !['runtime', 'precache', 'generated', 'source', 'development'].includes(component.classification)) fail(`incomplete component ${component.id}`);
    if (component.inventoryScope != null && !sharedArtifact(component)) fail('invalid shared artifact scope for ' + component.id);
    seen.add(component.id);
    const files = component.directory ? filesUnder(component.directory) : component.files;
    if (!Array.isArray(files) || !files.length || files.length > 8192 || new Set(files).size !== files.length) fail(`invalid files for ${component.id}`);
    const hash = createHash('sha256');
    for (const file of files) {
      const prior = owners.get(file);
      if (prior && (!sharedArtifact(component) || !sharedArtifact(prior))) fail(`duplicate file ${file}`);
      if (!prior) owners.set(file, component);
      covered.add(file); hash.update(file).update('\0').update(read(file)).update('\0');
    }
    if (component.fileCount !== files.length || component.sha256 !== hash.digest('hex')) fail(`hash or inventory changed for ${component.id}`);
    if (component.licenseFile) read(component.licenseFile);
    return { ...component, files };
  });
  for (const directory of ['js/vendor', 'assets/icons/lucide', 'provenance/schema']) if (exists(directory))
    for (const file of filesUnder(directory)) if (!covered.has(file)) fail(`unlisted vendored file ${file}`);
  if (exists('service-worker.js') && !covered.has('service-worker.js')) fail('unlisted service worker source');
  const workerSources = findRuntimeWorkerSources(exists('js') ? filesUnder('js') : [], read);
  for (const file of workerSources) if (!covered.has(file)) fail(`unlisted worker component ${file}`);
  if (JSON.stringify(workerSources) !== JSON.stringify([...manifest.workerSources].sort(before))) fail('worker source inventory changed');
  return { manifest, components, files: [...hashes.values()].sort((a, b) => before(a.path, b.path)) };
}
