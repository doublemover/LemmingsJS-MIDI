import { prepareEffectGraphRevision } from './EffectGraphRevision.js';
import { freezeData } from '../../core/CanonicalData.js';

export function createGlassHoldRecipe({ sourceBusId = 'owner', tap = 'pre-fader', fftSize = 1024, blur01 = 0.15, pitchRatio = 1, dampingHz = 10000,
  thawSeconds = 0.25, maximumHoldSeconds = 12, wet01 = 0.15, wetOnly = false, revision = 1 } = {}) {
  if (typeof sourceBusId !== 'string' || !/^(?:owner|lane:[a-zA-Z0-9._:-]{1,96})$/.test(sourceBusId) || !['pre-fader', 'post-fader'].includes(tap) ||
      !Number.isFinite(wet01) || wet01 < 0 || wet01 > 0.25 || typeof wetOnly !== 'boolean') throw new TypeError('Choose a same-owner source and bounded freeze return.');
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (a, b) => ({ from: { nodeId: a, port: 'audio' }, to: { nodeId: b, port: 'audio' }, gain01: 1 });
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'swarm-freeze.glass-hold', revision, latencyPolicy: 'preserve-dry', maximumLatencyFrames: 2048, maximumTailSeconds: 20,
    nodes: [node('source', 'bus-in'), node('dry', 'gain', { gain01: wetOnly ? 0 : 1 - wet01, gainMaximum01: 1 }),
      node('capture-source', 'sidechain-in', { sourceBusId, tap, inputLayout: 'audioStereo' }), node('send', 'gain', { gain01: 1, gainMaximum01: 1 }),
      node('freeze', 'spectral-freeze', { fftSize, blur01, pitchRatio, dampingHz, thawSeconds, maximumHoldSeconds }),
      node('return', 'gain', { gain01: wet01, gainMaximum01: 0.25 }), node('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('capture-source', 'send'), edge('send', 'freeze'), edge('freeze', 'return'), edge('return', 'output')] });
  return freezeData({ schema: 'lemmings-swarm-freeze/v1', recipe: 'glass-hold', graph: plan.definition, sourceBusId, tap,
    liveControls: { hold: { nodeId: 'freeze', parameter: 'hold01', values: [0, 1] }, return: { nodeId: 'return', parameter: 'gain01', minimum: 0, maximum: 0.25 } },
    ownership: 'explicit-momentary-or-latch;bounded-hold;thaw-unload-or-Panic-releases',
    material: { portable: false, status: 'transient-spectral-state-not-embedded-in-project', contributingCausalIds: 'not-inferred-from-requested-note-intents' },
    dryPolicy: wetOnly ? 'explicit-wet-only-audition' : 'immediate-dry-not-aligned-to-spectral-return',
    qualification: 'implementation-awaiting-capture-identity-phase-listening-and-browser-cost-qualification' });
}
