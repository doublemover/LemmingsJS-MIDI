import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../../scripts/BrowserRuntimeBuild.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export async function browserGenerationFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-generation-fixture-'));
  const files = { 'index.html': '<link rel="stylesheet" href="css/shell.css"><script type="module" src="js/entry.js"></script>',
    'editor.html': '<title>Editor fixture</title><script type="module" src="js/entry.js"></script>',
    'procgen.html': '<title>Instrument fixture</title><script type="module" src="js/entry.js"></script>',
    'procgen-survey.html': '<title>Survey fixture</title><script type="module" src="js/entry.js"></script>',
    'js/entry.js': 'import { getActiveExecutionIdentity } from "./runtime/ActiveExecutionIdentity.js"; globalThis.fixtureIdentity = getActiveExecutionIdentity();',
    'js/app/procgen/survey/ProcgenSurveyCanonical.js': 'export const SURVEY_STATE_SCHEMA = 3;',
    'config.json': '[{"path":"classic"}]', 'classic/MAIN.DAT': 'fixture', 'css/shell.css': 'body { color: rgb(10, 20, 30); }',
    'keybindings.json': '{}', 'site.webmanifest': '{}', 'provenance/runtime-artifacts.json': JSON.stringify({ version: 1,
      selectedBackends: { browserMidi: 'fixture', nativeUmp: 'fixture', audioRuntime: 'fixture', optionalAudioBank: 'fixture' }, workerSources: [], components: [] }) };
  for (const [file, source] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), source); }
  for (const file of ['js/runtime/ActiveExecutionIdentity.js', 'js/runtime/BrowserBuildManifest.js', 'js/runtime/BrowserGenerationService.js',
    'js/runtime/BrowserGenerationClient.js', 'js/runtime/BrowserGenerationPins.js', 'js/runtime/InstrumentArtifactManifest.js', 'js/core/CanonicalData.js', 'scripts/InstrumentArtifactClosure.js', 'scripts/BrowserRuntimeBuild.js', 'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js', 'scripts/RuntimeProvenance.js']) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.copyFile(path.join(repository, file), path.join(root, file));
  }
  return { root, build: () => buildBrowserRuntime({ rootDir: root, inventory: ['classic/MAIN.DAT', 'css/shell.css'] }),
    async close() {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('lemmings-generation-fixture-')) throw new Error('Unexpected generation fixture cleanup target.');
      await fs.rm(root, { recursive: true, force: true });
    } };
}

export const memoryGenerationCaches = () => {
  const stores = new Map();
  const key = request => typeof request === 'string' ? request : request.url;
  return { stores, async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map()); const store = stores.get(name);
      return { async match(request) { return store.get(key(request))?.clone(); }, async put(request, response) { store.set(key(request), response.clone()); },
        async delete(request) { return store.delete(key(request)); } };
    } };
};
