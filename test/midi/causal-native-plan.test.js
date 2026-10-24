import { expect } from 'chai';
import { planCausalSourceRender } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { CAUSAL_RENDER_SOURCES } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

const intent = (kind, milliseconds, worldId = 'world-a') => ({ version: 1, kind, intentId: worldId + ':' + kind, voiceId: 'reused-id', generation: 1, actorId: 7,
  worldId, sourceEventIds: [], laneId: worldId, scoreTime: { sourceTimeMs: milliseconds, subTick: 0 }, pitch: { cents: 6000.12345 }, velocity01: 0.6, expression: {} });
const source = intents => ({ operation: 'sound-only-revoice', version: 1, takeId: 'take:native', takeRevision: 1, sourceCanonicalHash: 'b'.repeat(64), sourceState: 'finalized',
  sourceVersions: {}, nextSequence: null, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [] } },
  finalBoundaryState: { sourceTimeMs: 1000, voices: [] }, intents });
const request = async (engineId, intents) => ({ definition: CAUSAL_RENDER_SOURCES.find(entry => entry.id === engineId).definition,
  descriptor: (await describeNativeInstrumentEngines([{ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) }]))[0], revoice: source(intents), endSeconds: 1 });
describe('native causal source preflight', () => {
  it('retains original world and event identities for reused voice IDs and high resolution pitch', async () => {
    const a = intent('begin', 100), b = intent('begin', 100, 'world-b');
    const plan = await planCausalSourceRender(await request('native-oscillator', [a, b, intent('end', 500), intent('end', 500, 'world-b')]));
    expect(plan.peakVoices).to.equal(2); expect(plan.voices.size).to.equal(2);
    expect([...plan.voices.values()].map(voice => voice.begin)).to.deep.equal([a, b]);
    expect([...plan.voices.values()][0].baseFrequency).to.be.closeTo(440 * 2 ** ((6000.12345 - 6900) / 1200), 1e-10);
  });
  it('uses the actual admitted modal body for one-shot hold and fractional release endpoints', async () => {
    const begin = intent('begin', 100), end = { ...intent('end', 150), terminationReason: 'one-shot' }, input = await request('native-modal', [begin, end]);
    input.sampleRate = 44100; input.tail = { mode: 'bounded-natural', maxSeconds: 4 };
    input.definition = { ...input.definition, parameters: { ...input.definition.parameters, releaseSeconds: 0.003013 } };
    const plan = await planCausalSourceRender(input), voice = [...plan.voices.values()][0];
    expect(voice.articulation.oneShotTailSeconds).to.equal(voice.nativeSourcePlan.oneShotHoldSeconds);
    expect(voice.end - voice.releaseAt).to.be.closeTo(0.003013 * 44100, 1e-8);
    expect(Number.isSafeInteger(plan.outputEnd)).to.equal(true);
  });
  it('rejects an unsupported FM bend or sixteen native stereo stems before creating native PCM', async () => {
    const update = { ...intent('update', 200), expression: { pitchOffsetCents: 201 } };
    for (const input of [await request('native-fm', [intent('begin', 100), update, intent('end', 500)]),
      { ...await request('native-oscillator', []), stemLaneIds: Array.from({ length: 16 }, (_, index) => 'lane-' + index) }]) {
      let error; try { await planCausalSourceRender(input); } catch (value) { error = value; }
      expect(error?.name).to.equal('CausalRenderError');
    }
  });
});
