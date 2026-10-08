import { expect } from 'chai';
import { sanitizeMidiAutomationSpan, previewMidiAutomationSpan, MAX_MIDI_AUTOMATION_SPANS, MAX_MIDI_AUTOMATION_SPAN_STATES } from '../../js/midi/project/MidiAutomationSpan.js';
import { createMidiProjectFromMidiConfig, createDefaultMidiAutomation, reduceMidiProject, projectToMidiConfig, stringifyMidiProjectExport, importMidiProjectPayload } from '../../js/midi/project/MidiProject.js';
import { MidiAutomationSpans } from '../../js/midi/router/MidiAutomationSpans.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { SoundEventBus } from '../../js/game/SoundEvents.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
const span = patch => sanitizeMidiAutomationSpan({ ...patch });
const entry = (id = 'v', patch = {}) => ({ id, enabled: true, target: 'velocity', min: 20, max: 100, span: span({ shape: 'ramp' }), ...patch });
const position = (beat = 0, distance = 0) => ({ beat, distance, bar: Math.floor(beat / 4) + 1, tick: beat / 0.12, distanceSource: 'event-origin' });
const base = { enabled: true, mpe: { enabled: false }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 },
  durationTicks: { min: 1, max: 960, default: 1 }, position: { mappings: [], viewPan: false, panRange: { min: -127, max: 127 } },
  density: { velocityBoost: 0, durationScale: 0 }, timing: { bpmBase: 120, scheduleAheadMs: 0, timeSignature: { beats: 4, unit: 4 } },
  limits: { maxEventsPerSecond: 1000, maxBytesPerSecond: 100000, maxEventsPerTick: 32 }, sfx: { '1': { note: 60, durationTicks: 1, velocity: 80, trackId: 'lead' } } };
