import { expect } from 'chai';
import { qualifyLifecycleEngineResults, LIFECYCLE_ENGINE_CASES } from '../scripts/LifecycleEngineResults.js';
import { NATIVE_CLOCK_SCENARIOS, qualifyNativeClockReceipt } from '../scripts/NativeClockResults.js';
import { nativeClockReceipt } from './support/native-clock-receipts.js';

const report = () => ({ suites: Object.entries(LIFECYCLE_ENGINE_CASES).map(([project, count]) => ({
  specs: Array.from({ length: count }, (_, index) => ({ title: project + ':' + index, file: 'native.spec.js', line: index + 1, column: 1,
    tests: [{ projectName: project, expectedStatus: 'passed', results: [{ status: 'passed', attachments: index ? [] : [{ name: 'native-engine-semantics.json', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ project, browser: 'native-test-version', source: { schema: 'lemmings-engine-semantics/v1', recipe: { seed: 42, lanes: 8, ticks: 64 },
        initialTick: 0, finalTick: 64, batches: 64, facts: 128, complete: true, stablePaused: true, outputEnabled: false,
        initialHash: 'a'.repeat(64), physicsHash: 'b'.repeat(64), causalHash: 'c'.repeat(64), assets: ['asset:qualified'], audioContextAvailable: true,
        renderer: { path: 'canvas2d_main_thread', state: 'ready', hardwareAcceleration: 'unqualified' }, viewport: { width: 1920, height: 1080 }, observerListeners: { before: 2, after: 2 } } })).toString('base64') }] }] }] })) })) });
const clockReport = () => {
  const value = report();
  for (const suite of value.suites) for (const [index, scenario] of NATIVE_CLOCK_SCENARIOS.entries()) {
    const test = suite.specs[index].tests[0];
    test.results[0].attachments.push({ name: 'native-physical-clock.json', contentType: 'application/json', body: Buffer.from(JSON.stringify(nativeClockReceipt(test.projectName, scenario))).toString('base64') });
  }
  for (const suite of value.suites) {
    const test = suite.specs.at(-1).tests[0], project = test.projectName;
    const runtime = { schema: 'lemmings-native-runtime-transitions/v1', project, browser: 'native-test-version', available: true, reason: null,
      cycles: [['balanced', 44100], ['performance', 48000], ['robust', 96000]].map(([latencyProfile, preferredSampleRate], index) => ({ config: { latencyProfile, preferredSampleRate },
        before: { actualSampleRate: 48000, acousticMeasurement: false }, result: { status: 'rebuild-ready', requiresEnable: true, acousticReceipt: false }, wallMs: 1,
        contextsBefore: index + 1, contextsAfter: index + 1, oldClosed: true, currentNull: true, enabled: false, activeVoices: 0 })),
      deviceSignal: { controlled: true, beforeEpoch: 1, afterEpoch: 2, enabled: false, activeVoices: 0, sameContext: true, contexts: 1 },
      final: { retirement: { state: 'retired', outcome: 'complete' }, contexts: ['interactive', 'balanced', 'interactive', 'playback'].map((latencyHint, index) => ({
        requested: { latencyHint, ...(index ? { sampleRate: [44100, 48000, 96000][index - 1] } : {}) }, actualSampleRate: 48000, closed: true })),
      observation: { config: { latencyProfile: 'robust', preferredSampleRate: 96000 }, actualSampleRate: 48000, acousticMeasurement: false }, outputWatch: { devicesListening: false, speakerPermission: 'retired' } } };
    test.results[0].attachments.push({ name: 'native-runtime-transitions.json', contentType: 'application/json', body: Buffer.from(JSON.stringify(runtime)).toString('base64') });
  }
  return value;
};
const change = (value, apply) => { const attachment = value.suites[1].specs[0].tests[0].results[0].attachments[0], receipt = JSON.parse(Buffer.from(attachment.body, 'base64')); apply(receipt.source); attachment.body = Buffer.from(JSON.stringify(receipt)).toString('base64'); };

