import { createEffectSourceSampler } from '../../midi-ui/EffectSourceBindings.js';
import { sceneEffectSourceBindings } from './SceneEffectRack.js';
import { canonicalDataText, freezeData, hashData } from '../../../core/CanonicalData.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../../midi/content/EffectGraphRevision.js';
import { validateMappedBodyPreparation, preparedBodyIdentity } from '../../../midi/content/PreparedSurface.js';
import { planPreparedBodyStrike } from '../../../midi/content/PreparedBodyStrike.js';
import { createCausalRenderTiming } from '../../midi-ui/CausalRenderTiming.js';
import { createOwnedEffectGraphKernel } from '../../midi-ui/OwnedEffectGraphKernel.js';
import { createPreparedSurfaceBodyOwner } from './PreparedSurfaceBodyOwner.js';
import { validateScenePreparedSurfaceMapping } from './ScenePreparedSurface.js';

const fail = message => Object.assign(new Error(message), { code: 'scene-surface-rehearsal-unavailable' });
export function scenePreparedSurfaceRehearsalProfile(raw, scene) {
  const mechanism = validateScenePreparedSurfaceMapping(raw, scene.causalMappings), surface = scene.causalMappings.preparedSurfaces.find(row => row.id === mechanism.surfaceId), node = mechanism.graph.nodes.find(node => node.id === mechanism.nodeId), finite = node.kind === 'rectangular-membrane';
  if (scene.cost.sharedBodies !== 1) throw fail('The private surface prefix needs exactly one authored shared body.');
  return freezeData({ mechanism, surface, finite, bodyCount: 1, strategy: 'observed-prepared-surface', modeCount: finite ? node.parameters.gridSize ** 2 : node.parameters.bodies[0].modes.length });
}
export async function prepareScenePreparedSurfaceRehearsal({ scene, mechanism, source, sampleRate, signal, yieldControl = async () => {} }) {
  const profile = scenePreparedSurfaceRehearsalProfile(mechanism, scene), evidence = source.preparedSurface;
  if (!evidence || Object.keys(evidence).some(key => !['schema', 'policy', 'commands'].includes(key)) || evidence.schema !== 'lemmings-private-prepared-surface/v1' || evidence.policy !== 'complete-invariant-map;actual-mapped-commands' || !Array.isArray(evidence.commands) || evidence.commands.length > 8192) throw fail('Retain the complete bounded mapped preparation stream, including an explicitly empty stream.');
  canonicalDataText(evidence, { maxBytes: 4 * 1048576, maxNodes: 262144 }); signal?.throwIfAborted();
  const plan = prepareEffectGraphRevision(profile.mechanism.graph, { sampleRate }), graphHash = await effectGraphHash(plan), node = plan.nodes.find(row => row.id === profile.mechanism.nodeId), bodyProfile = node.membrane || node.network,
    executionEpoch = 'private-surface:' + source.worldId + ':' + source.generation, route = { ownerRouteRevision: 1, graphDefinitionHash: graphHash },
    identity = await preparedBodyIdentity({ documentEpoch: 'scene-rehearsal:' + source.sceneHash, executionEpoch, worldId: source.worldId, generation: source.generation, surfaceId: profile.surface.id, surfaceRevision: profile.surface.revision, surfaceMap: profile.surface.surfaceMap,
      owner: 'scene-rehearsal-body', ownerGeneration: 0, ...route, nodeId: node.id, processorRevision: bodyProfile.revision }),
    body = { ...identity, active: true, sampleRate, preparationKinds: profile.finite ? ['touch', 'pickup-left', 'pickup-right'] : [...(node.network.lossMasks.length ? ['mode-loss'] : []), ...(node.network.pickupGrid ? ['pickup-left', 'pickup-right'] : [])],
      pulses: (node.membrane?.pulses || []).map(({ milliseconds, frames }) => ({ milliseconds, frames })), lossMasks: (node.network?.lossMasks || []).map((mask, index) => ({ id: mask.id, index, target01: 0, pendingFuture: false })), pickupGrid: node.network?.pickupGrid ? { id: node.network.pickupGrid.id, controls: {} } : null },
    timing = createCausalRenderTiming({ boundary: { state: { sourceTimeMs: source.sourceTimeMs } }, finalBoundaryState: { sourceTimeMs: source.sourceTimeMs + source.durationSeconds * 1000 } }, sampleRate), events = [], ids = new Set();
  const frameFor = value => { const time = value.scoreTime?.sourceTimeMs; if (!Number.isFinite(time) || time < source.sourceTimeMs || time > source.sourceTimeMs + source.durationSeconds * 1000) throw fail('A mapped surface event lies outside the complete private prefix.'); return timing.frameFor(value); };
  let priorTick = -1, priorSequence = -1;
  for (const raw of evidence.commands) {
    const command = validateMappedBodyPreparation(raw), surface = profile.surface, map = surface.surfaceMap;
    if (command.worldId !== source.worldId || command.generation !== source.generation || command.surfaceId !== surface.id || command.mappingRevision !== surface.revision || command.mapId !== map.id || command.mapRevision !== map.revision || command.boundTopologyRevision !== map.boundTopologyRevision || command.sourceEditRevision !== map.sourceEditRevision ||
        command.sourceTick < 1 || command.sourceTick > source.ticks || command.sourceTick < priorTick || command.sourceSequence < priorSequence || ids.has(command.commandId)) throw fail('The preparation stream changed its map, execution, canonical order or fact identity.');
    ids.add(command.commandId); priorTick = command.sourceTick; priorSequence = command.sourceSequence;
    events.push({ kind: 'preparation', frame: frameFor(command), sequence: command.sourceSequence, command });
    if (events.length % 128 === 0) { signal?.throwIfAborted(); await yieldControl(); }
  }
  let token = 0;
  for (const intent of source.intents) {
    if (intent.kind !== 'begin') continue;
    if (intent.worldId !== source.worldId || intent.generation !== source.generation) throw fail('An exciter differs from its private physical execution.');
    if (profile.finite) { const strike = planPreparedBodyStrike(intent, body, frameFor(intent), ++token); events.push({ kind: 'strike', frame: strike.command.frame, sequence: intent.articulationState.contactCoordinate.sourceSequence, strike }); }
    else if (intent.route !== 'local') throw fail('An authored bar requires its actual local exciter source.');
  }
  events.sort((a, b) => a.frame - b.frame || a.sequence - b.sequence || (a.kind === b.kind ? 0 : a.kind === 'strike' ? -1 : 1));
  const scheduleHash = await hashData(events, { maxBytes: 8 * 1048576, maxNodes: 524288 }); signal?.throwIfAborted();
  return { profile, plan, graphHash, body, executionEpoch, route, events, scheduleHash, frameFor, sourceOnsets: source.intents.filter(intent => intent.kind === 'begin').length };
}
export async function renderScenePreparedSurfaceRehearsal({ prepared, left, right, sourceFrames, outputFrames, signal, yieldControl = async () => {} }) {
  const { profile, body, route, executionEpoch, events, plan } = prepared, nodeId = profile.mechanism.nodeId, graph = await createOwnedEffectGraphKernel({ definition: profile.mechanism.graph, sampleRate: plan.sampleRate });
  if (graph.hash !== prepared.graphHash || outputFrames > left.length || outputFrames > right.length || sourceFrames < 1 || outputFrames <= sourceFrames) throw fail('The shared body differs from its admitted output interval or processing identity.');
  const owner = createPreparedSurfaceBodyOwner({ documentEpoch: body.documentEpoch, inventory: () => [body], toFrame: scoreTime => prepared.frameFor({ scoreTime }),
    apply(id, values, frame) { if (frame !== graph.frame) throw fail('The preparation missed its exact owned render frame.'); const receipt = graph.update(id, values); return { ...receipt, status: 'accepted', targetFrame: frame }; },
    panicBody() { graph.panic(); return { status: 'accepted' }; } });
  const sourceBindings = sceneEffectSourceBindings({ plan }, []), sampler = createEffectSourceSampler(sourceBindings, [], []);
  let cursor = 0, controls = 0, strikes = 0;
  try {
    await owner.bind({ surfaceId: body.surfaceId, surfaceRevision: body.surfaceRevision, surfaceMap: body.surfaceMap, nodeId, preparationKinds: body.preparationKinds, lossMaskIds: body.lossMasks.map(mask => mask.id), executionEpoch, worldId: body.worldId, generation: body.generation, expected: route });
    for (let first = 0; first < outputFrames; first += 4096) {
      signal?.throwIfAborted(); const end = Math.min(outputFrames, first + 4096);
      for (let frame = first; frame < end; frame++) {
        while (cursor < events.length && events[cursor].frame <= frame) {
          const event = events[cursor++]; if (event.frame !== frame) throw fail('A private body event missed its original frame.');
          if (event.kind === 'strike') { graph.enqueueBodyStrike(nodeId, event.strike.command); strikes++; }
          else { const receipt = owner.consume(event.command, executionEpoch); if (receipt.status !== 'accepted') throw fail('A real mapped preparation was declined: ' + receipt.reason); controls++; }
        }
        const sourceLeft = frame < sourceFrames ? Math.fround(left[frame]) : 0, sourceRight = frame < sourceFrames ? Math.fround(right[frame]) : 0; graph.sample(sourceLeft, sourceRight, sampler.fill(sourceLeft, sourceRight, frame), sampler.present); left[frame] = graph.leftSample; right[frame] = graph.rightSample;
      }
      graph.assertHealthy(); await yieldControl();
    }
    const health = graph.diagnostics(), bodyState = (profile.finite ? health.membraneStates : health.sympatheticStates)[0];
    if (cursor !== events.length || !bodyState || bodyState.faults || bodyState.muted || profile.finite && (bodyState.strikes.applied !== strikes || bodyState.strikes.ended !== strikes || bodyState.strikes.rejected || bodyState.strikes.queued || bodyState.strikes.activeExciters)) throw fail('The private shared body faulted or omitted a finite source/control.');
    return freezeData({ kind: 'observed-prepared-surface', sourceBindings, geometryPolicy: body.surfaceMap.geometryPolicy || 'source-topology-bound', strategy: profile.strategy, bodyCount: 1, modeCount: profile.modeCount, graphHash: graph.hash, bodyInstanceId: body.bodyInstanceId,
      surfaceId: body.surfaceId, surfaceRevision: body.surfaceRevision, mapId: body.surfaceMap.id, mapRevision: body.surfaceMap.revision, scheduleHash: prepared.scheduleHash, sourceOnsets: prepared.sourceOnsets,
      finiteStrikes: strikes, preparationCommands: controls, semanticOnsetsAdded: 0, faults: bodyState.faults, sourceFrames, tailFrames: plan.maximumTailFrames,
      tailPolicy: 'hold-last-observed-preparation;declared-body-tail;panic-at-deadline', historicalPerformanceEvidence: false, acousticReceipt: false, applicationEvidence: 'exact-frame-owned-offline-kernel;not-live-processor-acknowledgement' });
  } finally { try { owner.dispose(); } finally { graph.panic(); } }
}
