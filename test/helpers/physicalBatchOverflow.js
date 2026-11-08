import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';
import { hashSurveyValue } from '../../js/app/procgen/survey/ProcgenSurveyCanonical.js';

export const physicalOverflowGraph = { version: 1, revision: 1, instruments: [{ id: 'held-blocker', sourceKind: 'ActionEntered', action: 'blocking', pitchCents: 6000, velocity01: 0.75, role: 'percussion', route: 'local' }] };
export function observePhysicalOverflow(batch, engine) {
  const intents = engine.processBatch(batch), state = engine.diagnostics();
  return { tick: batch.tick, actors: batch.snapshot?.actors.length ?? null, completeness: batch.completeness,
    facts: batch.facts.length, factsHash: hashSurveyValue(batch.facts), snapshotHash: hashSurveyValue(batch.snapshot), activeVoices: state.activeVoices, recoveryRequired: state.recoveryRequired,
    intents: intents.map(({ kind, voiceId, terminationReason }) => ({ kind, voiceId, terminationReason: terminationReason ?? null })) };
}
export function physicalBatchOverflow({ actorCount, masks = null, onBatch = () => {}, onRearm = () => {} } = {}) {
  if (![1024, 1025].includes(actorCount)) throw new Error('Choose a declared dense physical boundary.');
  const world = new ProcgenLaneWorld({ masks, laneCount: 1, assists: false, maxActors: actorCount });
  const engine = createCausalMusicEngine({ getGraph: () => physicalOverflowGraph }), rows = [];
  const observe = batch => {
    rows.push(observePhysicalOverflow(batch, engine)); onBatch(batch);
  };
  world.soundEvents.onBatch.on(observe);
  try {
    const held = world.actors[0]; held.y = world.surfaceAt(0, held.x) - 1; held.setAction(world.actions[State.BLOCKING]); world.step(20);
    const extra = [];
    while (world.actors.length < actorCount) {
      const actor = world._spawn(0, false); actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8; extra.push(actor);
    }
    world.step(40);
    for (const actor of extra) actor.remove(); world.step(60);
    const rearm = engine.rearm({ discardUnknownHeldState: true }); onRearm(rearm);
    held.setAction(world.actions[State.WALKING]); held.setAction(world.actions[State.BLOCKING]); world.step(80);
    return { actorCount, rows: rows.slice(), rearm, limits: { facts: world.soundEvents._maxFacts, terminalFacts: world.soundEvents._maxTerminalFacts }, listenerErrors: world.soundEvents.deliveryErrors };
  } finally { world.soundEvents.onBatch.off(observe); engine.dispose(); world.dispose(); }
}
