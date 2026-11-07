import { expect } from 'chai';
import { singleSampleMap } from '../helpers/sampleMap.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { planCausalSourceRender } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { sampleRegionRate, nativeSampleReleaseFrames } from '../../js/app/midi-ui/NativeSamplePlan.js';

const hash = 'a'.repeat(64);
const intent = (kind, ms, voiceId = 'voice-a', extra = {}) => ({ version: 1, kind, intentId: voiceId + ':' + kind, voiceId, onsetId: voiceId,
  generation: 1, worldId: 'world', actorId: voiceId, laneId: 0, sampleKitId: 'kit', sourceEventIds: [], pitch: { cents: 6000 }, velocity01: 0.6,
  expression: {}, scoreTime: { sourceTimeMs: ms, subTick: 0 }, ...extra });
const request = async intents => ({ descriptor: (await describeNativeInstrumentEngines([{ engineId: 'native-sample', engineVersion: 1, artifactHash: 'b'.repeat(64) }]))[0],
  definition: { schemaVersion: 2, id: 'sample-fixture', revision: 1, name: 'Sample fixture', author: 'fixture', tags: [], engineId: 'native-sample', engineVersion: 1,
    parameters: { releaseSeconds: 0.04 }, sampleRefs: [{ id: 'fixture-sample', sha256: hash, bytes: 64044, required: true }], sampleMap: singleSampleMap(hash, { frames: 32000 }),
    modulations: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 1, steal: 'reject' }, mix: { gain01: 0.5, pan01: 0 } },
  nativeAssets: [{ isActive: () => true, ref: { contentHash: hash, sourceSampleRate: 32000, frames: 32000, channels: 1 } }],
  revoice: { operation: 'sound-only-revoice', version: 1, takeId: 'take:sample', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null,
    sourceVersions: {}, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [] } },
    finalBoundaryState: { sourceTimeMs: 1000 }, intents }, sampleRate: 48000, endSeconds: 1 });

describe('mapped native sample causal planning (not PCM qualification)', () => {
  it('does not allocate a slot to a same-frame choke loser in reverse captured order', async () => {
    const input = await request([intent('begin', 100, 'voice-z'), intent('begin', 100, 'voice-a'), intent('end', 700, 'voice-z'), intent('end', 800, 'voice-a')]);
    const plan = await planCausalSourceRender(input);
    expect(plan.peakVoices).to.equal(1);
    const silent = [...plan.voices.values()].filter(voice => voice.silentChoke); expect(silent).to.have.length(1);
    expect(plan.events.some(event => event.voice === silent[0])).to.equal(false);
  });

  it('uses source frames and the selected onset ratio for one-shot hold across output rates', async () => {
    const input = await request([intent('begin', 100), intent('end', 150, 'voice-a', { terminationReason: 'one-shot' })]);
    for (const sampleRate of [44100, 48000, 96000]) {
      const plan = await planCausalSourceRender({ ...input, sampleRate, tail: { mode: 'bounded-natural', maxSeconds: 4 } }), voice = [...plan.voices.values()][0];
      expect(voice.samplePlan.rateRatio).to.equal(1); expect(voice.articulation.oneShotTailSeconds).to.equal(1);
      expect(voice.releaseAt).to.equal(Math.round(0.1 * sampleRate) + sampleRate);
      expect(voice.end - voice.releaseAt).to.be.closeTo(0.04 * sampleRate, 1e-8);
    }
  });
  it('preflights same-kit chokes while rejecting an over-capacity unrelated kit', async () => {
    const input = await request([intent('begin', 100), intent('begin', 300, 'voice-b'), intent('end', 700), intent('end', 800, 'voice-b')]);
    const plan = await planCausalSourceRender(input), [a, b] = [...plan.voices.values()];
    expect(plan.peakVoices).to.equal(1); expect(a.chokeFrame).to.equal(b.start); expect(a.end).to.equal(b.start + 240);
    input.revoice.intents[1] = { ...input.revoice.intents[1], sampleKitId: 'other-kit' };
    let error; try { await planCausalSourceRender(input); } catch (value) { error = value; }
    expect(error.code).to.equal('intent-voice-capacity');
  });
  it('bounds release child tails using the slowest captured rate and rejects a zone leaving its source', async () => {
    const input = await request([intent('begin', 100), intent('update', 200, 'voice-a', { expression: { pitchOffsetCents: -600 } }), intent('end', 500)]);
    const zone = input.definition.sampleMap.zones[0]; zone.releaseRegion = { assetHash: hash, onsetFrame: 16000, endFrame: 32000, rootCents: 6000,
      gain01: 0.5, tuningCents: 0, pitchRange: { minCents: 5400, maxCents: 6600, maxTransposeCents: 600 } };
    const plan = await planCausalSourceRender({ ...input, tail: { mode: 'bounded-natural', maxSeconds: 4 } }), voice = [...plan.voices.values()][0];
    expect(voice.end - voice.releaseAt).to.be.closeTo(nativeSampleReleaseFrames(voice.samplePlan, 0.04, 48000), 1e-8);
    expect(voice.end - voice.releaseAt).to.be.greaterThan(24000);
    zone.endFrame = 32001; let error; try { await planCausalSourceRender(input); } catch (value) { error = value; }
    expect(error.code).to.equal('sample-material-preflight');
  });
  it('uses relative source pitch rather than oscillator Nyquist admission and rejects unsupported transposition', () => {
    const region = { rootCents: -24000, tuningCents: 0, pitchRange: { minCents: -24000, maxCents: -23400 } };
    expect(sampleRegionRate(region, { cents: -24000 })).to.equal(1);
    expect(sampleRegionRate(region, { cents: -24000 }, 601)).to.equal(null);
  });
});
