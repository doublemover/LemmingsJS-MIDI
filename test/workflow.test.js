import { expect } from 'chai';
import fs from 'node:fs';
import yaml from 'js-yaml';

for (const file of ['test.yml', 'maintenance-full.yml']) {
  describe('GitHub validation responsibilities: ' + file, () => {
    const config = yaml.load(fs.readFileSync('.github/workflows/' + file, 'utf8'));
    const steps = config.jobs.test.steps;
    const runs = steps.filter(step => step.run).map(step => step.run);
    it('uses supported Node and exactly one full unit/coverage pass', () => {
      const setup = steps.find(step => step.uses?.startsWith('actions/setup-node'));
      expect(Number(setup.with['node-version'])).to.be.at.least(20);
      expect(runs.filter(run => run === 'npm run coverage')).to.have.length(1);
      for (const duplicate of ['npm test', 'npm run test-bench-unit', 'npm run format']) expect(runs).not.to.include(duplicate);
    });
    it('retains each distinct static, browser, protocol and performance check once', () => {
      for (const command of ['npm ci', 'npm run check-undefined', 'npm run lint', 'npm run typecheck:critical',
        'npm run release-readiness', 'npm run depcheck', 'npm run check-mcp-clients',
        'npm run test-e2e:boundaries', 'npm run test-mcp-smoke', 'npm run bench-smoke']) {
        expect(runs.filter(run => run === command), command).to.have.length(1);
      }
      expect(runs.some(run => run.includes('git diff --check'))).to.equal(true);
      expect(runs.some(run => run.includes('git checkout origin/master -- tools'))).to.equal(false);
      expect(steps.find(step => step.name === 'Stop HTTPS server').if).to.equal('always()');
    });
  });
}
