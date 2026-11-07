import { expect } from 'chai';
import { copyCausalIntentLineage, explainCausalIntentLineage } from '../js/app/procgen/workstation/CausalIntentLineage.js';

describe('bounded producer time and voice lineage', () => {
  const value = () => ({ onsetId: 'onset', actionInstanceId: 'action', terminationReason: 'voice-transfer', scoreTime: { epoch: 'epoch', simTick: 42, subTick: 0.25, beat: 3.125, precision: 'interpolated', sourceTimeMs: 1680, sourceTickDurationMs: 40 },
    articulationState: { transfer: { policy: 'revoice', previousLaneId: 0, laneId: 1, sourceEventId: 'transfer', previousVoiceId: 'voice' } }, voiceTransition: { kind: 'crossfade', seconds: 0.2, fromVoiceId: 'voice', fromActionInstanceId: 'a', toActionInstanceId: 'b' } });
  const batch = { completeness: { status: 'partial', dropped: 4 } };
  it('copies exact producer values without keeping mutable references or sampling the current transport', () => {
    const input = value(), copied = copyCausalIntentLineage(input, batch); expect(copied.scoreTime).to.deep.equal(input.scoreTime); expect(copied.transfer).to.deep.equal(input.articulationState.transfer); expect(copied.voiceTransition).to.deep.equal(input.voiceTransition);
    input.scoreTime.beat = 100; input.articulationState.transfer.laneId = 7; input.voiceTransition.fromVoiceId = 'reused'; expect(copied.scoreTime.beat).to.equal(3.125); expect(copied.transfer.laneId).to.equal(1); expect(copied.voiceTransition.fromVoiceId).to.equal('voice');
    expect(Object.isFrozen(copied)).to.equal(true); for (const key of ['scoreTime', 'transfer', 'voiceTransition', 'sourceCoverage']) expect(Object.isFrozen(copied[key])).to.equal(true);
    const text = explainCausalIntentLineage(copied).join('\n'); expect(text).to.include('beat 3.125; precision interpolated').and.include('termination voice-transfer').and.include('previous voice voice').and.include('reports 4 dropped facts').and.include('Applied crossfade/render evidence remains separate');
  });
  it('keeps absent or invalid producer fields unknown instead of inventing tick/beat/voice values', () => {
    expect(copyCausalIntentLineage({}, {}).scoreTime).to.equal(null); const input = value(); input.scoreTime = { epoch: 'x'.repeat(513), simTick: -1, subTick: 1, beat: Infinity, precision: 'x'.repeat(1000), sourceTimeMs: NaN, sourceTickDurationMs: 0 }; input.articulationState.transfer = { policy: 'x'.repeat(1000), previousLaneId: -1, laneId: Infinity }; input.voiceTransition = { seconds: -1, fromVoiceId: {} };
    const copied = copyCausalIntentLineage(input, { completeness: { dropped: -1 } }); expect(copied.scoreTime).to.include({ epoch: null, simTick: null, subTick: null, beat: null, sourceTimeMs: null, sourceTickDurationMs: null }); expect(copied.scoreTime.precision).to.have.length(160); expect(copied.transfer).to.include({ previousLaneId: null, laneId: null, previousVoiceId: null }); expect(copied.voiceTransition).to.include({ seconds: null, fromVoiceId: null });
    expect(explainCausalIntentLineage(copyCausalIntentLineage({}, {})).join('\n')).to.include('epoch unrecorded').and.include('beat unknown').and.include('producer reports unknown dropped facts');
  });
});
