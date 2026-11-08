import { materializePinnedStretchCore } from './materialize-stretch-core.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from './BrowserRuntimeBuild.js';

const options = { rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') };
let name = 'builder';
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--root=')) options.rootDir = path.resolve(argument.slice(7));
  else if (argument.startsWith('--output=')) options.outputDir = path.resolve(argument.slice(9));
  else if (argument.startsWith('--name=')) name = argument.slice(7);
  else throw new Error('Unknown browser build option: ' + argument);
}
await materializePinnedStretchCore({ rootDir: options.rootDir });
const receipt = await buildBrowserRuntime(options);
process.stdout.write(JSON.stringify({ name, buildId: receipt.buildId, path: receipt.path, files: receipt.manifest.files.length,
  bytes: receipt.manifest.sourceBytes, offlineInstallation: receipt.offlineInstallation, activeExecution: receipt.activeExecution }) + '\n');
