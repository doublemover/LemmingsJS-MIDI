import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProcgenMasks, loadProcgenTerrain } from '../bench-procgen-lanes.js';
import { createSurveyTrial } from '../../js/app/procgen/survey/ProcgenSurveyCore.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const assetPaths = scenario => ['lemmings_ohNo/MAIN.DAT', 'assets/procgen/terrain-recipes.json', ...(scenario.mode === 'generated' ?
  [(scenario.pack || 'lemmings') + '/GROUND' + (scenario.groundSet || 0) + 'O.DAT', (scenario.pack || 'lemmings') + '/VGAGR' + (scenario.groundSet || 0) + '.DAT'] : [])];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const createSurveySourceManifest = async scenarios => {
  const engineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const pending = ['scripts/run-procgen-survey.js', 'scripts/procgen-survey/survey-worker.js', 'js/app/procgen/survey/ProcgenSurveyDashboard.js'];
  const codeHashes = {}, visited = new Set();
  while (pending.length) {
    const name = pending.pop(); if (visited.has(name)) continue; visited.add(name);
    const source = await fs.readFile(new URL('../../' + name, import.meta.url)); codeHashes[name] = sha256(source);
    for (const match of source.toString('utf8').matchAll(/(?:from\s*|import\s*\(|import\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = fileURLToPath(new URL(match[1], new URL('../../' + name, import.meta.url)));
      const relative = dependency.slice(repoRoot.length).replaceAll('\\', '/');
      if (!dependency.toLowerCase().startsWith(repoRoot.toLowerCase()) || !relative || relative.startsWith('../') || !/\.m?js$/.test(relative)) throw new Error('Unsupported survey source dependency');
      pending.push(relative);
    }
  }
  const orderedHashes = Object.fromEntries(Object.entries(codeHashes).sort(([a],[b]) => a.localeCompare(b)));
  const assetHashes = {};
  for (const name of [...new Set(scenarios.flatMap(assetPaths))].sort()) assetHashes[name] = sha256(await fs.readFile(new URL('../../' + name, import.meta.url)));
  return { schemaVersion: 1, engineCommit, sourceKind: 'commit-plus-file-sha256', codeHashes: orderedHashes, codeDigest: sha256(JSON.stringify(orderedHashes)), assetHashes, nodeVersion: process.version, v8Version: process.versions.v8,
    harnessVersion: 'procgen-survey-v1', canonicalStateVersion: 1 };
};
const createNodeSurveyTrial = async (job, masks) => {
  const scenario = job.scenario;
  const terrain = scenario.mode === 'generated' ? await loadProcgenTerrain(scenario.pack || 'lemmings', scenario.groundSet || 0) : null;
  return createSurveyTrial({ scenario, candidate: job.candidate, masks: masks || await loadProcgenMasks(), terrain, attemptId: job.attemptId });
};
export { repoRoot, createSurveySourceManifest, createNodeSurveyTrial, loadProcgenMasks };
