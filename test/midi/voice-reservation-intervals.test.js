import { expect } from 'chai';
import { pendingReservationConflicts } from '../../js/midi/scheduler/VoiceReservationIntervals.js';

const voice = (token, start, end = start, extra = {}) => Object.freeze({ token, startedAt: start, offTimeMs: end, hasStarted: false, ...extra });

describe('pending voice reservation intervals', () => {
  it('supersedes overlapping queued reservations while retaining adjacent and later intervals', () => {
    const incoming = voice(4, 0, 200), entries = [voice(1, 100, 150), voice(2, 200, 250), voice(3, 300), incoming];
    expect(pendingReservationConflicts(entries.values(), incoming, 1)).to.deep.equal([1]);
    expect(entries.map(entry => entry.token)).to.deep.equal([1, 2, 3, 4]);
  });

  it('counts simultaneous intervals rather than the total queued population', () => {
    const incoming = voice(4, 0, 500), entries = [voice(1, 100, 200), voice(2, 200, 300), voice(3, 300, 400), incoming];
    expect(pendingReservationConflicts(entries.values(), incoming, 2)).to.deep.equal([]);
    expect(pendingReservationConflicts([voice(1, 100, 300), voice(2, 200, 400), incoming], incoming, 2)).to.deep.equal([1]);
  });

  it('treats held reservations as open ended and applies the track bound independently', () => {
    const incoming = voice(4, 0, 0, { trackId: 'lead' });
    const entries = [voice(1, 100, 200, { trackId: 'bass' }), voice(2, 300, 400, { trackId: 'lead' }), incoming];
    expect(pendingReservationConflicts(entries.values(), incoming, 4, 1)).to.deep.equal([2]);
  });

  it('never selects sounding voices and deterministically breaks same-time ties by token', () => {
    const incoming = voice(4, 0), entries = [voice(3, 100), voice(2, 100), voice(1, 0, 0, { hasStarted: true }), incoming];
    expect(pendingReservationConflicts(entries.values(), incoming, 2)).to.deep.equal([2, 3]);
  });
});
