import { expect } from 'chai';
import { waitForNativeProfileWarmup } from '../scripts/qualify-audio-profiles.mjs';
const state = audioSeconds => ({ audioSeconds, contextState: 'running', activeVoices: 64 });
describe('native render progress before profile sampling', () => {
  it('waits through a running-but-frozen startup clock without moving the original onset', async () => {
    let host = 0;
    const result = await waitForNativeProfileWarmup({ firstTargetSeconds: 0.25, voices: 64, nowMs: () => host,
      read: async () => state(Math.max(0, host - 1000) / 1000), wait: async ms => { host += ms; } });
    expect(result).to.include({ status: 'passed', firstTargetSeconds: 0.25, frontierSeconds: 0.75, elapsedMs: 1750 }); expect(result.last.audioSeconds).to.equal(0.75);
  });
  it('refuses a permanently frozen native clock with its original failed readiness receipt', async () => {
    let host = 0, failure;
    try { await waitForNativeProfileWarmup({ firstTargetSeconds: 0.25, voices: 64, deadlineMs: 100, nowMs: () => host, read: async () => state(0.013333), wait: async ms => { host += ms; } }); } catch (error) { failure = error; }
    expect(failure?.message).to.include('deadline'); expect(failure.warmup).to.include({ status: 'failed', elapsedMs: 100, firstTargetSeconds: 0.25 }); expect(failure.warmup.last.audioSeconds).to.equal(0.013333);
  });
  for (const observed of [{ ...state(0), contextState: 'suspended' }, { ...state(0), activeVoices: 63 }, state(NaN)]) it('refuses unavailable native readiness ' + JSON.stringify(observed), async () => {
    let failure; try { await waitForNativeProfileWarmup({ firstTargetSeconds: 0.25, voices: 64, read: async () => observed }); } catch (error) { failure = error; }
    expect(failure?.warmup?.status).to.equal('failed');
  });
  it('accepts an already rendered workload without another context or another admission target', async () => {
    const result = await waitForNativeProfileWarmup({ firstTargetSeconds: 0.25, voices: 64, nowMs: () => 100, read: async () => state(1) });
    expect(result).to.include({ status: 'passed', elapsedMs: 0, polls: 1, firstTargetSeconds: 0.25 });
  });
});
