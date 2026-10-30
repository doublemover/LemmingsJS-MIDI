import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { encodeSurveyWorkerJson } from '../scripts/procgen-survey/SurveyWorkerIngress.js';

const execute = promisify(execFile);
describe('survey worker ingress subprocess containment', function() {
  this.timeout(15000);
  for (const mode of ['null', 'undefined', 'scalar', 'unknown', 'missing', 'unreserved-cycle', 'permitted-cycle', 'bigint', 'send-failure', 'preserve-original'])
    it(`returns supervised infrastructure evidence after ${mode}`, async () => {
      const { stdout, stderr } = await execute(process.execPath, [fileURLToPath(new URL('./fixtures/survey-worker-ingress-probe.js', import.meta.url)), mode],
        { timeout: 8000, maxBuffer: 1048576 });
      expect(stderr).to.equal(''); const report = JSON.parse(stdout);
      expect(report.cancelled).to.equal(true); expect(report.error).to.be.a('string'); expect(report.orphanWorkers).to.equal(0);
      expect(report.storage).to.include({ pendingResultCount: 0, pendingResultBytes: 0 });
      expect(report.controlState.stepPending).to.equal(false);
      expect(report.workerFailures).not.to.have.length(0);
      const failed = report.results.find(result => result.trialId === 'faulty');
      expect(failed).to.include({ status: 'interrupted', episodeComplete: false });
      if (mode === 'unreserved-cycle') expect(report.error).to.include('Unreserved');
      if (mode === 'preserve-original') {
        expect(report.results.find(result => result.trialId === 'original')).to.include({ status: 'completed', lastTick: 8 });
        expect(report.persistence.find(receipt => receipt.trialId === 'original')).to.include({ status: 'committed', bytes: report.persistence[0].bytes });
        expect(report.persistence.find(receipt => receipt.trialId === 'original').digest).to.match(/^[a-f0-9]{64}$/);
      }
    });
  it('bounds decoded graph shape before hashing or recursive freezing', () => {
    const cycle = {}; cycle.self = cycle;
    for (const value of [cycle, { value: 1n }, { value: new Map() }, { value: NaN }, { value: 'x'.repeat(1024) }])
      expect(() => encodeSurveyWorkerJson(value, { maxBytes: 256 })).to.throw();
    expect(encodeSurveyWorkerJson({ value: -0, optional: undefined }, { maxBytes: 256 }).encoded).to.equal('{"value":0}');
  });
});
