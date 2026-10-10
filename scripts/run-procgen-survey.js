import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSurveySourceManifest, repoRoot } from './procgen-survey/SurveyNodeWorld.js';
import { SurveyEvidenceStore } from './procgen-survey/SurveyEvidenceStore.js';
import { runSurveyExperiment } from './procgen-survey/SurveyCoordinator.js';
import { createSurveyServer } from './procgen-survey/SurveyServer.js';
import { normalizeSurveyResources } from './procgen-survey/SurveyWorkerPool.js';
import { normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyScenario.js';
import { generateProcgenSurveyCandidates, createProcgenSurveyExperiment } from '../js/app/procgen/survey/ProcgenSurveyCandidates.js';

const smokeScenarios = () => [
  { id: 'flat-ordinary-eight', environmentSeed: 42, horizonTicks: 192, goal: { x: 120, y: 64, width: 64, height: 16 }, geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }] } },
  { id: 'wall-ordinary-eight', environmentSeed: 12345, horizonTicks: 600, goal: { x: 176, y: 64, width: 64, height: 16 }, geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }, { x: 80, y: 48, width: 80, height: 24 }] } },
  { id: 'gap-ordinary-eight', environmentSeed: 31415, horizonTicks: 600, goal: { x: 180, y: 64, width: 64, height: 16 }, geometry: { solid: [{ x: 8, y: 72, width: 88, height: 24 }, { x: 128, y: 72, width: 896, height: 24 }] } },
  { id: 'heldout-source-902', corpus: 'holdout', mode: 'generated', environmentSeed: 902, pack: 'lemmings', groundSet: 0, laneHeight: 144, horizonTicks: 600, goal: { x: 160, y: 0, width: 512, height: 144 } },
  { id: 'heldout-source-903', corpus: 'holdout', mode: 'generated', environmentSeed: 903, pack: 'lemmings', groundSet: 0, laneHeight: 144, horizonTicks: 600, goal: { x: 160, y: 0, width: 512, height: 144 } }
].map(scene => ({ ...scene, cohort: { size: 8, birthInterval: 4 }, physicalLaneCount: 1, checkpointEvery: 64 }));
const safeOutput = name => {
  const base = path.join(repoRoot, 'temp', 'procgen-surveys'), directory = path.resolve(name || base);
  if (directory !== base && !directory.startsWith(base + path.sep)) throw new Error('Survey output must stay under project temp/procgen-surveys');
  return directory;
};
const readReceipt = async file => {
  const receipt = JSON.parse(await fs.readFile(file, 'utf8')); return receipt.value || receipt;
};
const main = async args => {
  const allowed = new Set(['candidates', 'execution-workers', 'resident-worlds', 'max-total-ticks', 'max-total-ms', 'max-trial-ms', 'storage-mb', 'sampling-seed', 'out', 'resume', 'manifest', 'name', 'serve', 'paused']);
  const input = {};
  for (const arg of args) { const match = /^--([^=]+)=(.+)$/.exec(arg); if (!match || !allowed.has(match[1])) throw new Error('Unknown survey argument: ' + arg); input[match[1]] = match[2]; }
  const candidates = Number(input.candidates || 16); if (![16, 64].includes(candidates)) throw new Error('Logical candidate count must be 16 or 64');
  let manifest;
  if (input.resume) {
    const directory = safeOutput(input.resume); manifest = await readReceipt(path.join(directory, 'manifest.json'));
    const current = await createSurveySourceManifest(manifest.scenarios);
    if (current.nodeVersion !== manifest.sourceManifest.nodeVersion || current.v8Version !== manifest.sourceManifest.v8Version || current.codeDigest !== manifest.sourceManifest.codeDigest || JSON.stringify(current.assetHashes) !== JSON.stringify(manifest.sourceManifest.assetHashes)) throw new Error('Resume requires the original exact source/assets; use a new experiment for changed code');
  } else {
    const raw = input.manifest ? (await readReceipt(input.manifest)).scenarios : smokeScenarios();
    const sourceManifest = await createSurveySourceManifest(raw);
    const scenarios = raw.map(scene => normalizeSurveyScenario({ ...scene, engineCommit: sourceManifest.engineCommit, assetHashes: sourceManifest.assetHashes }));
    const policies = generateProcgenSurveyCandidates({ count: candidates, samplingSeed: Number(input['sampling-seed'] || 1) });
    const resources = normalizeSurveyResources({ executionWorkers: Number(input['execution-workers'] || 1), residentWorlds: Number(input['resident-worlds'] || 16),
      maxTotalTicks: Number(input['max-total-ticks'] || 100000), maxTotalMs: Number(input['max-total-ms'] || 120000), maxTrialMs: Number(input['max-trial-ms'] || 60000) });
    manifest = createProcgenSurveyExperiment({ scenarios, candidates: policies,
      developmentScenarioIds: scenarios.filter(scene => scene.corpus !== 'holdout').map(scene => scene.id), holdoutScenarioIds: scenarios.filter(scene => scene.corpus === 'holdout').map(scene => scene.id),
      sourceManifest, budgetPolicy: { ...resources, frozenFinalistIds: [policies[0].id, policies[2].id], maxExemplarVerificationTrials: 12, successQualification: { maxOriginals: 1, maxTrials: 15, maxPhysicalTrials: 30, policySeeds: [2, 3], nearbyAdmissionOffsets: [-4, 4] }, storageBytes: Number(input['storage-mb'] || 32) * 1048576 },
      criteria: { samplingSeed: Number(input['sampling-seed'] || 1), scope: 'smoke', minimumIndependentClusters: 8, successCasualtyReduction: 1 } });
  }
  const directory = input.resume ? safeOutput(input.resume) : path.join(safeOutput(input.out), manifest.experimentId);
  const store = await new SurveyEvidenceStore(directory, { maxBytes: manifest.budgetPolicy.storageBytes }).initialize(manifest);
  const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let server, cachedState = () => ({ schemaVersion: 1, manifest, results: [], status: 'starting' }), controls;
  try {
    if (input.serve === 'true') { server = await createSurveyServer({ getState: () => cachedState(), onControl: command => controls?.[command]?.() || { status: 'finished' } }); console.log(JSON.stringify({ dashboard: server.url + '#token=' + server.token })); }
    console.log(JSON.stringify({ experimentId: manifest.experimentId, logicalCandidates: manifest.candidates.length, executionWorkers: manifest.budgetPolicy.executionWorkers, residentWorlds: manifest.budgetPolicy.residentWorlds, directory }));
    const report = await runSurveyExperiment(manifest, store, { signal: controller.signal, onState: state => { cachedState = state; }, onControlReady: value => { controls = value; if (input.paused === 'true') controls.pause(); } });
    cachedState = () => report; controls = null;
    const reportFile = path.join(directory, 'report.json'); await store.writeDerivative('report.json', report);
    console.log(JSON.stringify({ status: report.status, results: report.results.length, reasons: report.reason, storage: store.snapshot(), reportFile, rankingsTrusted: false }));
    if (report.status !== 'complete') process.exitCode = 2;
    return report;
  } finally { await server?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
};
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
export { main, smokeScenarios, safeOutput };
