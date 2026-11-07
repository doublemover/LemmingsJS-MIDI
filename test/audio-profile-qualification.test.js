import { expect } from 'chai';
import { qualifyAudioProfileReport } from '../scripts/qualify-audio-profiles.mjs';
import { compareBrowserProcessCpu, summarizeProfileSamples } from '../scripts/BrowserProcessCpu.js';
const fixture = () => {
  const profiles = ['performance', 'balanced', 'robust'].map((name, index) => {
    const samples = Array.from({ length: 3 }, (_, trial) => {
      const snapshot = (time, ns) => ({ schema: 'lemmings-browser-process-cpu/v1', platform: 'linux', rootPid: 5, startedMs: time, completedMs: time + 10, processes: [{ pid: 5, parentPid: 1, identity: '1', cpuNs: String(ns) }] });
      const before = snapshot(trial * 2000, 0), after = snapshot(trial * 2000 + 1000, 100000000);
      const state = audioSeconds => ({ activeVoices: 2, contextState: 'running', audioSeconds, observationReadWallMs: 0.01 });
      return { cpu: compareBrowserProcessCpu(before, after), processCounters: { before, after }, before: state(trial + 1), after: state(trial + 2) };
    });
    return { name, firstTargetSeconds: 0.25, warmup: { status: 'passed', firstTargetSeconds: 0.25, frontierSeconds: 0.75, renderedWarmupSeconds: 0.5, elapsedMs: 750, deadlineMs: 5000, last: { audioSeconds: 0.75, contextState: 'running', activeVoices: 2 } }, actualSampleRate: 48000, requested: { latencyHint: ['interactive', 'balanced', 'playback'][index], sampleRate: 48000 },
      observation: { config: { latencyProfile: name, preferredSampleRate: 48000 }, actualSampleRate: 48000, acousticMeasurement: false, estimatesAreAdditive: false }, samples,
      distributions: { coreEquivalent: summarizeProfileSamples(samples.map(value => value.cpu.coreEquivalent)), observationReadWallMs: summarizeProfileSamples(samples.flatMap(value => [value.before.observationReadWallMs, value.after.observationReadWallMs])), samplerUncertaintyMs: summarizeProfileSamples(samples.map(value => value.cpu.samplingUncertaintyMs)) } };
  });
  return JSON.parse(JSON.stringify({ schema: 'lemmings-native-audio-profiles/v2', platform: 'linux', parameters: { samples: 3, sampleMs: 1000, voices: 2, engines: ['chromium'] }, engines: [{ engine: 'chromium', version: 'native-fixture', viewport: { width: 1920, height: 1080 }, available: true, processRootPid: 5, profiles,
    final: { retirement: { state: 'retired', outcome: 'complete' }, contexts: Array.from({ length: 3 }, () => ({ closed: true, actualSampleRate: 48000 })) } }] }));
};
describe('source-bound native audio profile qualification', () => {
  it('qualifies measured native profiles with independently recomputed process counters', () => {
    expect(qualifyAudioProfileReport(fixture())).to.include({ engines: 1, available: 1, profiles: 3 });
  });
  for (const [name, mutate] of [
    ['empty samples', value => { value.parameters.samples = 0; value.engines[0].profiles.forEach(profile => { profile.samples = []; }); }],
    ['zero workload', value => { value.parameters.voices = 0; }], ['missing native profile', value => { value.engines[0].profiles.pop(); }],
    ['unretired context', value => { value.engines[0].final.contexts[0].closed = false; }], ['unconfirmed retirement', value => { value.engines[0].final.retirement.outcome = 'pending'; }],
    ['missing render warmup', value => { value.engines[0].profiles[0].warmup = null; }],
    ['unrendered workload', value => { value.engines[0].profiles[0].warmup.last.audioSeconds = 0.01; }],
    ['expired render warmup', value => { value.engines[0].profiles[0].warmup.elapsedMs = 5001; }],
    ['retimed warmup target', value => { value.engines[0].profiles[0].warmup.firstTargetSeconds = 1; }],
    ['stopped native clock', value => { value.engines[0].profiles[0].samples[0].after.audioSeconds = 1; }],
    ['missing voices', value => { value.engines[0].profiles[0].samples[0].after.activeVoices = 1; }],
    ['foreign process', value => { value.engines[0].processRootPid = 6; }], ['changed process population', value => { value.engines[0].profiles[0].samples[0].cpu.populationStable = false; }],
    ['invented CPU measurement', value => { value.engines[0].profiles[0].samples[0].cpu.coreEquivalent = 99; }],
    ['invented percentile', value => { value.engines[0].profiles[0].distributions.coreEquivalent = { median: 99 }; }],
    ['acoustic overclaim', value => { value.engines[0].profiles[0].observation.acousticMeasurement = true; }]
  ]) it('rejects ' + name, () => { const value = fixture(); mutate(value); expect(() => qualifyAudioProfileReport(value)).to.throw(); });
  it('keeps constructor absence explicit instead of reporting zero CPU or latency', () => {
    const value = fixture(); Object.assign(value.engines[0], { available: false, reason: 'native-AudioContext-absent', profiles: [], final: null });
    expect(qualifyAudioProfileReport(value)).to.include({ available: 0, profiles: 0 });
    value.engines[0].final = {}; expect(() => qualifyAudioProfileReport(value)).to.throw('Contradictory');
  });
});
