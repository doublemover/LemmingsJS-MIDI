import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectBrowserRuntimeClosure } from './BrowserRuntimeClosure.js';

const IDENTITY_PATH = 'js/runtime/ActiveExecutionIdentity.js';
const IDENTITY_SLOT = 'const APPLICATION_BUILD = null; // IMMUTABLE_APPLICATION_BUILD_SLOT';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

export async function buildBrowserRuntime({ rootDir, outputDir = null, inventory = null, fsImpl = fs } = {}) {
  const root = path.resolve(rootDir), output = path.resolve(outputDir || path.join(root, 'dist', 'browser'));
  if (!inside(path.join(root, 'dist'), output) || output === path.join(root, 'dist')) throw new Error('Browser build output must be inside this workspace dist directory.');
  const closure = await collectBrowserRuntimeClosure({ rootDir: root, inventory, fsImpl });
  const identitySource = await fsImpl.readFile(path.join(root, IDENTITY_PATH), 'utf8');
  if (closure.files.find(file => file.path === IDENTITY_PATH)?.sha256 !== sha256(identitySource)) throw new Error('Browser identity source changed during closure preparation.');
  if (identitySource.split(IDENTITY_SLOT).length !== 2) throw new Error('Browser execution identity has an unsupported generation slot.');
  const recipeFiles = ['scripts/BrowserRuntimeBuild.js', 'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js'];
  const recipe = [];
  for (const file of recipeFiles) recipe.push({ path: file, sha256: sha256(await fsImpl.readFile(path.join(root, file))) });
  const normalized = closure.files;
  const buildId = sha256(JSON.stringify({ schema: 'lemmings-immutable-browser-input/v1', files: normalized, recipe }));
  const codeFiles = normalized.filter(file => /\.(?:[cm]?js|wasm)$/.test(file.path)), assets = normalized.filter(file => !/\.(?:[cm]?js|wasm)$/.test(file.path));
  const identity = { buildId, closureDigest: sha256(JSON.stringify(normalized)), assetDigest: sha256(JSON.stringify(assets)), codeDigest: sha256(JSON.stringify(codeFiles)),
    harnessVersion: 'browser-survey-v1', identityRecipe: 'normalized-data-slot-v1' };
  const generatedIdentity = identitySource.replace(IDENTITY_SLOT, `const APPLICATION_BUILD = Object.freeze(${JSON.stringify(identity)}); // IMMUTABLE_APPLICATION_BUILD_SLOT`);
  let ancestor = output;
  while (true) {
    try { const real = await fsImpl.realpath(ancestor); if (!inside(await fsImpl.realpath(root), real)) throw new Error('Browser output ancestor escapes the workspace.'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
  }
  await fsImpl.mkdir(output, { recursive: true });
  const realOutput = await fsImpl.realpath(output), finalPath = path.join(realOutput, buildId);
  const stage = await fsImpl.mkdtemp(path.join(realOutput, '.staging-' + buildId + '-'));
  const cleanup = async () => {
    const resolved = path.resolve(stage);
    if (path.dirname(resolved) !== realOutput || !path.basename(resolved).startsWith('.staging-' + buildId + '-')) throw new Error('Unexpected browser staging cleanup target.');
    await fsImpl.rm(resolved, { recursive: true, force: true });
  };
  try {
    const files = [];
    for (const file of normalized) {
      const source = await fsImpl.readFile(path.join(root, file.path));
      if (source.byteLength !== file.bytes || sha256(source) !== file.sha256) throw new Error(`Browser build input changed during staging: ${file.path}`);
      const bytes = file.path === IDENTITY_PATH ? Buffer.from(generatedIdentity) : source, destination = path.join(stage, file.path);
      if (!inside(stage, destination)) throw new Error('Browser build file escapes its generation.');
      await fsImpl.mkdir(path.dirname(destination), { recursive: true }); await fsImpl.writeFile(destination, bytes);
      files.push({ path: file.path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    const manifest = { schema: 'lemmings-browser-build/v1', ...identity, routes: closure.routes, assetProfile: closure.assetProfile,
      files, sourceBytes: files.reduce((total, file) => total + file.bytes, 0), recipe,
      sourceNormalization: { path: IDENTITY_PATH, templateSha256: sha256(identitySource) },
      qualification: { artifact: 'staged-with-content-hashes', offlineInstallation: 'not-installed', execution: 'entry-not-executed' } };
    const canonical = JSON.stringify(manifest) + '\n'; await fsImpl.writeFile(path.join(stage, 'runtime-build.json'), canonical);
    try { await fsImpl.rename(stage, finalPath); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      if (await fsImpl.readFile(path.join(finalPath, 'runtime-build.json'), 'utf8') !== canonical) throw new Error('An immutable browser generation already has conflicting metadata.');
      for (const file of files) if (sha256(await fsImpl.readFile(path.join(finalPath, file.path))) !== file.sha256) throw new Error('An immutable browser generation has changed bytes.');
      await cleanup();
    }
    return { buildId, path: finalPath, manifest, offlineInstallation: 'not-installed', activeExecution: 'entry-not-executed' };
  } catch (error) { await cleanup(); throw error; }
}
