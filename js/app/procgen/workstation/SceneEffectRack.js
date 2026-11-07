import { prepareEffectSourceBindings } from '../../midi-ui/EffectSourceBindings.js';
import { validateOwnerEffectRack } from '../../../midi/content/DubQuarryRack.js';
import { prepareEffectRenderPlan } from '../../midi-ui/EffectRenderPlan.js';

export const SCENE_EFFECT_RACK_REQUIREMENT = 'owned-static-scene-delay-rack';
export const SCENE_NATIVE_RACK_REQUIREMENT = 'native-static-scene-convolution-rack';
export const SCENE_CROSS_RACK_REQUIREMENT = 'owned-static-scene-cross-excitation-rack';
export const SCENE_EFFECT_RACK_REQUIREMENTS = Object.freeze([SCENE_EFFECT_RACK_REQUIREMENT, SCENE_NATIVE_RACK_REQUIREMENT, SCENE_CROSS_RACK_REQUIREMENT]);

export function prepareSceneEffectRack(raw, sampleRate = 48000) {
  const rack = validateOwnerEffectRack(raw);
  if (!rack || rack.bypass !== 'active') throw new TypeError('Scene effects require an explicitly active saved rack; audio activation remains separate.');
  const native = rack.graph.nodes.some(node => node.kind === 'convolution-native');
  const plan = prepareEffectRenderPlan(rack.graph, sampleRate, [], { nativeConvolution: native, nativeOwnedProcessors: native });
  const cross = plan.sidechainInputs.length > 0 || plan.nodes.some(node => ['multiband-vocoder', 'ring-modulator'].includes(node.kind));
  if (native && cross) throw new TypeError('A native reflection rack and external donor/carrier sources need an explicitly composed simultaneous-source profile.');
  if (plan.nodes.some(node => !['bus-in', 'bus-out', 'gain', 'feedback-delay', 'envelope-detector', 'envelope-mapping', 'modulated-gain', 'nonlinear-chain', 'sidechain-in', 'multiband-vocoder', 'ring-modulator', 'mono-to-stereo', 'stereo-to-mono', 'polarity-invert', ...(native ? ['convolution-native'] : [])].includes(node.kind)) ||
      !(native && plan.latencyFrames === null || Number.isSafeInteger(plan.latencyFrames) && plan.latencyFrames >= 0 && plan.latencyFrames <= 2048) ||
      !Number.isSafeInteger(plan.maximumTailFrames) || plan.maximumTailFrames < 0 || plan.maximumTailFrames > sampleRate * 30 ||
      !Number.isSafeInteger(plan.stateBytes) || plan.stateBytes < 0 || plan.stateBytes > 16 * 1048576 ||
      native && (plan.impulseCount > 2 || plan.impulseDecodedBytes > 16 * 1048576 || plan.nativeNodeEstimateBytes > 32 * 1048576))
    throw new TypeError('This scene rack needs supported echo/duck/tape/body nodes, bounded declared latency and thirty seconds of admitted tail.');
  return Object.freeze({ rack, plan, native, cross, requirementId: cross ? SCENE_CROSS_RACK_REQUIREMENT : native ? SCENE_NATIVE_RACK_REQUIREMENT : SCENE_EFFECT_RACK_REQUIREMENT, previewTailFrames: Math.min(plan.maximumTailFrames, sampleRate * 4) });
}

export function sceneEffectSourceBindings(effects, laneIds, voices = []) {
  const bindings = prepareEffectSourceBindings(effects.plan, laneIds, voices);
  if (bindings.routes.length > 8 || bindings.routes.some(route => !route.available || route.sourceBusId === 'voices:selected' || route.sourceBusId !== 'owner' && route.tap !== 'post-fader' || route.layout !== 'audioStereo')) throw new TypeError('This static scene profile needs up to eight exact post-fader stereo lane taps or the declared owner input; selected voices and pre-fader comparisons use separate explicit source schedules.');
  return bindings;
}