describe('native lifecycle engine qualification', () => {
  it('requires all fifty-one journeys and native runtime/clock receipts matching their actual capabilities', () => { const result = qualifyLifecycleEngineResults(clockReport()); expect(result.passed).to.equal(51); expect(result.engines[2].source.audioContextAvailable).to.equal(true); });
  for (const [name, mutate] of [
    ['unretired old context', row => { row.cycles[0].oldClosed = false; }], ['implicit replacement', row => { row.cycles[0].contextsAfter++; }],
    ['lost requested rate', row => { row.final.contexts[1].requested.sampleRate = 48000; }], ['acoustic overclaim', row => { row.cycles[0].result.acousticReceipt = true; }],
    ['leaked device observer', row => { row.final.outputWatch.devicesListening = true; }], ['stale clock epoch', row => { row.deviceSignal.afterEpoch = row.deviceSignal.beforeEpoch; }]
  ]) it('rejects a native runtime ' + name, () => {
    const value = clockReport(), attachment = value.suites[0].specs.at(-1).tests[0].results[0].attachments.find(x => x.name === 'native-runtime-transitions.json');
    const row = JSON.parse(Buffer.from(attachment.body, 'base64')); mutate(row); attachment.body = Buffer.from(JSON.stringify(row)).toString('base64');
    expect(() => qualifyLifecycleEngineResults(value)).to.throw('native runtime');
  });
  it('requires a runtime receipt despite successful case counts and clock observations', () => {
    const value = clockReport(); value.suites[0].specs.at(-1).tests[0].results[0].attachments = [];
    expect(() => qualifyLifecycleEngineResults(value)).to.throw('native runtime receipt');
  });
  for (const key of ['physicsHash', 'causalHash']) it('rejects a one-engine ' + key + ' divergence despite every case passing', () => {
    const value = clockReport(); change(value, source => { source[key] = 'd'.repeat(64); }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Cross-engine semantic mismatch');
  });
  it('rejects a mismatched asset inventory despite matching checkpoint hashes', () => { const value = clockReport(); change(value, source => { source.assets = ['different']; }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('assets'); });
  it('rejects a missing required engine', () => { const value = clockReport(); value.suites.pop(); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Required engine'); });
  it('rejects an explicitly skipped lifecycle case', () => { const value = clockReport(); value.suites[1].specs[1].tests[0].results[0].status = 'skipped'; expect(() => qualifyLifecycleEngineResults(value)).to.throw('Required engine'); });
  it('rejects zero physical facts instead of accepting equal empty hashes', () => { const value = clockReport(); change(value, source => { source.facts = 0; }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Incomplete native'); });
  it('rejects a leaked observer despite unchanged physics', () => { const value = clockReport(); change(value, source => { source.observerListeners.after++; }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Incomplete native'); });
  it('rejects passing case counts without native clock observations', () => { expect(() => qualifyLifecycleEngineResults(report())).to.throw('Missing or duplicate native clock'); });
  it('records native constructor absence without presenting unavailable scenarios as render measurements', () => {
    const value = clockReport(); change(value, source => { source.audioContextAvailable = false; });
    for (const spec of value.suites[1].specs) for (const attachment of spec.tests[0].results[0].attachments) if (attachment.name === 'native-runtime-transitions.json') {
      attachment.body = Buffer.from(JSON.stringify({ schema: 'lemmings-native-runtime-transitions/v1', project: 'firefox-lifecycle', browser: 'native-test-version', available: false,
        reason: 'native-AudioContext-absent', cycles: [], deviceSignal: null, final: null })).toString('base64');
    } else if (attachment.name === 'native-physical-clock.json') {
      const row = JSON.parse(Buffer.from(attachment.body, 'base64'));
      attachment.body = Buffer.from(JSON.stringify({ schema: row.schema, project: row.project, browser: row.browser, scenario: row.scenario, viewport: row.viewport, acousticReceipt: false,
        availability: { available: false, reason: 'native-AudioContext-absent', contextType: 'undefined', legacyContextType: 'undefined', contextsOpened: 0, outputEnabled: false, viewport: row.viewport } })).toString('base64');
    }
    const result = qualifyLifecycleEngineResults(value);
    expect(result.engines[1].nativeClock.every(row => row.availability.available === false && !row.onset)).to.equal(true);
    change(value, source => { source.audioContextAvailable = true; }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('contradicts engine semantics');
  });
  it('rejects duplicate scenario receipts', () => {
    const value = clockReport(), attachments = value.suites[0].specs[0].tests[0].results[0].attachments;
    attachments.push(attachments.at(-1)); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Missing or duplicate native clock');
  });
  it('rejects original frame accuracy without an onset observed during the blocked main thread', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'stall-20'); receipt.actual.onsetsWhileBlocked = 0;
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
  it('rejects a busy counter without the matching per-source render observations', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'stall-20'); receipt.actual.snapshot.nodes[0].firstWhileBlocked = null;
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
  it('rejects an unavailable isolated observer instead of treating asynchronous clock messages as stall proof', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'stall-20'); receipt.actual.snapshot.observer.crossOriginIsolated = false;
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
  it('rejects a viewport label that contradicts the actual native document measurement', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'stall-20'); receipt.actual.snapshot.viewport.width = 1921;
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
  it('requires observer readiness before measuring source onset precision', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'stall-20'); receipt.actual.snapshot.observer.warmed = false;
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
  it('requires producer lead to match the actual render quantum observed at submission', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'stall-50'); receipt.targets.producerLeadFrames[0]++;
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
  it('starts the muted window at confirmed disable even when permitted attacks occurred during the UI click', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'listen-rearm'); receipt.disabled.starts = receipt.muted.starts = 4;
    expect(qualifyNativeClockReceipt(receipt, 'chromium-semantic').rearm.admitted).to.equal(4);
  });
  for (const [name, mutate] of [
    ['unconfirmed disable', row => { row.disabled.enabled = true; }],
    ['an admitted muted attack', row => { row.actual.outcomes[2].status = 'accepted'; row.rearm.admitted++; }],
    ['retimed native source', row => { row.actual.outcomes[4].targetFrame++; }],
    ['claimed admissions without a fresh source', row => { row.actual.batches[4].tick = row.actual.batches[5].tick = 100; }]
  ]) it('rejects ' + name + ' from the raw rearm source joins', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'listen-rearm'); mutate(receipt);
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
  it('qualifies cancellation against observed render time when the main-thread clock lags', () => {
    const receipt = nativeClockReceipt('firefox-lifecycle', 'cancel-after-render');
    for (const stop of receipt.actual.snapshot.stops) { stop.targetSeconds = 0; stop.submittedSeconds = stop.mainSecondsAfterStop = 0.1; }
    for (const row of receipt.cancellation.stopFrontiers) row.frontierFrame = 11520;
    expect(qualifyNativeClockReceipt(receipt, 'firefox-lifecycle').cancellation.maximumFollowingFrames).to.equal(128);
  });
  for (const [name, mutate] of [
    ['missing native-ended acknowledgment', row => { row.actual.snapshot.ends = []; }],
    ['synthetic ended event', row => { row.actual.snapshot.ends[0].trusted = false; }],
    ['acknowledgment from another context', row => { row.actual.snapshot.ends[0].context = 1; }],
    ['acknowledgment from another sample rate', row => { row.actual.snapshot.ends[0].sampleRate = 44100; }],
    ['unobserved acknowledgment frontier', row => { row.actual.snapshot.ends[0].renderFrameAtAcknowledgment = 24192; }],
    ['incomplete native end wait', row => { row.actual.nativeEndWait.complete = false; }],
    ['forged native acknowledgment summary', row => { row.cancellation.stopFrontiers[0].nativeEnd = { ...row.actual.snapshot.ends[0], hostMs: 1300 }; }],
    ['missing native before bracket', row => { delete row.actual.snapshot.stops[0].renderFrameBeforeStop; }],
    ['reversed native bracket', row => { row.actual.snapshot.stops[0].renderFrameAfterStop = 10752; }],
    ['clock from another sample rate', row => { row.actual.snapshot.stops[0].sampleRate = 44100; }],
    ['undeclared quantum clock', row => { row.cancellation.frontier = 'main-thread-context'; }],
    ['widened frame limit', row => { row.cancellation.maximumFollowingFrames = 256; }],
    ['forged frontier summary', row => { row.cancellation.stopFrontiers[0].frontierFrame++; }],
    ['duplicated source ordinal', row => { row.actual.snapshot.nodes[1].ordinal = 0; }],
    ['render beyond the unchanged128-frame bound', row => { row.actual.snapshot.nodes[0].last = 11649; row.cancellation.stopFrontiers[0].lastRenderedFrame = 11649; }]
  ]) it('rejects cancellation with ' + name, () => {
    const receipt = nativeClockReceipt('firefox-lifecycle', 'cancel-after-render'); mutate(receipt);
    expect(() => qualifyNativeClockReceipt(receipt, 'firefox-lifecycle')).to.throw('Incomplete native clock');
  });
  for (const [scenario, mutate] of [
    ['stall-20', row => { row.actual.snapshot.nodes[0].first += 130; }],
    ['stall-50', row => { row.onset.p95Frames = 0; }],
    ['stall-100', row => { row.actual.renderEndFrame = row.actual.renderStartFrame; }],
    ['cancel-before-render', row => { row.actual.snapshot.nodes[0].first = 10001; }],
    ['cancel-after-render', row => { row.actual.snapshot.nodes[0].last = 20000; }],
    ['independent-owner', row => { row.actual.after = { ...row.actual.after, rebases: 2 }; }],
    ['listen-rearm', row => { row.rearm.missedAttacksReplayed = 1; }],
    ['context-replacement', row => { row.after.contexts[1].sampleRate = 44100; }]
  ]) it('rejects inconsistent ' + scenario + ' evidence', () => {
    const receipt = nativeClockReceipt('chromium-semantic', scenario); mutate(receipt);
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
});

describe('prepared native source prefix qualification', () => {

  for (const [label, mutate] of [
    ['missing preparation', receipt => { delete receipt.actual.snapshot.source.sourcePreparation; }],
    ['warm audio context', receipt => { receipt.actual.snapshot.source.sourcePreparation.hasAudioContext = true; }],
    ['warm enabled output', receipt => { receipt.actual.snapshot.source.sourcePreparation.audioEnabled = true; }],
    ['warm anchor', receipt => { receipt.actual.snapshot.batches[0].anchors = { executionEpoch: 'premature' }; }],
    ['prefix gap', receipt => { receipt.actual.snapshot.batches[0].tick = 2; }],
    ['another world', receipt => { receipt.actual.snapshot.batches[0].worldId = 'foreign'; }],
    ['another generation', receipt => { receipt.actual.snapshot.batches[0].generation = 2; }],
    ['unobserved prefix count', receipt => { receipt.actual.snapshot.source.sourcePreparation.processedBatches = 2; }],
    ['prefix attack', receipt => { receipt.actual.snapshot.intents.push({ kind: 'begin', batchId: 'warm:1' }); }],
    ['producing prefix', receipt => { receipt.actual.snapshot.batches[0].phase = 'producing'; }],
    ['negative processing duration', receipt => { receipt.actual.snapshot.batches[0].processingHostDurationMs = -1; }]
  ]) it('rejects ' + label + ' instead of qualifying a cold or audible preparation as the prepared-source profile', () => {
    const receipt = nativeClockReceipt('chromium-semantic', 'stall-50'); mutate(receipt);
    expect(() => qualifyNativeClockReceipt(receipt, 'chromium-semantic')).to.throw('Incomplete native clock');
  });
});
