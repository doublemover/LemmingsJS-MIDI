import { validateOwnerEffectRack } from '../../../midi/content/DubQuarryRack.js';
import { prepareEffectRenderPlan } from '../../midi-ui/EffectRenderPlan.js';

export const SCENE_EFFECT_RACK_REQUIREMENT = 'owned-static-scene-delay-rack';

export function prepareSceneEffectRack(raw, sampleRate = 48000) {
  const rack = validateOwnerEffectRack(raw);
  if (!rack || rack.bypass !== 'active') throw new TypeError('Scene effects require an explicitly active saved rack; audio activation remains separate.');
  const plan = prepareEffectRenderPlan(rack.graph, sampleRate);
  if (plan.nodes.some(node => !['bus-in', 'bus-out', 'gain', 'feedback-delay'].includes(node.kind)) || plan.latencyFrames !== 0 || !Number.isSafeInteger(plan.maximumTailFrames) || plan.maximumTailFrames < 0 || plan.maximumTailFrames > sampleRate * 30 || !Number.isSafeInteger(plan.stateBytes) || plan.stateBytes < 0 || plan.stateBytes > 16 * 1048576) throw new TypeError('This scene rack supports owned gain/delay nodes, zero added latency and at most thirty seconds of declared tail.');
  return Object.freeze({ rack, plan, previewTailFrames: Math.min(plan.maximumTailFrames, sampleRate * 4) });
}
