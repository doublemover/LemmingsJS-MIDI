import { OWNED_STRETCH_CORE } from '../js/midi/content/OwnedStretchCoreIdentity.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { collectBrowserRuntimeClosure } from './BrowserRuntimeClosure.js';
import { verifyRuntimeProvenance } from './RuntimeProvenance.js';
import { collectInstrumentArtifactProfiles } from './InstrumentArtifactClosure.js';
import { BUILD_IDENTITY_PATH, BUILD_IDENTITY_SLOT, BUILD_TEMPLATE_PATH, computeBrowserBuildIdentity, renderBrowserBuildIdentity, verifyBrowserBuildManifest } from '../js/runtime/BrowserBuildManifest.js';

const IDENTITY_PATH = BUILD_IDENTITY_PATH, IDENTITY_SLOT = BUILD_IDENTITY_SLOT;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
// Keep file I/O bounded, and join every started operation before cleaning a stage.
const forEachBuildFile = async (files, visit) => {
  let next = 0, failed = false, failure;
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
    while (!failed) {
      const index = next++; if (index >= files.length) return;
      try { await visit(files[index], index); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
};
const bootstrapPage = (buildId, route) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lemmings application</title><body><main><h1>Lemmings</h1><p id="generation-status" role="status">Preparing application files…</p><noscript>JavaScript is required to open this application.</noscript></main><script type="module">import { startBrowserGenerationEntry } from './${buildId}/js/runtime/BrowserGenerationClient.js'; startBrowserGenerationEntry({route:${JSON.stringify(route)}}).catch(() => {});</script></body></html>\n`;

export async function buildBrowserRuntime({ rootDir, outputDir = null, inventory = null, fsImpl = fs } = {}) {
  const root = path.resolve(rootDir), output = path.resolve(outputDir || path.join(root, 'dist', 'browser'));
  if (!inside(path.join(root, 'dist'), output) || output === path.join(root, 'dist')) throw new Error('Browser build output must be inside this workspace dist directory.');
  const preparedCode = new Map(), coreCachePath = path.join(root, OWNED_STRETCH_CORE.cachePath), coreRuntimePath = OWNED_STRETCH_CORE.runtimePath;
  try {
    const stat = await fsImpl.lstat(coreCachePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== OWNED_STRETCH_CORE.wasmBytes || !inside(path.join(await fsImpl.realpath(root), 'dist'), await fsImpl.realpath(coreCachePath))) throw new Error('The prepared core cache is not an exact bounded workspace artifact.');
    const bytes = await fsImpl.readFile(coreCachePath); if (sha256(bytes) !== OWNED_STRETCH_CORE.wasmSha256) throw new Error('The prepared core cache differs from the pinned byte identity.'); preparedCode.set(coreRuntimePath, bytes);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const closure = await collectBrowserRuntimeClosure({ rootDir: root, inventory, fsImpl });
  verifyRuntimeProvenance({ rootDir: root, sourceInventory: closure.files });
  const identitySource = await fsImpl.readFile(path.join(root, IDENTITY_PATH), 'utf8');
  if (closure.files.find(file => file.path === IDENTITY_PATH)?.sha256 !== sha256(identitySource)) throw new Error('Browser identity source changed during closure preparation.');
  if (identitySource.split(IDENTITY_SLOT).length !== 2) throw new Error('Browser execution identity has an unsupported generation slot.');
  const recipeFiles = ['scripts/BrowserRuntimeBuild.js', 'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js', 'scripts/RuntimeProvenance.js', 'scripts/InstrumentArtifactClosure.js'];
  const recipe = [];
  for (const file of recipeFiles) recipe.push({ path: file, sha256: sha256(await fsImpl.readFile(path.join(root, file))) });
  const normalized = [...closure.files, ...[...preparedCode].map(([name, bytes]) => ({ path: name, bytes: bytes.byteLength, sha256: sha256(bytes) }))].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(normalized.map(file => file.path)).size !== normalized.length) throw new Error('A generated code artifact conflicts with a tracked runtime source.');
  const { profiles: instrumentArtifactProfiles } = await collectInstrumentArtifactProfiles({ rootDir: root, inventory: normalized, fsImpl });
  const identity = await computeBrowserBuildIdentity(normalized, recipe, instrumentArtifactProfiles), { buildId } = identity;
  const generatedIdentity = renderBrowserBuildIdentity(identitySource, identity);
  const carrier = Buffer.from(generatedIdentity);
  const files = normalized.map(file => file.path === IDENTITY_PATH ? { path: file.path, bytes: carrier.byteLength, sha256: sha256(carrier) } : file);
  const manifest = { schema: 'lemmings-browser-build/v1', ...identity, instrumentArtifactProfiles, routes: closure.routes, assetProfile: closure.assetProfile,
    files, sourceBytes: files.reduce((total, file) => total + file.bytes, 0), recipe,
    sourceNormalization: { path: IDENTITY_PATH, templateSha256: sha256(identitySource), templateBytes: Buffer.byteLength(identitySource), templatePath: BUILD_TEMPLATE_PATH },
    qualification: { artifact: 'staged-with-content-hashes', offlineInstallation: 'not-installed', execution: 'entry-not-executed' } };
  await verifyBrowserBuildManifest(manifest, { expectedBuildId: buildId, template: identitySource });
  const canonical = JSON.stringify(manifest) + '\n';
  let ancestor = output;
  while (true) {
    try { const real = await fsImpl.realpath(ancestor); if (!inside(await fsImpl.realpath(root), real)) throw new Error('Browser output ancestor escapes the workspace.'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
  }
  await fsImpl.mkdir(output, { recursive: true });
  const realOutput = await fsImpl.realpath(output), finalPath = path.join(realOutput, buildId);
  const sourceBytes = async file => {
    const source = preparedCode.get(file.path) ?? await fsImpl.readFile(path.join(root, file.path));
    if (source.byteLength !== file.bytes || sha256(source) !== file.sha256) throw new Error(`Browser build input changed during staging: ${file.path}`);
    return source;
  };
  const cachedBytes = async relative => {
    const target = path.join(finalPath, relative), stat = await fsImpl.lstat(target), real = await fsImpl.realpath(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !inside(finalPath, target) || path.relative(target, real) !== '') throw new Error('An immutable browser generation has a redirected file.');
    return fsImpl.readFile(target);
  };
  const verifyExisting = async () => {
    let stat;
    try { stat = await fsImpl.lstat(finalPath); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(finalPath, await fsImpl.realpath(finalPath)) !== '') throw new Error('An immutable browser generation has a redirected directory.');
    if ((await cachedBytes('runtime-build.json')).toString('utf8') !== canonical) throw new Error('An immutable browser generation already has conflicting metadata.');
    await forEachBuildFile(normalized, async (file, index) => {
      // Recheck current inputs even on reuse; cached output never hides source drift.
      await sourceBytes(file);
      const bytes = await cachedBytes(file.path), expected = files[index];
      if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error('An immutable browser generation has changed bytes.');
    });
    const template = await cachedBytes(BUILD_TEMPLATE_PATH);
    if (template.byteLength !== manifest.sourceNormalization.templateBytes || sha256(template) !== manifest.sourceNormalization.templateSha256) throw new Error('An immutable browser generation has changed template bytes.');
    return true;
  };
  const reusedGeneration = await verifyExisting();
  if (!reusedGeneration) {
    const stage = await fsImpl.mkdtemp(path.join(realOutput, '.staging-' + buildId + '-'));
    const cleanup = async () => {
      const resolved = path.resolve(stage);
      if (path.dirname(resolved) !== realOutput || !path.basename(resolved).startsWith('.staging-' + buildId + '-')) throw new Error('Unexpected browser staging cleanup target.');
      await fsImpl.rm(resolved, { recursive: true, force: true });
    };
    try {
      await forEachBuildFile(normalized, async file => {
        const source = await sourceBytes(file), bytes = file.path === IDENTITY_PATH ? carrier : source, destination = path.join(stage, file.path);
        if (!inside(stage, destination)) throw new Error('Browser build file escapes its generation.');
        await fsImpl.mkdir(path.dirname(destination), { recursive: true }); await fsImpl.writeFile(destination, bytes);
      });
      const templatePath = path.join(stage, BUILD_TEMPLATE_PATH);
      await fsImpl.mkdir(path.dirname(templatePath), { recursive: true }); await fsImpl.writeFile(templatePath, identitySource);
      await fsImpl.writeFile(path.join(stage, 'runtime-build.json'), canonical);
      try { await fsImpl.rename(stage, finalPath); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code) || !await verifyExisting()) throw error; }
    } finally { await cleanup(); }
  }
  const published = { 'service-worker.js': `import { installBrowserGenerationWorker } from './${buildId}/js/runtime/BrowserGenerationService.js';\ninstallBrowserGenerationWorker({buildId:${JSON.stringify(buildId)}});\n` };
  for (const route of manifest.routes) published[route] = bootstrapPage(buildId, route);
  for (const [file, source] of Object.entries(published)) {
    const temporary = path.join(realOutput, `.publish-${buildId}-${randomUUID()}-${file}`);
    try { await fsImpl.writeFile(temporary, source); await fsImpl.rename(temporary, path.join(realOutput, file)); }
    finally { await fsImpl.rm(temporary, { force: true }); }
  }
  return { buildId, path: finalPath, entryPath: path.join(realOutput, 'index.html'), manifest, reusedGeneration, offlineInstallation: 'not-installed', activeExecution: 'entry-not-executed' };
}
