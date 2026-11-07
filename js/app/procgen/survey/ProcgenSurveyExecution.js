import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { verifyBrowserBuildManifest, hashBrowserBuildBytes } from '../../../runtime/BrowserBuildManifest.js';
import { readBrowserBuildResponse, awaitBrowserBuildOperation } from '../../../runtime/BrowserGenerationService.js';
import { cloneJournalData } from '../workstation/CausalJournalCanonical.js';

const root = new URL('../../../../', import.meta.url), leases = new WeakMap();
const binding = required => {
  const comparison = compareActiveExecutionIdentity(required);
  if (!comparison.matched) throw new Error('Active execution identity is unbound or differs from the recorded build: ' + comparison.mismatches.join(', '));
  return comparison.active;
};
export function openIsolatedBrowserSurveyExecution() {
  const active = getActiveExecutionIdentity();
  if (active.activeExecution !== 'bound') throw new Error('Active execution identity is unbound.');
  if (typeof globalThis.DedicatedWorkerGlobalScope !== 'function' || !(globalThis instanceof globalThis.DedicatedWorkerGlobalScope)) throw new Error('Exact replay requires an owned dedicated worker realm.');
  const lease = Object.freeze({}); leases.set(lease, active);
  return Object.freeze({ lease, close: () => leases.delete(lease) });
}
export function requireIsolatedBrowserSurveyExecution(lease, sourceManifest) {
  const active = getActiveExecutionIdentity();
  if (active.activeExecution !== 'bound') throw new Error('Active execution identity is unbound; use a current-runtime comparison or a trusted matching build.');
  const held = leases.get(lease);
  if (!held || held.realmId !== active.realmId) throw new Error('Exact replay execution lease is missing or retired.');
  return binding(sourceManifest?.executionIdentity);
}
export async function loadActiveBrowserSurveyBuild({ fetchFile = globalThis.fetch, signal } = {}) {
  const active = getActiveExecutionIdentity(); binding(active);
  const read = async (file, maximum) => {
    const response = await awaitBrowserBuildOperation(() => fetchFile(new URL(file, root), { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal }), signal);
    return readBrowserBuildResponse(response, maximum, signal);
  };
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('runtime-build.json', 2 * 1048576)));
  const preliminary = await verifyBrowserBuildManifest(manifest, { expectedBuildId: active.buildId });
  const template = new TextDecoder('utf-8', { fatal: true }).decode(await read(preliminary.templatePath, preliminary.templateBytes));
  const verified = await verifyBrowserBuildManifest(manifest, { expectedBuildId: active.buildId, template });
  for (const field of ['buildId', 'closureDigest', 'assetDigest', 'codeDigest', 'harnessVersion'])
    if (verified.identity[field] !== active[field]) throw new Error('Fetched artifacts do not identify the executing application build.');
  signal?.throwIfAborted(); return verified;
}
export async function requireSurveySourceBuild(sourceManifest, verified) {
  const source = cloneJournalData(sourceManifest, { maxBytes: 2 * 1048576, maxNodes: 32768 });
  const active = binding(source.executionIdentity);
  if (source.schemaVersion !== 2 || source.sourceKind !== 'immutable-browser-generation' || source.engineCommit !== active.buildId ||
      verified?.templateVerified !== true || verified.identity.buildId !== active.buildId) throw new Error('Exact replay requires the matching trusted browser generation.');
  const expected = new Map(verified.files.filter(file => /\.(?:[cm]?js|wasm)$/.test(file.path)).map(file => [file.path, file.sha256]));
  const entries = Object.entries(source.codeHashes || {});
  if (entries.length !== expected.size || entries.some(([file, hash]) => expected.get(file) !== hash)) throw new Error('Recorded executable closure differs from the executing browser generation.');
  if (await hashBrowserBuildBytes(new TextEncoder().encode(JSON.stringify(source.codeHashes))) !== source.codeDigest) throw new Error('Recorded executable closure digest changed.');
  const assets = new Map(verified.files.map(file => [file.path, file.sha256]));
  for (const [file, hash] of Object.entries(source.assetHashes || {})) if (assets.get(file) !== hash) throw new Error('Recorded asset differs from the executing browser generation: ' + file);
  return active;
}
export async function createActiveBrowserSurveySourceManifest({ scenarios, fetchFile, signal } = {}) {
  if (!Array.isArray(scenarios) || !scenarios.length || scenarios.length > 4096) throw new Error('Invalid browser survey source scenarios.');
  const verified = await loadActiveBrowserSurveyBuild({ fetchFile, signal }), files = new Map(verified.files.map(file => [file.path, file]));
  const names = new Set(['lemmings_ohNo/MAIN.DAT', 'assets/procgen/terrain-recipes.json']);
  for (const scenario of scenarios) if (scenario.mode === 'generated') {
    if (!/^[A-Za-z0-9_-]+$/.test(scenario.pack) || !Number.isSafeInteger(scenario.groundSet) || scenario.groundSet < 0 || scenario.groundSet > 255) throw new Error('Unsupported browser survey asset selection.');
    names.add(`${scenario.pack}/GROUND${scenario.groundSet}O.DAT`); names.add(`${scenario.pack}/VGAGR${scenario.groundSet}.DAT`);
  }
  const assetHashes = {};
  for (const file of [...names].sort()) { if (!files.has(file)) throw new Error('Survey asset is outside the installed browser generation: ' + file); assetHashes[file] = files.get(file).sha256; }
  const codeHashes = Object.fromEntries(verified.files.filter(file => /\.(?:[cm]?js|wasm)$/.test(file.path)).map(file => [file.path, file.sha256]));
  const active = getActiveExecutionIdentity();
  return cloneJournalData({ schemaVersion: 2, engineCommit: active.buildId, sourceKind: 'immutable-browser-generation', codeHashes,
    codeDigest: await hashBrowserBuildBytes(new TextEncoder().encode(JSON.stringify(codeHashes))), assetHashes,
    executionIdentity: { status: 'bound', ...active } }, { maxBytes: 2 * 1048576, maxNodes: 32768 });
}
