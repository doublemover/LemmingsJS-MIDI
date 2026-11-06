import { validateOwnerEffectRack } from '../../../midi/content/DubQuarryRack.js';
import { prepareEffectRenderPlan } from '../../midi-ui/EffectRenderPlan.js';

export const SCENE_EFFECT_RACK_REQUIREMENT = 'owned-static-scene-delay-rack';
export const SCENE_NATIVE_RACK_REQUIREMENT = 'native-static-scene-convolution-rack';
export const SCENE_EFFECT_RACK_REQUIREMENTS = Object.freeze([SCENE_EFFECT_RACK_REQUIREMENT, SCENE_NATIVE_RACK_REQUIREMENT]);

export function prepareSceneEffectRack(raw, sampleRate = 48000) {
  const rack = validateOwnerEffectRack(raw);
  if (!rack || rack.bypass !== 'active') throw new TypeError('Scene effects require an explicitly active saved rack; audio activation remains separate.');
  const native = rack.graph.nodes.some(node => node.kind === 'convolution-native');
  const plan = prepareEffectRenderPlan(rack.graph, sampleRate, [], { nativeConvolution: native, nativeOwnedProcessors: native });
  if (plan.nodes.some(node => !['bus-in', 'bus-out', 'gain', 'feedback-delay', 'envelope-detector', 'envelope-mapping', 'modulated-gain', 'nonlinear-chain', ...(native ? ['convolution-native'] : [])].includes(node.kind)) ||
      !(native && plan.latencyFrames === null || Number.isSafeInteger(plan.latencyFrames) && plan.latencyFrames >= 0 && plan.latencyFrames <= 2048) ||
      !Number.isSafeInteger(plan.maximumTailFrames) || plan.maximumTailFrames < 0 || plan.maximumTailFrames > sampleRate * 30 ||
      !Number.isSafeInteger(plan.stateBytes) || plan.stateBytes < 0 || plan.stateBytes > 16 * 1048576 ||
      native && (plan.impulseCount > 2 || plan.impulseDecodedBytes > 16 * 1048576 || plan.nativeNodeEstimateBytes > 32 * 1048576))
    throw new TypeError('This scene rack needs supported echo/duck/tape/body nodes, bounded declared latency and thirty seconds of admitted tail.');
  return Object.freeze({ rack, plan, native, requirementId: native ? SCENE_NATIVE_RACK_REQUIREMENT : SCENE_EFFECT_RACK_REQUIREMENT, previewTailFrames: Math.min(plan.maximumTailFrames, sampleRate * 4) });
}
