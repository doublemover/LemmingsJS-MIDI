import { generateProcgenSurveyCandidates } from '../../js/app/procgen/survey/ProcgenSurveyCandidates.js';
import { normalizeSurveyScenario } from '../../js/app/procgen/survey/ProcgenSurveyScenario.js';
import { createSurveySourceManifest, createNodeSurveyTrial } from '../../scripts/procgen-survey/SurveyNodeWorld.js';

export const createBrowserSurveyFixtureReport = async () => {
  const raw = [
    { id: 'flat-ordinary-eight', environmentSeed: 42, horizonTicks: 192, goal: { x: 120, y: 64, width: 64, height: 16 },
      geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }] } },
    { id: 'heldout-source-902', corpus: 'holdout', mode: 'generated', environmentSeed: 902, pack: 'lemmings', groundSet: 0,
      laneHeight: 144, horizonTicks: 600, goal: { x: 160, y: 0, width: 512, height: 144 } }
  ].map(scene => ({ ...scene, cohort: { size: 8, birthInterval: 4 }, physicalLaneCount: 1, checkpointEvery: 64 }));
  const sourceManifest = await createSurveySourceManifest(raw), candidates = generateProcgenSurveyCandidates({ count: 16 });
  const scenarios = raw.map(scene => normalizeSurveyScenario({ ...scene, engineCommit: sourceManifest.engineCommit, assetHashes: sourceManifest.assetHashes }));
  const results = [];
  for (const scenario of scenarios) for (const candidate of scenario.corpus === 'holdout' ? [candidates[0], candidates[2]] : candidates) {
    const trial = await createNodeSurveyTrial({ scenario, candidate });
    try { trial.step(scenario.horizonTicks); const result = trial.result(); if (!result.episodeComplete) throw new Error('The browser fixture needs completed physical trials.'); results.push(result); }
    finally { trial.dispose(); }
  }
  return { schemaVersion: 1, status: 'completed-browser-fixture', manifest: { experimentId: 'self-contained-browser-fixture', sourceManifest, scenarios, candidates,
    developmentScenarioIds: [scenarios[0].id], holdoutScenarioIds: [scenarios[1].id], budgetPolicy: { executionWorkers: 1, residentWorlds: 1 } }, results };
};
