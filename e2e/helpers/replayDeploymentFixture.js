import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collectBrowserRuntimeClosure } from '../../scripts/BrowserRuntimeClosure.js';
import { verifyRuntimeProvenance } from '../../scripts/RuntimeProvenance.js';
import { buildBrowserRuntime } from '../../scripts/BrowserRuntimeBuild.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const recipeFiles = ['scripts/BrowserRuntimeBuild.js', 'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js', 'scripts/RuntimeProvenance.js', 'scripts/InstrumentArtifactClosure.js'];
const ownedPath = (root, relative) => {
  if (!/^[A-Za-z0-9_./@-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid deployment fixture source path.');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Deployment fixture path escaped its owner.');
  return resolved;
};

// Build actual first-party applications from detached test-owned copies. The
// repository's runtime/vendor bytes are never edited and no report supplies code.
export async function createReplayDeploymentFixture() {
  const source = await collectBrowserRuntimeClosure({ rootDir: repository }), provenance = verifyRuntimeProvenance({ rootDir: repository, sourceInventory: source.files });
  const parent = path.join(repository, 'dist'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'replay-deployment-e2e-')), output = path.join(root, 'dist/browser');
  const expectedFiles = new Map([...source.files, ...provenance.files].map(file => [file.path, file]));
  const paths = [...new Set([...source.files.map(file => file.path), ...provenance.files.map(file => file.path), ...recipeFiles])].sort();
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < paths.length) {
      const relative = paths[cursor++], destination = ownedPath(root, relative); await fs.mkdir(path.dirname(destination), { recursive: true });
      const bytes = await fs.readFile(ownedPath(repository, relative)), expected = expectedFiles.get(relative);
      if (expected && digest(bytes) !== expected.sha256) throw new Error('Application source changed while copying ' + relative);
      await fs.writeFile(destination, bytes);
    }
  }));
  const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8')), folders = ['assets', 'img', 'css', ...config.map(pack => pack.path)];
  const inventory = source.files.filter(file => folders.some(folder => file.path.startsWith(folder + '/'))).map(file => file.path);
  const builds = [], mutations = [];
  const refreshProvenance = async () => {
    const filename = path.join(root, 'provenance/runtime-artifacts.json'), manifest = JSON.parse(await fs.readFile(filename, 'utf8'));
    for (const component of manifest.components) {
      const files = provenance.components.find(value => value.id === component.id).files, hash = createHash('sha256');
      for (const relative of files) hash.update(relative).update('\0').update(await fs.readFile(ownedPath(root, relative))).update('\0');
      component.fileCount = files.length; component.sha256 = hash.digest('hex');
    }
    await fs.writeFile(filename, JSON.stringify(manifest, null, 2) + '\n');
  };
  return { root, output, source, builds, mutations,
    async build(kind = 'baseline') {
      if (!['baseline', 'code', 'asset'].includes(kind) || builds.length >= 3) throw new Error('Invalid bounded deployment revision.');
      if (kind !== 'baseline') {
        const relative = kind === 'code' ? 'js/app/procgen/ProcgenLaneWorld.js' : 'assets/procgen/terrain-recipes.json';
        const filename = ownedPath(root, relative), before = await fs.readFile(filename), after = Buffer.concat([before, Buffer.from('\n')]);
        await fs.writeFile(filename, after); mutations.push({ kind, path: relative, beforeSha256: digest(before), afterSha256: digest(after), beforeBytes: before.length, afterBytes: after.length });
        await refreshProvenance();
      }
      const build = await buildBrowserRuntime({ rootDir: root, outputDir: output, inventory }); builds.push(build); return build;
    },
    async corruptPublished(build, relative, suffix) {
      if (!builds.includes(build) || !build.manifest.files.some(file => file.path === relative) || !['js/app/procgen/ProcgenLaneWorld.js', 'assets/procgen/terrain-recipes.json'].includes(relative)) throw new Error('Invalid published tamper fixture.');
      const filename = ownedPath(path.join(output, build.buildId), relative), before = await fs.readFile(filename), after = Buffer.concat([before, Buffer.from(suffix)]);
      await fs.writeFile(filename, after); let restored = false;
      return { path: relative, buildId: build.buildId, beforeSha256: digest(before), afterSha256: digest(after), async restore() { if (restored) return; restored = true; await fs.writeFile(filename, before); } };
    },
    async close() {
      const realParent = await fs.realpath(parent), realRoot = await fs.realpath(root);
      if (path.dirname(realRoot) !== realParent || !path.basename(realRoot).startsWith('replay-deployment-e2e-')) throw new Error('Unexpected deployment cleanup target.');
      await fs.rm(realRoot, { recursive: true, force: true });
    }
  };
}

export async function updateReplayDeployment(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration(); if (!registration) throw new Error('No owned generation registration.');
    await registration.update(); const worker = registration.installing || registration.waiting;
    if (!worker) return registration.active?.state;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Deployment update did not finish.')); }, 90000);
      const changed = () => { if (['activated', 'redundant'].includes(worker.state)) { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(worker.state); } };
      worker.addEventListener('statechange', changed); changed();
    });
  });
}
