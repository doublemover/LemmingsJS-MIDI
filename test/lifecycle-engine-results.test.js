import { expect } from 'chai';
import { qualifyLifecycleEngineResults } from '../scripts/LifecycleEngineResults.js';

const report = () => ({ suites: Object.entries({ 'chromium-semantic': 1, 'firefox-lifecycle': 5, 'webkit-lifecycle': 5 }).map(([project, count]) => ({
  specs: Array.from({ length: count }, (_, index) => ({ title: project + ':' + index, file: 'native.spec.js', line: index + 1, column: 1,
    tests: [{ projectName: project, expectedStatus: 'passed', results: [{ status: 'passed', attachments: index ? [] : [{ name: 'native-engine-semantics.json', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ project, browser: 'native-test-version', source: { schema: 'lemmings-engine-semantics/v1', recipe: { seed: 42, lanes: 8, ticks: 64 },
        initialTick: 0, finalTick: 64, batches: 64, facts: 128, complete: true, stablePaused: true, outputEnabled: false,
        initialHash: 'a'.repeat(64), physicsHash: 'b'.repeat(64), causalHash: 'c'.repeat(64), assets: ['asset:qualified'], audioContextAvailable: project !== 'webkit-lifecycle',
        renderer: { path: 'canvas2d_main_thread', state: 'ready', hardwareAcceleration: 'unqualified' }, viewport: { width: 1920, height: 1080 }, observerListeners: { before: 2, after: 2 } } })).toString('base64') }] }] }] })) })) });
const change = (value, apply) => { const attachment = value.suites[1].specs[0].tests[0].results[0].attachments[0], receipt = JSON.parse(Buffer.from(attachment.body, 'base64')); apply(receipt.source); attachment.body = Buffer.from(JSON.stringify(receipt)).toString('base64'); };

describe('native lifecycle engine qualification', () => {
  it('permits explicit unavailable audio while requiring all eleven cases and exact physical evidence', () => { const result = qualifyLifecycleEngineResults(report()); expect(result.passed).to.equal(11); expect(result.engines[2].source.audioContextAvailable).to.equal(false); });
  for (const key of ['physicsHash', 'causalHash']) it('rejects a one-engine ' + key + ' divergence despite every case passing', () => {
    const value = report(); change(value, source => { source[key] = 'd'.repeat(64); }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Cross-engine semantic mismatch');
  });
  it('rejects a mismatched asset inventory despite matching checkpoint hashes', () => { const value = report(); change(value, source => { source.assets = ['different']; }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('assets'); });
  it('rejects a missing required engine', () => { const value = report(); value.suites.pop(); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Required engine'); });
  it('rejects an explicitly skipped lifecycle case', () => { const value = report(); value.suites[1].specs[1].tests[0].results[0].status = 'skipped'; expect(() => qualifyLifecycleEngineResults(value)).to.throw('Required engine'); });
  it('rejects zero physical facts instead of accepting equal empty hashes', () => { const value = report(); change(value, source => { source.facts = 0; }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Incomplete native'); });
  it('rejects a leaked observer despite unchanged physics', () => { const value = report(); change(value, source => { source.observerListeners.after++; }); expect(() => qualifyLifecycleEngineResults(value)).to.throw('Incomplete native'); });
});
