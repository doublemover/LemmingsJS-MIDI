import { cloneData } from '../../core/CanonicalData.js';
import { createQuarryEcho, createQuarryDuck, createQuarryTape, createQuarryTapeSpring, createQuarryBody, validateOwnerEffectRack } from '../../midi/content/DubQuarryRack.js';
import { prepareEffectRenderPlan } from './EffectRenderPlan.js';

export function prepareCausalEffectSelection({ preset = 'none', send01 = 0.35, includeReturn = true, rack = null, sampleRate = 48000 } = {}) {
  if (!['none', 'quarry-echo', 'quarry-duck', 'quarry-tape', 'quarry-tape-spring', 'quarry-hollow-spring', 'quarry-stone-courtyard', 'quarry-crossed-gallery', 'saved-owner', 'captured-controls'].includes(preset) || !Number.isFinite(send01) || send01 < 0 || send01 > 0.65 || typeof includeReturn !== 'boolean') throw new TypeError('Choose a bounded authored render effect and source send.');
  if (preset === 'captured-controls') return Object.freeze({ effectGraph: null, effectReturnNodeIds: Object.freeze([]), capturedEffects: true, includeCapturedReturn: includeReturn });
  if (preset === 'none') return Object.freeze({ effectGraph: null, effectReturnNodeIds: Object.freeze([]) });
  let graph;
  if (preset === 'quarry-echo' || preset === 'quarry-tape') graph = (preset === 'quarry-tape' ? createQuarryTape : createQuarryEcho)({ send01 });
  else if (preset === 'quarry-duck') graph = createQuarryDuck({ send01 });
  else if (preset === 'quarry-tape-spring') graph = createQuarryTapeSpring({ send01 });
  else if (['quarry-hollow-spring', 'quarry-stone-courtyard', 'quarry-crossed-gallery'].includes(preset)) graph = createQuarryBody({ bodyId: preset, send01 });
  else {
    const saved = validateOwnerEffectRack(rack);
    if (!saved || saved.bypass !== 'active') throw new Error('Choose active saved rack defaults or a dry render. A bypassed rack is not activated implicitly.');
    graph = cloneData(saved.graph, { maxBytes: 65536, maxNodes: 8192 });
    const send = graph.nodes.find(node => node.id === 'send' && node.kind === 'gain');
    if (!send || !graph.nodes.some(node => node.id === 'return') || send01 > send.parameters.gainMaximum01) throw new Error('The saved graph has no compatible Quarry send/return controls.');
    graph = { ...graph, nodes: graph.nodes.map(node => node === send ? { ...node, parameters: { ...node.parameters, gain01: send01 } } : node) };
  }
  const returns = Object.freeze(includeReturn ? ['return'] : []), plan = prepareEffectRenderPlan(graph, sampleRate, returns, { nativeConvolution: true, nativeOwnedProcessors: true });
  return Object.freeze({ effectGraph: plan.definition, effectReturnNodeIds: returns });
}
