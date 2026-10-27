import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { describeMidiRoute, createMidiRouteDiagnostics } from '../../js/app/procgen/workstation/MidiRouteDiagnostics.js';
import { TestDocument } from '../helpers/test-dom.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const snapshot = (route = {}, extra = {}) => ({ midi: { noteOutputId: 'zone', outputRoutes: [{ outputId: 'zone', name: 'Receiver', authorized: true, available: true, active: true, ...route }] }, output: { selectedBackend: 'midi', enabled: true }, ...extra });
const mpe = { enabled: true, masterChannel: 1, memberChannels: [2], voicePolicy: 'reject' };
describe('MIDI route configuration evidence', () => {
  it('shows actual manual and submitted-zone API evidence without implying receiver acknowledgement', () => {
    withFakeClockAndPerformance(() => {
      for (const configuration of ['manual', 'send-zone']) {
        const calls = [], scheduler = new MidiScheduler({ mpe: { ...mpe, configuration } });
        try {
          scheduler.setOutput(makeOutput([1, 2], calls, 'zone'));
          const route = scheduler.getOutputRouteState('zone');
          const described = describeMidiRoute(snapshot(route, { mpe }));
          expect(described.state).to.equal('mpe-ready'); expect(described.details).to.include('receiver unverified');
          expect(described.details).to.include(configuration === 'manual' ? 'Manual zone assumed' : 'Zone setup messages accepted');
          expect(described.details).to.include('Manager 1; members 2; reserved channels');
          expect(described.details).to.include('members 48, manager 2 semitones'); expect(described.details).to.include('reject the new voice');
          expect(route.mpeZone.verified).to.equal(false);
        } finally { scheduler.dispose(); }
      }
    });
  });
  it('shows an actual setup refusal and never labels the refused member as ready', () => {
    withFakeClockAndPerformance(() => {
      const scheduler = new MidiScheduler({ mpe }), port = makeOutput([1, 2], [], 'zone');
      port.channels[2].sendPitchBendRange = () => false;
      try {
        scheduler.setOutput(port); const result = describeMidiRoute(snapshot(scheduler.getOutputRouteState('zone'), { mpe }));
        expect(result.state).to.equal('rejected'); expect(result.summary).to.include('MIDI setup rejected');
        expect(result.details).to.include('no acceptance evidence'); expect(scheduler.sendNote({ note: 60 })).to.equal(false);
      } finally { scheduler.dispose(); }
    });
  });
  it('identifies the explicitly selected lane output and its reserved channels', () => {
    const source = snapshot({ mpeZone: { zone: 'lower', managerChannel: 1, memberChannels: [2], reservedChannels: [10] }, mpeReady: true });
    source.midi.outputRoutes.push({ outputId: 'lane', available: false, name: 'Lane receiver', activationFailure: 'reserved-mpe-channel' });
    const result = describeMidiRoute({ ...source, outputId: 'lane', mpe });
    expect(result.summary).to.include('reserved mpe channel'); expect(result.details).to.include('Destination: Lane receiver');
    expect(describeMidiRoute(source).details).to.include('reserved channels 10');
  });
  it('retains the applied route evidence while clearly rejecting a requested replacement', () => {
    const source = snapshot({ mpeEvidence: 'manual-zone-api-accepted', mpeZone: { zone: 'upper', managerChannel: 16, memberChannels: [15], voicePolicy: 'steal-oldest' } }, { mpe });
    source.midi.lastConfigurationFailure = { reason: 'empty-mpe-zone', retained: true };
    const result = describeMidiRoute(source);
    expect(result.state).to.equal('rejected'); expect(result.summary).to.include('empty mpe zone');
    expect(result.details).to.include('previous route configuration is retained'); expect(result.details).to.include('Manager 16; members 15');
    expect(result.details).to.include('release the oldest member before replacement');
  });
  it('does not invent shared fallback when MPE is requested but has no admitted zone', () => {
    const result = describeMidiRoute(snapshot({}, { mpe })); expect(result.state).to.equal('setup-pending');
    expect(result.summary).to.include('no admitted member zone'); expect(result.summary).to.include('no automatic shared-channel fallback');
  });
  it('keeps an invalid zone and reserved-channel diagnostics visible before a destination is connected', () => {
    const result = describeMidiRoute({ midi: { mpeZone: { ok: false, reason: 'empty-mpe-zone', managerChannel: 1, memberChannels: [], reservedChannels: [10] } }, output: { selectedBackend: 'midi', enabled: false }, mpe });
    expect(result.state).to.equal('off'); expect(result.details).to.include('Configuration diagnostic: empty mpe zone');
    expect(result.details).to.include('members none; reserved channels 10'); expect(result.details).to.include('receiver unverified');
  });
  it('distinguishes explicit shared channel expression, unavailable ports, off routing and local preview', () => {
    expect(describeMidiRoute(snapshot()).summary).to.include('whole channel');
    expect(describeMidiRoute(snapshot({ authorized: false, state: 'discovered' })).summary).to.include('no new note admission');
    expect(describeMidiRoute(snapshot({}, { outputId: 'missing' })).state).to.equal('unavailable');
    expect(describeMidiRoute(snapshot({}, { output: { selectedBackend: 'midi', enabled: false } })).state).to.equal('off');
    expect(describeMidiRoute(snapshot({}, { output: { selectedBackend: 'synth', enabled: true } })).summary).to.equal('Browser preview on; MIDI note routing disabled.');
  });
  it('updates inline evidence without replacing focused policy controls or silently invoking a fallback', () => {
    const document = new TestDocument(), policies = [], view = createMidiRouteDiagnostics({ document, onPolicy: value => policies.push(value) });
    document.body.append(view.element); const controls = view.element.children[2], shared = controls.children[2];
    shared.focus(); view.update(snapshot({}, { mpe })); view.update(snapshot({ mpeFailure: 'empty-mpe-zone' }, { mpe }));
    expect(document.activeElement).to.equal(shared); expect(policies).to.deep.equal([]);
    expect(view.element.dataset.state).to.equal('rejected'); expect(shared.hidden).to.equal(false);
    shared.dispatchEvent({ type: 'click' }); expect(policies).to.deep.equal(['shared']);
    view.update(snapshot()); expect(shared.hidden).to.equal(true); expect(controls.children[3].hidden).to.equal(false);
    view.dispose(); shared.dispatchEvent({ type: 'click' }); expect(policies).to.deep.equal(['shared']); expect(view.update(snapshot())).to.equal(null);
  });
});
