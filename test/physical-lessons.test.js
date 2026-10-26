import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { validatePhysicalLessonDefinition } from '../js/app/procgen/workstation/PhysicalLessonDefinition.js';
import { createPhysicalLessonProgress, PHYSICAL_LESSON_PROGRESS_KEY } from '../js/app/procgen/workstation/PhysicalLessonProgress.js';
import { createPhysicalLessonSession } from '../js/app/procgen/workstation/PhysicalLessonSession.js';
import { createPhysicalLessonView } from '../js/app/procgen/workstation/PhysicalLessonView.js';
import { createInstalledPhysicalLessons } from '../js/app/procgen/workstation/PhysicalLessonCatalog.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';

const h = value => value.repeat(64), scene = (id, hash) => ({ id, version: 1, hash: h(hash) });
const definition = (kind = 'pickup-relocation') => validatePhysicalLessonDefinition({ schema: 'lemmings-physical-lesson/v1', id: 'lesson.' + kind, version: 1, title: kind, setupScene: scene('practice.' + kind, 'a'), zeroNoteScene: scene('practice.quiet-control', 'b'),
  prediction: 'Predict the next actual crossing.', intervention: 'Change the declared cause using existing physical actions.', expectedPhysicalEvidence: 'Actual source-linked pickup crossings.', expectedMusicalDifference: 'Different physical location or actual birth/arrival intervals.', audibleEvidence: 'Backend acceptance and user-reported hearing are separate.', hint: 'A timer or unrelated click cannot complete this lesson.', permittedActions: ['finite-release'],
  success: { kind, pickupId: 'practice-pickup', mappingIds: ['pluck'], minimumActors: kind === 'pickup-relocation' ? 1 : 2 }, resetCheckpoint: 'fresh-zero-tick-setup-via-existing-scene-owner', accessibility: 'semantic-controls;keyboard-touch-controller-actions-shared;sound-off-physical-evidence;no-microphone' });
