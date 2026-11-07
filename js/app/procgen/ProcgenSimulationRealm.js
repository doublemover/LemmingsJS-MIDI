import { createPhysicalFeedbackController } from './workstation/physical/PhysicalFeedback.js';
import { procgenSimulationExecutionPolicy } from './ProcgenSimulationExecutionPolicy.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from './ProcgenRetirement.js';
import { prepareProcgenInspectionWorld } from './workstation/ProcgenInspectionWorld.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from './workstation/ProcgenCheckpoint.js';
import { hashProcgenContinuationCheckpoint } from './workstation/ProcgenCheckpointProvenance.js';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from './workstation/CausalMusicEngine.js';
import { createCausalPerformanceState } from './workstation/CausalPerformanceState.js';
import { createProcgenPhysicalScoreClock } from './workstation/ProcgenPhysicalScoreClock.js';
import { createProcgenSimulationCore } from './ProcgenSimulationCore.js';
import { validateSimulationManifest, simulationFailure } from './ProcgenSimulationProtocol.js';

export async function prepareProcgenSimulationRealm({ manifest, resourceBudget, signal, requiredConsumer, onState,
  createWorld = prepareProcgenInspectionWorld } = {}) {
  validateSimulationManifest(manifest); signal?.throwIfAborted();
  let candidate = null, engine = null, core = null, feedback = null;
  const policy = procgenSimulationExecutionPolicy(manifest.executionPolicy), retirement = createProcgenRetirementScope(),
    disposeWorld = () => retirement.retire([{ name: 'physical-feedback-executor', run: () => feedback?.dispose() },
      { name: 'isolated-world', run: () => afterProcgenRetirement(feedback ? [feedback.dispose()] : [], () => candidate.dispose()) }]);
  try {
    candidate = await createWorld({ checkpoint: manifest.checkpoint, rootPath: manifest.rootPath, resourceBudget, signal }); signal?.throwIfAborted();
    const world = candidate.world; restoreProcgenCheckpoint(world, manifest.checkpoint);
    const [expected, actual] = await Promise.all([hashProcgenContinuationCheckpoint(manifest.checkpoint), hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world))]);
    signal?.throwIfAborted(); if (actual !== expected) throw simulationFailure('restore-divergence', 'The worker world differs from its validated source before the first tick.');
    let graph = validateCausalInstrumentGraph(world.physicalAuthoring?.graph || manifest.graph),
      performance = createCausalPerformanceState(manifest.performance || manifest.semantic.performanceInputs || { version: 1, lanes: [] });
    const clock = createProcgenPhysicalScoreClock(); if (manifest.timeline) clock.restore(manifest.timeline);
    engine = createCausalMusicEngine({ resourceBudget, world, getGraph: () => world.physicalAuthoring?.graph || graph,
      scoreTimeline: manifest.scoreTimeline ? clock : null, traceLimit: 0,
      getLaneState: source => performance.getLaneState(source), getPerformanceState: () => performance.snapshot(),
      getOnsetControls: (source, identity) => performance.getControls(source, identity), getTimeTransformPolicy: source => performance.getTimeTransformPolicy(source),
      getScoreContextPolicy: source => performance.getScoreContextPolicy(source), getPianoPolicy: source => performance.getPianoPolicy(source),
      getPianoControls: source => performance.getPianoControls(source), getOrchestralPolicy: source => performance.getOrchestralPolicy(source),
      getPercussionPolicy: source => performance.getPercussionPolicy(source), getPhysicalControlKinds: source => performance.getPhysicalControlKinds(source) });
    engine.restore(manifest.semantic); signal?.throwIfAborted();
    if (policy.physicalFeedbackMode === 'preserve-live') {
      feedback = createPhysicalFeedbackController({ world, getGraph: () => world.physicalAuthoring?.graph || graph, resourceBudget, onFailure: error => core?.fail(error) });
      feedback.resumeContinuation();
    }
    core = createProcgenSimulationCore({ world, engine, clock, nominalSpeed: manifest.nominalSpeed ?? (world.timer.speedFactor > 0 ? world.timer.speedFactor : 1), resourceBudget, documentRevision: manifest.documentRevision,
      scoreTimeline: manifest.scoreTimeline, playing: manifest.playing, bpm: manifest.bpm, requiredConsumer, onState,
      getPerformance: () => performance.snapshot(), applyPerformance: value => { const next = createCausalPerformanceState(value.performance), nextGraph = validateCausalInstrumentGraph(value.graph); performance = next; graph = nextGraph; },
      disposeWorld, observePhysicalFeedback: (batch, analysis) => feedback?.observe(batch, analysis), getExecutionPolicy: () => policy });
    return Object.freeze({ host: core, physicalAnalysis: () => engine.physicalAnalysis(), restoredContinuationHash: actual, execution: 'world-and-causal-music-in-owning-realm' });
  } catch (error) {
    if (core) { const receipt = core.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; }
    else {
      try { engine?.dispose(); } catch (retirement) { error.retirement = retirement; }
      if (candidate) { const receipt = disposeWorld(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; }
    }
    throw error;
  }
}