const withRouter = (entries, run, extra = {}, local = true) => withFakeClockAndPerformance(clock => {
  const calls = [], output = makeOutput([1, 2, 3, 4, 10], calls, local ? 'fake-local' : 'fake-external');
  if (local) { output.supportsPerNoteInstrument = true; output.supportsPerNotePan = true; }
  for (const channel of Object.values(output.channels)) channel.sendProgramChange = value => calls.push({ type: 'program', value });
  const timer = { tick: 0, TIME_PER_FRAME_MS: 60, frameTime: 60, speedFactor: 1, onGameTick: new EventHandler(), getGameTicks() { return this.tick; }, get tps() { return 1000 / this.frameTime; } };
  const world = { generation: 1, generationStartTick: 0, level: { width: 100, height: 100 }, getGameTimer: () => timer };
  const bus = new SoundEventBus(timer), router = new MidiEventRouter({ ...base, ...extra, automationSpans: entries });
  router.setOutput(output); router.attach(bus, { game: world });
  const event = (data = {}) => bus.emitSfx('skill-assign', 1, { lemmingId: 0, laneIndex: 0, laneCount: 1, x: 10, ...data });
  const advance = count => { for (let index = 0; index < count; index++) { clock.tick(timer.frameTime); timer.tick++; timer.onGameTick.trigger(); } };
  const ons = () => calls.filter(call => call.type === 'noteOn');
  try { run({ router, world, bus, timer, clock, calls, event, advance, ons }); }
  finally { router.dispose(); bus.dispose(); timer.onGameTick.dispose(); }
});
describe('bounded musical automation spans', function() {
  it('preserves spatial curves and persists optional spans with partial reducer edits', function() {
    let project = createMidiProjectFromMidiConfig(base);
    project = reduceMidiProject(project, { type: 'automation.add', automation: { id: 'spatial', target: 'pan', axis: 'x', min: -60, max: 60 } });
    project = reduceMidiProject(project, { type: 'automation.add', automation: { id: 'timed', target: 'velocity', min: -999, max: 999, span: { duration: 8, loop: true, condition: { sfxId: 1, every: 3, phase: 2 } } } });
    project = reduceMidiProject(project, { type: 'automation.update', automationId: 'timed', patch: { span: { shape: 'ramp', condition: { unit: 'bar' } } } });
    project = importMidiProjectPayload(stringifyMidiProjectExport(project));
    expect(project.automation[0]).not.to.have.property('span');
    expect(project.automation[1]).to.include({ min: 1, max: 127 });
    expect(project.automation[1].span).to.include({ duration: 8, loop: true, shape: 'ramp' });
    expect(project.automation[1].span.condition).to.include({ sfxId: 1, every: 3, phase: 2, unit: 'bar' });
    const config = projectToMidiConfig(project);
    expect(config.position.mappings).to.have.length(1); expect(config.automationSpans).to.have.length(1);
    project = reduceMidiProject(project, { type: 'automation.update', automationId: 'timed', patch: { enabled: false } });
    expect(projectToMidiConfig(project).automationSpans).to.have.length(0);
    expect(createDefaultMidiAutomation()).not.to.have.property('span');
  });
  it('bounds domains, lanes, conditions and ordinary values without changing legacy spatial ranges', function() {
    expect(span({ domain: 'invalid', duration: 0, start: Infinity, laneScope: 'group', laneStart: 9999, laneEnd: -1, priority: Infinity,
      condition: { every: 9999, phase: 9999, sfxId: 999999, triggerType: -1 } })).to.include({ domain: 'beats', duration: 1 / 1024, start: 0, laneStart: 1023, laneEnd: 1023, priority: 0 });
    expect(span({ domain: 'distance', duration: 0 }).duration).to.equal(1);
    expect(sanitizeMidiAutomationSpan(null)).to.equal(null); expect(sanitizeMidiAutomationSpan([])).to.equal(null);
    let project = createMidiProjectFromMidiConfig(base);
    project = reduceMidiProject(project, { type: 'automation.add', automation: { target: 'pan', min: -999, max: 999 } });
    expect(project.automation[0]).to.include({ min: -999, max: 999 });
  });
  it('previews half-open intervals, constant/ramp and loop passes without state or mutable aliases', function() {
    const ramp = entry('loop', { span: span({ start: 2, duration: 4, loop: true, shape: 'ramp' }) });
    expect(previewMidiAutomationSpan(ramp, 1)).to.include({ active: false, phase: 0, spanPass: 0 });
    expect(previewMidiAutomationSpan(ramp, 4)).to.include({ active: true, phase: 0.5, spanPass: 1, value: 60 });
    expect(previewMidiAutomationSpan(ramp, 6)).to.include({ active: true, phase: 0, spanPass: 2, value: 20 });
    expect(Object.isFrozen(previewMidiAutomationSpan(ramp, 4))).to.equal(true);
    expect(previewMidiAutomationSpan(entry('once'), 4).active).to.equal(false);
    expect(previewMidiAutomationSpan(entry('constant', { span: span({}) }), 1).value).to.equal(20);
    expect(previewMidiAutomationSpan(ramp, NaN)).to.equal(null);
  });
  it('keeps all bounded lane counters through inspection-cache eviction and never creates state while polling', function() {
    const entries = Array.from({ length: 70 }, (_, index) => entry('v' + index));
    const model = new MidiAutomationSpans(entries); expect(model.entries).to.have.length(MAX_MIDI_AUTOMATION_SPANS);
    expect(model.counts.length).to.equal(64 * 1024);
    for (let lane = 0; lane < 40; lane++) model.observeOrigin({ laneIndex: lane, sfxId: 1, automationEventId: lane + 1 }, position());
    expect(model.states.size).to.equal(MAX_MIDI_AUTOMATION_SPAN_STATES);
    expect(model.snapshot('v0', 0)).to.equal(null);
    const before = model.states.size; expect(model.snapshot('missing', 900)).to.equal(null); expect(model.states.size).to.equal(before);
    model.observeOrigin({ laneIndex: 0, sfxId: 1, automationEventId: 50 }, position());
    const state = model.snapshot('v0', 0); expect(state.eventCount).to.equal(2); expect(Object.isFrozen(state)).to.equal(true);
    expect(() => { state.eventCount = 99; }).to.throw(TypeError); expect(model.snapshot('v0', 0).eventCount).to.equal(2);
    model.observeOrigin({ laneIndex: 1024, automationEventId: 51 }, position()); expect(model.states.size).to.equal(before);
  });
  it('counts matching SFX/trigger origins within lane groups and tracks, and freezes tail event conditions', function() {
    const model = new MidiAutomationSpans([entry('filter', { scope: 'track', trackId: 'lead', span: span({ laneScope: 'group', laneStart: 2, laneEnd: 4,
      condition: { sfxId: 5, triggerType: 3, every: 2, phase: 0 } }) })]);
    const meta = { laneIndex: 3, sfxId: 5, triggerType: 3, trackId: 'lead' };
    for (const wrong of [{ laneIndex: 1 }, { sfxId: 1 }, { triggerType: 1 }, { trackId: 'other' }]) model.observeOrigin({ ...meta, ...wrong, automationEventId: 1 }, position());
    expect(model.states.size).to.equal(0);
    const first = model.observeOrigin({ ...meta, automationEventId: 2 }, position());
    const second = model.observeOrigin({ ...meta, automationEventId: 3 }, position());
    expect(model.values({ ...meta, automationEventCounts: second }, position()).get('velocity').value).to.equal(20);
    expect(model.values({ ...meta, automationEventCounts: first }, position()).size).to.equal(0);
    expect(model.snapshot('filter', 3)).to.include({ eventCount: 2, originEventCount: 1, conditionMatched: false });
  });
  it('uses simulation base beats through speed changes and pause, then resets at generation origin', function() {
    withRouter([entry()], ({ event, advance, timer, clock, router, world, ons }) => {
      event(); advance(10); event(); timer.frameTime = 3; timer.speedFactor = 20; advance(10); event();
      expect(ons().map(call => call.opts.rawAttack)).to.deep.equal([20, 44, 68]);
      const paused = router.getAutomationSpanState('v'); clock.tick(5000); expect(router.getAutomationSpanState('v')).to.deep.equal(paused);
      world.generation++; world.generationStartTick = timer.tick; event();
      expect(ons().at(-1).opts.rawAttack).to.equal(20);
      expect(router.getAutomationSpanState('v')).to.include({ eventCount: 1, beat: 0, bar: 1 });
    });
  });
  it('uses real beat and independent musical bar/span-pass conditions', function() {
    const model = new MidiAutomationSpans([entry('bar', { span: span({ loop: true, condition: { unit: 'bar', every: 2 } }) }),
      entry('pass', { target: 'pan', min: -50, span: span({ duration: 2, loop: true, condition: { unit: 'pass', every: 2 } }) })]);
    const meta = { laneIndex: 0, automationEventId: 1 }, counts = model.observeOrigin(meta, position(0));
    expect(model.values({ ...meta, automationEventCounts: counts }, position(0)).size).to.equal(0);
    expect(model.values({ ...meta, automationEventCounts: counts }, position(2)).has('pan')).to.equal(true);
    expect(model.values({ ...meta, automationEventCounts: counts }, position(4)).has('velocity')).to.equal(true);
    expect(model.snapshot('bar')).to.include({ eventCount: 1, bar: 2, spanPass: 2 });
  });
  it('applies offset to every actual chord note within the chosen scale and note range', function() {
    withRouter([entry('transpose', { target: 'note', min: 5, span: span({}) })], ({ event, ons }) => {
      event(); expect(ons().map(call => call.note)).to.deep.equal([65, 69, 72]);
      for (const call of ons()) expect([0, 2, 3, 5, 7, 9, 10]).to.include((call.note - 2 + 12) % 12);
    }, { noteRange: { min: 60, max: 72 }, scale: { root: 2, degrees: [0, 2, 3, 5, 7, 9, 10] }, sfx: { '1': { notes: [60, 64, 67], durationTicks: 1, velocity: 80 } } });
  });
  it('keeps chosen role register/instrument and treats percussion pitches as drum numbers', function() {
    const mapping = new MidiMapping({ ...base, scale: { root: 2, degrees: [0, 2, 3, 5, 7, 9, 10] }, ensemble: { roles: [{ id: 'bass', register: { min: 38, max: 50 } }] } });
    const spec = { note: 45, velocity: 80, durationTicks: 4, ensembleRole: 'bass', channel: 2, program: 34 };
    const values = new Map([['note', { value: 48 }]]);
    expect(mapping.applySpanValues(spec, values)).to.include({ note: 50, channel: 2, program: 34, velocity: 80, durationTicks: 4 });
    expect(mapping.applySpanValues({ ...spec, note: 36, percussion: true, ensembleRole: null }, new Map([['note', { value: 1 }]])).note).to.equal(37);
    expect(spec.note).to.equal(45);
  });
  it('reevaluates every queued cell at dispatch without double-applying mapping or advancing origin counters', function() {
    withRouter([entry('phrase', { span: span({ duration: 1, shape: 'ramp' }) })], ({ event, advance, ons, router }) => {
      event(); advance(4);
      expect(ons().map(call => call.opts.rawAttack)).to.deep.equal([20, 39, 58]);
      expect(ons().map(call => call.opts.time)).to.deep.equal([0, 120, 240]);
      expect(router.getAutomationSpanState('phrase')).to.include({ eventCount: 1, originEventCount: 1, beat: 0.48 });
    }, { sfx: { '1': { notes: [60, 64, 67], durationTicks: 1, velocity: 80, phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } } });
  });
  it('preserves each phrase origin condition when another matching actor event arrives', function() {
    withRouter([entry('even', { span: span({ condition: { every: 2 } }) })], ({ event, advance, ons, router }) => {
      event({ lemmingId: 0 }); event({ lemmingId: 1 }); advance(4);
      expect(ons().map(call => call.opts.rawAttack)).to.deep.equal([80, 20, 80, 20, 80, 20]);
      expect(router.getAutomationSpanState('even').eventCount).to.equal(2);
    }, { sfx: { '1': { notes: [60, 64, 67], durationTicks: 1, velocity: 80, phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } } });
  });
  it('uses completed actor positions for distance tails and retains exact original origin metadata', function() {
    withRouter([entry('travel', { target: 'pan', min: -100, max: 100, span: span({ domain: 'distance', duration: 100, shape: 'ramp' }) })], ({ event, advance, world, timer, ons, router }) => {
      const capture = new MidiOutputCapture(); capture.start(); router.setCapture(capture);
      world.getLaneMusicActorPosition = (id, lane) => ({ x: timer.tick === 0 ? 10 : timer.tick === 2 ? 60 : 90, y: 50, tick: timer.tick, generation: world.generation });
      event(); advance(4);
      expect(ons().map(call => Math.round(call.opts.pan * 127))).to.deep.equal([-80, 20, 80]);
      const records = capture.snapshot().records.filter(record => record.stage === 'api-dispatch' && record.type === 'noteOn');
      expect(records.map(record => record.eventWorldX)).to.deep.equal([10, 10, 10]);
      expect(records.map(record => record.automationDistance)).to.deep.equal([10, 60, 90]);
      expect(records.every(record => record.distanceSource === 'completed-actor')).to.equal(true);
    }, { sfx: { '1': { notes: [60, 64, 67], durationTicks: 1, velocity: 80, phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } } });
  });
  it('uses labeled event-origin distance if live positions are missing or belong to another generation', function() {
    withRouter([entry('origin', { target: 'pan', min: -100, max: 100, span: span({ domain: 'distance', duration: 100, shape: 'ramp' }) })], ({ event, advance, world, ons, router }) => {
      world.getLaneMusicActorPosition = () => ({ x: 90, tick: 0, generation: 0 }); event(); advance(4);
      expect(ons().map(call => Math.round(call.opts.pan * 127))).to.deep.equal([-80, -80, -80]);
      expect(router.getAutomationSpanState('origin').distanceSource).to.equal('event-origin');
    }, { sfx: { '1': { notes: [60, 64, 67], durationTicks: 1, velocity: 80, phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } } });
  });
  it('uses priority per target, later-entry ties, and independent track/lane filters', function() {
    const model = new MidiAutomationSpans([entry('first', { min: 30, span: span({}) }), entry('later', { min: 60, span: span({}) }),
      entry('priority', { min: 90, scope: 'track', trackId: 'lead', span: span({ laneScope: 'lane', laneStart: 2, priority: 1 }) })]);
    const meta = { laneIndex: 2, trackId: 'lead', automationEventId: 1 }, counts = model.observeOrigin(meta, position());
    expect(model.values({ ...meta, automationEventCounts: counts }, position()).get('velocity')).to.include({ id: 'priority', value: 90 });
    const other = { ...meta, laneIndex: 0, automationEventId: 2 }; model.observeOrigin(other, position());
    expect(model.values(other, position()).get('velocity')).to.include({ id: 'later', value: 60 });
  });
  it('applies all envelope targets with ordinary ranges and leaves unrelated note properties untouched', function() {
    const mapping = new MidiMapping(base), spec = { note: 60, velocity: 80, releaseVelocity: 40, durationTicks: 4, program: 20, channel: 3 };
    const values = new Map([['velocity', { value: 100 }], ['attack', { value: 2 }], ['decay', { value: 2 }], ['sustain', { value: 2 }], ['release', { value: 0.5 }], ['duration', { value: 10 }], ['timbre', { value: 110 }], ['pan', { value: -42 }]]);
    expect(mapping.applySpanValues(spec, values)).to.include({ note: 60, velocity: 100, releaseVelocity: 50, durationTicks: 20, timbre: 110, pan: -42, program: 20, channel: 3 });
    expect(mapping.applySpanValues(spec, new Map([['pan', { value: 10 }]]))).to.include({ velocity: 80, releaseVelocity: 40, durationTicks: 4 });
    const restricted = new MidiMapping({ ...base, velocityRange: { min: 105, max: 110 } });
    expect(restricted.applySpanValues(spec, new Map([['release', { value: 0.5 }]]))).to.include({ velocity: 80, releaseVelocity: 40 });
  });
  for (const local of [true, false]) it('uses the shared budget and controller coalescing at the ' + (local ? 'local' : 'external') + ' API boundary', function() {
    withRouter([entry('pan', { target: 'pan', min: 42, span: span({}) }), entry('timbre', { target: 'timbre', min: 70, span: span({}) })], ({ event, ons, calls, clock, router }) => {
      for (let index = 0; index < 30; index++) event();
      expect(ons().length).to.be.within(1, 12); expect(router.getAutomationSpanState('pan').eventCount).to.equal(30);
      if (!local) expect(calls.filter(call => call.type === 'cc' && call.cc === 10)).to.have.length(1);
      clock.tick(500); expect(router.scheduler._activeNotes.size).to.equal(0);
      expect(router.scheduler.getOutputPressure().throttled).to.equal(true);
    }, { limits: { maxEventsPerSecond: 24, maxBytesPerSecond: 100000, maxEventsPerTick: 32 } }, local);
  });
  it('preserves counters through clock resync, cancels phrase tails on Panic, and resets owned gates on restart/rewind', function() {
    withRouter([entry('life', { target: 'pan', min: 20, span: span({ loop: true }) })], ({ event, router, timer, world, advance }) => {
      event(); const before = router.getAutomationSpanState('life'); router.resetClock();
      expect(router.getAutomationSpanState('life')).to.deep.equal(before);
      event(); router.scheduler.allNotesOff(); expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      const meta = { lemmingId: 0, laneIndex: 0, automationSpanIds: ['life'] };
      router.scheduler.sendNote({ note: 55, channel: 2, durationTicks: 0 }, meta);
      router.scheduler.sendNote({ note: 72, channel: 1, durationTicks: 0 });
      world.generation++; world.generationStartTick = timer.tick; advance(1);
      expect(router.getAutomationSpanState('life')).to.equal(null);
      expect([...router.scheduler._activeNotes.values()].some(note => note.note === 55)).to.equal(false);
      expect([...router.scheduler._activeNotes.values()].some(note => note.note === 72)).to.equal(true);
      event(); world.timeTravel = { isReversing: true }; timer.onGameTick.trigger(); expect(router.getAutomationSpanState('life')).to.equal(null);
    }, { sfx: { '1': { notes: [60, 64, 67], durationTicks: 1, velocity: 80, phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } } });
  });
  it('restores prior external pan/timbre on the next real note after a span ends, with coalesced cache ownership', function() {
    withRouter([entry('pan', { target: 'pan', min: 42, span: span({ duration: 0.12, condition: { sfxId: 1 } }) }),
      entry('timbre', { target: 'timbre', min: 110, span: span({ duration: 0.12, condition: { sfxId: 1 } }) })], ({ event, bus, advance, calls, router }) => {
      bus.emitSfx('baseline', 2, { x: 10 }); event(); advance(1); event(); event();
      expect(calls.filter(call => call.type === 'cc' && call.cc === 10).map(call => call.value)).to.deep.equal([79, 85, 79]);
      expect(calls.filter(call => call.type === 'cc' && call.cc === 74).map(call => call.value)).to.deep.equal([75, 110, 75]);
      expect(router.scheduler._expressionState(router.scheduler.output, 1)).to.include({ spanPan: false, spanTimbre: false });
    }, { sfx: { '1': { note: 60, durationTicks: 1 }, '2': { note: 64, durationTicks: 1, pan: 30, timbre: 75 } } }, false);
  });
  it('reserves controller restoration cost behind pending span notes instead of escaping the shared budget', function() {
    withRouter([], ({ router, clock, calls }) => {
      const scheduler = router.scheduler;
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 1, timeMs: 100, pan: 42, timbre: 110, spanPan: true, spanTimbre: true });
      expect(scheduler.estimateMessages({ note: 64, channel: 1, durationTicks: 1 })).to.deep.equal({ messages: 4, bytes: 12 });
      scheduler.sendNote({ note: 64, channel: 1, durationTicks: 1, timeMs: 200 }); clock.tick(300);
      expect(calls.filter(call => call.type === 'cc' && call.cc === 10).map(call => call.value)).to.deep.equal([85, 64]);
      expect(calls.filter(call => call.type === 'cc' && call.cc === 74).map(call => call.value)).to.deep.equal([110, 64]);
      expect(scheduler._activeNotes.size).to.equal(0);
    }, {}, false);
  });

  it('preserves matching counters across value/cadence/interval edits and unrelated insertion/removal/reordering', function() {
    const a = entry('a', { min: 20, span: span({ condition: { sfxId: 1, every: 3 } }) });
    const b = entry('b', { target: 'pan', min: 40, span: span({ condition: { sfxId: 1, every: 2 } }) });
    const other = entry('other', { target: 'duration', span: span({ condition: { sfxId: 2 } }) });
    const model = new MidiAutomationSpans([a, b]); model.synchronize(1, 2);
    const meta = { laneIndex: 0, sfxId: 1 };
    model.observeOrigin({ ...meta, automationEventId: 1 }, position(2));
    const second = model.observeOrigin({ ...meta, automationEventId: 2 }, position(2));
    const edited = { ...a, min: 60, max: 80, span: span({ ...a.span, start: 1, duration: 8, loop: true, priority: 3, condition: { sfxId: 1, every: 2 } }) };
    model.configure([other, b, edited]);
    expect(model.snapshot('a')).to.include({ eventCount: 2, originEventCount: 2, generation: 1, active: true });
    expect(model.snapshot('b').eventCount).to.equal(2);
    expect(model.values({ ...meta, automationEventCounts: second }, position(2)).get('velocity').value).to.equal(60);
    model.configure([edited, other]); expect(model.snapshot('a').eventCount).to.equal(2); expect(model.snapshot('b')).to.equal(null);
    model.observeOrigin({ ...meta, automationEventId: 2 }, position(2)); expect(model.snapshot('a').eventCount).to.equal(2);
    model.observeOrigin({ ...meta, automationEventId: 3 }, position(2)); expect(model.snapshot('a')).to.include({ eventCount: 3, active: false });
    model.configure([other, edited]);
    expect(model.values({ ...meta, automationEventCounts: second }, position(2)).get('velocity').value).to.equal(60);
    expect(model.snapshot('a')).to.include({ eventCount: 3, originEventCount: 2 });
    model.configure([{ ...edited, span: span({ ...edited.span, condition: { sfxId: 2, every: 2 } }) }, other]);
    expect(model.snapshot('a')).to.equal(null);
    expect(model.values({ ...meta, sfxId: 2, automationEventCounts: second }, position(2)).has('velocity')).to.equal(false);
    model.observeOrigin({ ...meta, sfxId: 2, automationEventId: 4 }, position(2)); expect(model.snapshot('a').eventCount).to.equal(1);
  });
  it('keeps unchanged queued tails and their original ID-owned every-N ordinal through live span edits', function() {
    const a = entry('a', { span: span({ condition: { every: 2 } }) });
    const b = entry('b', { target: 'pan', span: span({ condition: { sfxId: 9 } }) });
    const inserted = entry('inserted', { target: 'duration', span: span({ condition: { sfxId: 9 } }) });
    withRouter([a, b], ({ router, event, advance, ons }) => {
      event({ lemmingId: 0 }); event({ lemmingId: 1 });
      expect(router.scheduler.gamePhrases.voices.size).to.equal(2);
      const updated = { ...a, min: 40, span: span({ ...a.span, duration: 8, loop: true }) };
      const alreadySent = ons().length;
      router.setMapping({ ...router.mapping.config, automationSpans: [inserted, updated, b] });
      expect(ons()).to.have.length(alreadySent);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(2); advance(2);
      router.setMapping({ ...router.mapping.config, automationSpans: [{ ...updated, min: 50 }, inserted] });
      expect(router.scheduler.gamePhrases.voices.size).to.equal(2); advance(2);
      expect(ons().map(call => call.opts.rawAttack)).to.deep.equal([80, 20, 80, 40, 80, 50]);
      expect(router.getAutomationSpanState('a')).to.include({ eventCount: 2, originEventCount: 2 });
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
    }, { sfx: { '1': { notes: [60, 64, 67], durationTicks: 1, velocity: 80, phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } } });
  });

});