const graph = x => ({ version: 1, revision: x === 96 ? 1 : 2, pickups: [{ id: 'practice-pickup', revision: x === 96 ? 1 : 2, geometry: { kind: 'segment', points: [{ x, y: 0 }, { x, y: 96 }] } }], instruments: [{ id: 'pluck', route: 'local' }] });
const gesture = spreadTicks => ({ nominalGapTicks: 54, spreadTicks, lanePhase: [{ laneId: 0, offsetTicks: 0 }, { laneId: 1, offsetTicks: spreadTicks }], phaseStepTicks: 0, grouping: 'free', clockMode: 'locked' });
const context = (x = 96, spread = 12, documentEpoch = 2) => ({ documentEpoch, activeActors: 0, graph: graph(x), releaseGesture: gesture(spread), soundIdentity: h('c') });
const binding = (hash = 'a', documentEpoch = 2) => ({ sceneHash: h(hash), worldId: 'practice-world', generation: 3, ...context(96, 12, documentEpoch) });
const packet = (tick, actorId = null, birthTick = tick, ctx = context()) => {
  const batchId = 'practice-world:3:' + tick + ':0', eventId = batchId + ':motion', intentId = batchId + ':pluck:' + actorId;
  const batch = { version: 1, worldId: 'practice-world', generation: 3, tick, batchId, completeness: { status: 'complete', dropped: 0 }, terminalGenerationTransition: null, facts: actorId == null ? [] : [{ kind: 'MotionCommitted', eventId, actorId, worldId: 'practice-world', generation: 3, batchId }], snapshot: { actors: actorId == null ? [] : [{ actorId, spawnTick: birthTick }] } };
  const intents = actorId == null ? [] : [{ version: 1, kind: 'begin', intentId, batchId, worldId: 'practice-world', generation: 3, actorId, mappingId: 'pluck', physicalSourceKind: 'PickupCrossing', observation: { gateId: 'practice-pickup' }, sourceEventIds: [eventId] }];
  return { batch, intents, context: ctx, receipts: [] };
};
const ready = kind => { const progress = createPhysicalLessonProgress(), session = createPhysicalLessonSession({ progress }); session.select(definition(kind)); session.bindScene(binding('b', 1)); session.observe(packet(1, null, 1, context(96, 12, 1))); expect(session.state().phase).to.equal('load-setup'); session.bindScene(binding()); session.predict('The real crossing will move or change interval.'); return { session, progress }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('observed physical lessons (runtime/browser acceptance deferred)', () => {
  it('requires an actual empty control, prediction, unchanged baseline and source-linked changed cause', () => {
    const { session } = ready(); session.observe(packet(1)); expect(session.state().phase).to.equal('observe-baseline');
    const unrelated = packet(2, 1); unrelated.intents[0].mappingId = 'foreign'; session.observe(unrelated); expect(session.state().baseline).to.have.length(0);
    session.observe(packet(3, 1, 1)); expect(session.state().phase).to.equal('perform-intervention');
    session.observe(packet(4, 2, 4)); expect(session.state().physicalObserved).to.equal(false);
    const changed = packet(5, 3, 5, context(128)); session.observe(changed); expect(session.state().physicalObserved).to.equal(true); expect(session.state().soundAccepted).to.equal(false); expect(session.state().soundRendered).to.equal(false);
    expect(() => session.reportHearing()).to.throw('matching backend');
  });
  it('cannot infer hearing from intents, disabled output, rejected receipts or the previous document epoch', () => {
    const { session, progress } = ready(); session.observe(packet(1, 1)); const changed = packet(2, 2, 2, context(128)); session.observe(changed);
    const receipt = { ...changed.intents[0], status: 'accepted', stage: 'scheduled', outputRequested: true };
    expect(session.observeReceipt({ ...receipt, status: 'rejected' }, 2)).to.equal(false); expect(session.observeReceipt({ ...receipt, outputRequested: false }, 2)).to.equal(false); expect(session.observeReceipt(receipt, 1)).to.equal(false);
    expect(session.observeReceipt(receipt, 2)).to.equal(true); expect(session.state().reportedHearing).to.equal(false); session.reportHearing(); expect(session.state().reportedHearing).to.equal(true); expect(progress.read('lesson.pickup-relocation', 1)).to.include({ physicalObserved: true, soundAccepted: true, reportedHearing: true });
  });
  it('rejects stale generations, gaps, incomplete batches, foreign raw causes and an actorful zero-note control', () => {
    for (const corrupt of [p => { p.batch.generation++; }, p => { p.context.documentEpoch++; }, p => { p.batch.completeness.status = 'incomplete'; }, p => { p.batch.tick = 3; p.batch.batchId = 'practice-world:3:3:0'; }]) {
      const { session } = ready(); session.observe(packet(1)); const next = packet(2, 1); corrupt(next); session.observe(next); expect(session.state().phase).to.equal('reset-required'); expect(session.state().physicalObserved).to.equal(false);
    }
    const { session } = ready(), bad = packet(1, 1); bad.batch.facts[0].worldId = 'foreign'; session.observe(bad); expect(session.state().baseline).to.have.length(0);
    session.reset(); session.bindScene(binding('b', 1)); session.observe(packet(1, 1, 1, context(96, 12, 1))); expect(session.state().phase).to.equal('reset-required');
  });
  it('requires changed actual birth and arrival intervals, beyond a changed requested spacing', () => {
    const { session } = ready('entry-spacing-change'); session.observe(packet(1, 1, 1)); session.observe(packet(2, 2, 2)); expect(session.state().phase).to.equal('perform-intervention');
    session.observe(packet(3, 3, 3, context(96, 30))); session.observe(packet(4, 4, 4, context(96, 30))); expect(session.state().physicalObserved).to.equal(false); expect(session.state().changed).to.have.length(0);
    session.observe(packet(5, 5, 5, context(96, 30))); session.observe(packet(6, null, 6, context(96, 30))); session.observe(packet(7, 6, 7, context(96, 30))); expect(session.state().physicalObserved).to.equal(true); expect(session.state().baseline.map(record => record.actorId)).to.deep.equal([1, 2]);
  });
  it('persists only bounded independent progress and tolerates denied storage without changing a project', () => {
    const values = new Map([['musical-project', 'untouched']]), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, progress = createPhysicalLessonProgress({ storage });
    progress.write('lesson.one', { version: 1, physicalObserved: true, soundAccepted: false, reportedHearing: false, evidencePath: 'visual' }); expect(values.get('musical-project')).to.equal('untouched'); expect(values.has(PHYSICAL_LESSON_PROGRESS_KEY)).to.equal(true); expect(createPhysicalLessonProgress({ storage }).read('lesson.one', 1).evidencePath).to.equal('visual'); expect(progress.read('lesson.one', 2)).to.equal(null);
    expect(() => progress.write('lesson.bad', { version: 1, physicalObserved: true, soundAccepted: false, reportedHearing: true, evidencePath: 'reported-hearing' })).to.throw();
    const denied = createPhysicalLessonProgress({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } }); expect(denied.state().persistence).to.include('session-only');
  });
  it('uses actual pinned catalog scenes and offers no fabricated setup for the remaining lessons', async () => {
    const descriptors = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-pluck'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('d') }))), catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('e') }, descriptors }) }), lessons = await createInstalledPhysicalLessons(catalog);
    expect(lessons).to.have.length(2); expect(lessons.map(value => value.setupScene.id)).to.deep.equal(['practice.one-foot-one-sound', 'practice.space-becomes-rhythm']); expect(lessons.every(value => value.zeroNoteScene.id === 'practice.quiet-control')).to.equal(true);
  });
  it('keeps Reset, Back, Skip, Close and re-entry on one observer without automatic physical actions', async () => {
    const dom = new JSDOM('<body></body>', { url: 'http://localhost' }), definitions = [definition(), definition('entry-spacing-change')]; let loads = 0;
    const view = createPhysicalLessonView({ document: dom.window.document, window: dom.window, definitions, loadScene: async reference => { loads++; return binding(reference.hash[0], reference.hash[0] === 'b' ? 1 : 2); } });
    const button = text => [...dom.window.document.querySelectorAll('button')].find(value => value.textContent === text);
    view.open(definitions[0].setupScene.id); button('Load empty control').click(); await settle(); view.observe(packet(1, null, 1, context(96, 12, 1))); expect(button('Load lesson setup').disabled).to.equal(false);
    button('Load lesson setup').click(); await settle(); const prediction = dom.window.document.querySelector('textarea'); prediction.value = 'The new cause will be at the moved pickup.'; button('Keep prediction · observe baseline').click(); view.observe(packet(1)); expect(button('I heard the difference · self report').disabled).to.equal(true);
    button('Next lesson').click(); button('Back').click(); button('Skip · explore freely').click(); expect(dom.window.document.querySelector('output').textContent).to.include('Physical evidence: pending'); button('Reset attempt').click(); await settle(); expect(loads).to.equal(3);
    button('Close lessons').click(); view.open(definitions[0].setupScene.id); const retired = view.dispose(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(dom.window.document.querySelector('.studio-physical-lesson')).to.equal(null); dom.window.close();
  });
  it('retires a canceled setup before re-entry and ignores its stale completion', async () => {
    const dom = new JSDOM('<body></body>', { url: 'http://localhost' }); let canceled = 0;
    const view = createPhysicalLessonView({ document: dom.window.document, window: dom.window, definitions: [definition()], loadScene: (_reference, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { canceled++; reject(signal.reason); }, { once: true }); }) });
    const button = text => [...dom.window.document.querySelectorAll('button')].find(value => value.textContent === text);
    view.open('practice.pickup-relocation'); button('Load empty control').click(); await settle(); button('Skip · explore freely').click(); await settle();
    expect(canceled).to.equal(1); expect(dom.window.document.querySelector('output').textContent).to.include('Physical evidence: pending'); expect(button('I heard the difference · self report').disabled).to.equal(true);
    view.open('practice.pickup-relocation'); expect(button('Load empty control').disabled).to.equal(false); const receipt = view.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); dom.window.close();
  });

});
