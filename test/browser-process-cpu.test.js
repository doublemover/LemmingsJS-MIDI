import { expect } from 'chai';
import { parseLinuxProcessCpu, selectBrowserProcessTree, compareBrowserProcessCpu, createBrowserProcessCpuObserver, summarizeProfileSamples } from '../scripts/BrowserProcessCpu.js';
const row = (pid, parentPid, cpuNs, identity = '10') => ({ pid, parentPid, cpuNs: String(cpuNs), identity });
const snapshot = (startedMs, processes) => ({ schema: 'lemmings-browser-process-cpu/v1', platform: 'test', rootPid: 5, startedMs, completedMs: startedMs + 10, processes });
describe('bounded owned browser process CPU observations', () => {
  it('parses CPU jiffies independently of spaces and parentheses in a process name', () => {
    const fields = Array(25).fill('0'); fields[0] = 'S'; fields[1] = '5'; fields[11] = '120'; fields[12] = '30'; fields[19] = '1000';
    expect(parseLinuxProcessCpu('9 (worker ) name) ' + fields.join(' '), 100)).to.deep.equal(row(9, 5, 1500000000, '1000'));
    expect(() => parseLinuxProcessCpu('bad', 100)).to.throw(); expect(() => parseLinuxProcessCpu('9 (x) ' + fields.join(' '), 0)).to.throw();
  });
  it('attributes descendants exactly once and excludes the sampler, parent and unrelated applications', () => {
    const records = [row(0, 0, 0), row(1, 0, 1), row(5, 1, 2), row(7, 5, 3), row(9, 7, 4), row(10, 1, 100000)];
    expect(selectBrowserProcessTree(records, 5).map(value => value.pid)).to.deep.equal([5, 7, 9]);
    expect(() => selectBrowserProcessTree([row(5, 7, 1), row(7, 5, 1)], 5)).to.throw('Cyclic');
    expect(() => selectBrowserProcessTree([...records, row(5, 0, 1)], 5)).to.throw('record');
  });
  it('reports actual CPU delta, midpoint wall time and sampler uncertainty without normalizing multiple cores to one', () => {
    const before = snapshot(0, [row(5, 1, 100000000), row(7, 5, 0)]), after = snapshot(1000, [row(5, 1, 700000000), row(7, 5, 900000000)]);
    expect(compareBrowserProcessCpu(before, after)).to.include({ cpuMs: 1500, wallMs: 1000, coreEquivalent: 1.5, matchedProcesses: 2, populationStable: true, samplingUncertaintyMs: 10 });
    const replaced = snapshot(1000, [row(5, 1, 200000000), row(7, 5, 5000000000, '11')]);
    expect(compareBrowserProcessCpu(before, replaced)).to.include({ cpuMs: 100, matchedProcesses: 1, populationStable: false });
    expect(() => compareBrowserProcessCpu(before, snapshot(1000, [row(5, 1, 0)]))).to.throw('regressed');
    expect(() => compareBrowserProcessCpu(before, snapshot(1000, [row(5, 1, 0, '11')]))).to.throw('replaced');
    expect(() => compareBrowserProcessCpu(before, snapshot(-1, before.processes))).to.throw('Incompatible');
  });
  it('records coarse empirical percentiles without rewriting the original samples or turning missing data into zero', () => {
    const values = [0.3, 0.1, 0.2]; expect(summarizeProfileSamples(values)).to.deep.equal({ samples: 3, minimum: 0.1, median: 0.2, p95: 0.3, maximum: 0.3 });
    expect(values).to.deep.equal([0.3, 0.1, 0.2]); for (const bad of [[], [NaN], [-1], Array(33).fill(0)]) expect(() => summarizeProfileSamples(bad)).to.throw();
  });
  it('uses only bounded read-only Windows counters and preserves birth identity and native large integers', async () => {
    const calls = []; let time = 0;
    const observer = createBrowserProcessCpuObserver({ platform: 'win32', nowMs: () => time++, run: async (...args) => { calls.push(args); return { stdout: JSON.stringify([row(5, 1, '900719925474099300')]) }; } });
    const value = await observer.sample(5); expect(value.processes[0].cpuNs).to.equal('900719925474099300'); expect(calls[0][0]).to.equal('powershell.exe');
    expect(calls[0][1].join(' ')).not.to.include('CommandLine'); expect(calls[0][2]).to.include({ windowsHide: true, maxBuffer: 4 * 1048576 });
  });
  it('bounds Linux discovery, reuses the actual tick rate and tolerates exited processes without attributing them', async () => {
    const fields = Array(25).fill('0'); fields[0] = 'S'; fields[1] = '1'; fields[11] = '100'; fields[19] = '10'; let queries = 0, time = 0;
    const observer = createBrowserProcessCpuObserver({ platform: 'linux', nowMs: () => time++, run: async () => { queries++; return { stdout: '100\n' }; }, readdir: async () => ['5', '6', 'sys'],
      readFile: async file => { if (file.includes('/6/')) throw new Error('Exited'); return '5 (browser) ' + fields.join(' '); } });
    expect((await observer.sample(5)).processes).to.have.length(1); await observer.sample(5); expect(queries).to.equal(1);
    const unsupported = createBrowserProcessCpuObserver({ platform: 'other' }); let error; try { await unsupported.sample(5); } catch (caught) { error = caught; } expect(error.message).to.include('unavailable');
  });
});
