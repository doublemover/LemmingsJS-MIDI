import { expect } from 'chai';
import { createProcgenMidiOutput } from '../../js/app/procgen/ProcgenMidiOutput.js';
import { SoundEventBus, SoundEffectIds } from '../../js/game/SoundEvents.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const fixture = (backend = 'midi') => {
  const calls = [], secondCalls = [], outputs = [makeOutput([1], calls, 'first'), makeOutput([1], secondCalls, 'second')]; outputs[0].name = 'First device'; outputs[1].name = 'Second device';
  const listeners = new Map(), webMidi = { enabled: false, outputs, requests: 0,
    async enable(options) { expect(options.sysex).to.equal(false); this.requests++; this.enabled = true; },
    addListener(name, callback) { listeners.set(name, callback); }, removeListener(name) { listeners.delete(name); } };
  const local = { starts: 0, stops: 0, audio: { getState: () => ({ enabled: false }) }, getState: () => ({ enabled: false, status: 'off' }),
    start() { this.starts++; return true; }, stop() { this.stops++; }, suspendGame: () => false, resumeGame: () => false, syncConfig: () => true, setCapture() {}, dispose() {} };
  const makeView = () => {
    const timer = { frameTime: 60, speedFactor: 1, onGameTick: new EventHandler(), getGameTicks: () => 0 };
    const game = { soundEvents: new SoundEventBus(timer), getGameTimer: () => timer };
    return { game, midiPreviewRouter: null, setMidiPreviewRouter(router) { this.midiPreviewRouter?.detach(); this.midiPreviewRouter = router; router?.attach(game.soundEvents, { game }); } };
  };
  let view = makeView();
  const config = { enabled: false, mpe: { enabled: false }, defaultChannel: 1, timing: { scheduleAheadMs: 0 }, position: { mappings: [] },
    sfx: { [SoundEffectIds.SPAWN]: { note: 61, velocity: 90, durationTicks: 2, outputId: 'unrelated-saved-device' } } };
  const output = createProcgenMidiOutput({ local, backend, getView: () => view, getConfig: () => config, getWebMidi: () => webMidi });
  return { output, webMidi, local, calls, secondCalls, config, get view() { return view; }, changeView() { view = makeView(); }, disconnect() { webMidi.outputs = []; listeners.get('disconnected')(); } };
};
describe('procgen selected audible destination', () => {
  it('retains held gates, unsounded phrases and sent history for span/tension edits, with deliberate source-tail cancellation', async () => {
    await withFakeClockAndPerformance(async clock => {
      const f = fixture(), source = f.config.sfx[SoundEffectIds.SPAWN];
      source.notes = [61, 65, 69]; source.durationTicks = 24; source.phrase = { enabled: true, mode: 'up', spacingTicks: 2 };
      f.config.ensemble = { enabled: false, roles: [], tension: { enabled: false, amount: 0.3 } };
      await f.output.start(); f.view.game.soundEvents.emit({ sfxId: SoundEffectIds.SPAWN }); clock.tick(1);
      const router = f.view.midiPreviewRouter, scheduler = router.scheduler;
      expect(scheduler._activeNotes.size).to.equal(1); expect(scheduler.gamePhrases.voices.size).to.equal(1);
      const gate = [...scheduler._activeNotes.values()][0], tail = [...scheduler.gamePhrases.voices.values()][0];
      scheduler.getRateSnapshot();
      const history = scheduler._rateSent.map(entry => ({ ...entry })); expect(history.length).to.be.greaterThan(0);
      const calls = f.calls.length; expect(f.output.syncConfig()).to.equal(false); expect(f.calls.length).to.equal(calls);
      f.config.automationSpans = [{ id: 'velocity-span', enabled: true, target: 'velocity', min: 50, max: 90, span: { domain: 'beats', start: 0, duration: 8, shape: 'ramp' } }];
      f.config.ensemble.tension.amount = 0.7; expect(f.output.syncConfig()).to.equal(true);
      expect([...scheduler._activeNotes.values()][0]).to.equal(gate); expect([...scheduler.gamePhrases.voices.values()][0]).to.equal(tail);
      f.config.automationSpans[0].max = 100;
      expect(f.output.syncConfig()).to.equal(true); expect(router.automationSpans.entries[0].max).to.equal(100);
      expect([...scheduler._activeNotes.values()][0]).to.equal(gate); expect([...scheduler.gamePhrases.voices.values()][0]).to.equal(tail);
      expect(scheduler._rateSent).to.deep.equal(history);
      source.eventPriority = 0; expect(f.output.syncConfig()).to.equal(true);
      expect([...scheduler._activeNotes.values()][0]).to.equal(gate); expect(scheduler._rateSent).to.deep.equal(history);
      expect(scheduler.gamePhrases.voices.size).to.equal(0);
      source.disabled = true; expect(f.output.syncConfig()).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(0); expect(scheduler._rateSent).to.deep.equal(history);
      expect(f.calls.some(call => call.type === 'cc' && call.cc === 120)).to.equal(true); f.output.dispose();
    });
  });

  it('cancels pending permission on suspend and rejects a changed exact game even without a suspension callback', async () => {
    for (const suspend of [true, false]) {
      const f = fixture(); let resolve;
      f.webMidi.enable = () => { f.webMidi.requests++; return new Promise(yes => { resolve = yes; }); };
      const old = f.view, pending = f.output.start();
      if (suspend) expect(f.output.suspendGame()).to.equal(false);
      f.changeView(); f.webMidi.enabled = true; resolve(); expect(await pending).to.equal(false);
      expect(old.midiPreviewRouter).to.equal(null); expect(f.view.midiPreviewRouter).to.equal(null);
      expect(f.output.getState().enabled).to.equal(false); expect(await f.output.resumeGame()).to.equal(false);
      expect(f.output.getState().message).to.include(suspend ? 'canceled' : 'changed');
      expect(await f.output.start()).to.equal(true); expect(f.webMidi.requests).to.equal(1); expect(f.local.starts).to.equal(0); f.output.dispose();
    }
  });

  it('exposes an actual API failure without a state-read side effect, then detaches at the existing status cadence', async () => {
    await withFakeClockAndPerformance(async clock => {
      const f = fixture(), records = [], channel = f.webMidi.outputs[0].channels[1], send = channel.sendNoteOn;
      f.output.setCapture({ isActive: () => true, record(stage, fields) { records.push({ stage, ...fields }); return records.length; } });
      await f.output.start(); channel.sendNoteOn = () => { throw new Error('test port closed'); };
      f.view.game.soundEvents.emit({ sfxId: SoundEffectIds.SPAWN }); clock.tick(1);
      const router = f.view.midiPreviewRouter;
      expect(f.output.getState()).to.include({ status: 'error', enabled: false, backend: 'midi-output-error' });
      expect(f.output.getState().message).to.include('test port closed'); expect(f.view.midiPreviewRouter).to.equal(router);
      expect(records.find(record => record.stage === 'api-failed')).to.include({ accepted: false, outputId: 'first', backend: 'midi-output-api' });
      expect(f.output.syncStatus()).to.equal(true); expect(f.view.midiPreviewRouter).to.equal(null); expect(router.scheduler._activeNotes.size).to.equal(0);
      expect(f.output.getState()).to.include({ status: 'error', enabled: false, backend: 'no-active-output' }); expect(f.local.starts).to.equal(0);
      channel.sendNoteOn = send; expect(await f.output.start()).to.equal(true); expect(f.webMidi.requests).to.equal(1);
      f.output.dispose();
    });
  });

  it('never requests device permission from a URL choice or browser listening', async () => {
    const f = fixture('synth'); expect(f.webMidi.requests).to.equal(0); await f.output.start();
    expect(f.local.starts).to.equal(1); expect(f.webMidi.requests).to.equal(0);
    f.output.setBackend('midi'); expect(f.webMidi.requests).to.equal(0); expect(f.output.getState().enabled).to.equal(false); f.output.dispose();
  });
  it('sends real game notes only to the chosen device and stops its owned gates', async () => {
    await withFakeClockAndPerformance(async clock => {
      const f = fixture(); f.output.setOutputId('second'); expect(await f.output.start()).to.equal(true);
      f.view.game.soundEvents.emit({ sfxId: SoundEffectIds.SPAWN }); clock.tick(1);
      expect(f.secondCalls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([61]); expect(f.calls).to.have.length(0);
      expect(f.output.getState()).to.include({ backend: 'web-midi', outputId: 'second', outputName: 'Second device' }); expect(f.local.starts).to.equal(0);
      const scheduler = f.view.midiPreviewRouter.scheduler;
      f.output.stop(); expect(f.view.midiPreviewRouter).to.equal(null); expect(f.output.getState().backend).to.equal('no-active-output');
      expect(f.secondCalls.some(call => call.type === 'cc' && call.cc === 120 && call.value === 0)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(0); expect(scheduler._pendingNoteOns.size).to.equal(0); f.output.dispose();
    });
  });
  it('cancels an in-flight permission request without attaching a stale route', async () => {
    const f = fixture(); let resolve; f.webMidi.enable = () => new Promise(yes => { resolve = yes; });
    const pending = f.output.start(); f.output.stop(); f.webMidi.enabled = true; resolve();
    expect(await pending).to.equal(false); expect(f.view.midiPreviewRouter).to.equal(null); expect(f.output.getState().enabled).to.equal(false); f.output.dispose();
  });
  it('resumes with a replacement game without requesting permission or activating browser synth', async () => {
    const f = fixture(); await f.output.start(); const old = f.view;
    expect(f.output.suspendGame()).to.equal(true); expect(old.midiPreviewRouter).to.equal(null); f.changeView();
    expect(await f.output.resumeGame()).to.equal(true); expect(f.view.midiPreviewRouter).not.to.equal(null); expect(f.webMidi.requests).to.equal(1); expect(f.local.starts).to.equal(0);
    f.disconnect(); expect(f.view.midiPreviewRouter).to.equal(null); expect(f.output.getState().status).to.equal('error'); expect(f.output.getState().message).to.include('disconnected'); f.output.dispose();
  });
  it('keeps missing-device and denied-permission errors actionable without silently synthesizing', async () => {
    const f = fixture(); f.output.setOutputId('missing'); expect(await f.output.start()).to.equal(false); expect(f.output.getState().message).to.include('No selected MIDI output'); expect(f.local.starts).to.equal(0);
    f.webMidi.enabled = false; f.webMidi.enable = async () => { const error = new Error('denied'); error.name = 'NotAllowedError'; throw error; };
    expect(await f.output.start()).to.equal(false); expect(f.output.getState().message).to.include('permission denied'); f.output.dispose();
  });
});
