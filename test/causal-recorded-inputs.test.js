import { expect } from 'chai';
import { validateRecordedCausalInput, validateRecordedCausalTimeline } from '../js/app/procgen/workstation/CausalRecordedInputs.js';

describe('recorded causal input schema', () => {
  const validate = (input, replay = 2) => validateRecordedCausalInput(input, replay);
  const refused = work => { let failure; try { work(); } catch (error) { failure = error; } expect(failure?.code).to.equal('unsupported-recorded-input'); };
  it('preserves supported legacy controls and versioned pause clocks', () => {
    for (const input of [{ version: 1, kind: 'world-speed', speedFactor: 0.5 }, { version: 1, kind: 'transport-state', playing: false },
      { version: 2, kind: 'transport-state', playing: false, speedFactor: 0 }, { version: 1, kind: 'intervention-cancel', commandId: 'pending' },
      { version: 1, kind: 'instrument-performance', change: {} }, { version: 1, kind: 'physical-feedback-boundary', commands: [] }]) expect(validate(input)).to.equal(input);
    refused(() => validate({ version: 2, kind: 'transport-state', playing: true, speedFactor: 1 }, 1));
  });
  it('refuses unknown fields and unsupported control versions before an effect', () => {
    for (const input of [null, [], {}, { version: 3, kind: 'transport-state' }, { version: 1, kind: '__proto__' },
      { version: 1, kind: 'world-speed', speedFactor: -1 }, { version: 1, kind: 'world-speed', speedFactor: Infinity },
      { version: 1, kind: 'world-speed', speedFactor: 1, future: true }, { version: 1, kind: 'transport-state', playing: 1 },
      { version: 1, kind: 'transport-state', playing: true, speedFactor: 1 }, { version: 2, kind: 'transport-state', playing: true, speedFactor: -1 },
      { version: 1, kind: 'intervention-cancel', commandId: '' }]) refused(() => validate(input));
  });
  it('retains observation-only source bytes without reading a device or substituting timing', () => {
    const input = { version: 1, kind: 'external-observation', sourceId: 'port', effect: 'observation-only', timestamp: 12.5, bytes: [0, 127, 128, 255] };
    expect(validate(input)).to.equal(input);
    expect(validate({ version: 1, kind: 'external-observation', sourceId: 'clock', effect: 'observation-only' })).to.have.property('sourceId', 'clock');
    for (const change of [{ sourceId: '' }, { effect: 'mutate-world' }, { timestamp: 'now' }, { timestamp: NaN }, { timestamp: Number.MAX_SAFE_INTEGER + 1 },
      { bytes: [-1] }, { bytes: [256] }, { bytes: [1.5] }, { bytes: ['1'] }, { bytes: new Uint8Array(1) }, { bytes: Array(65537).fill(0) }]) refused(() => validate({ ...input, ...change }));
  });
  it('requires the explicit supported tempo payload', () => {
    const tempo = { version: 1, kind: 'tempo', bpm: 91.25 }; expect(validateRecordedCausalTimeline(tempo)).to.equal(tempo);
    for (const change of [{ version: 2 }, { kind: 'clock' }, { bpm: 0 }, { bpm: NaN }, { bpm: 1000001 }, { future: true }]) refused(() => validateRecordedCausalTimeline({ ...tempo, ...change }));
  });
});
