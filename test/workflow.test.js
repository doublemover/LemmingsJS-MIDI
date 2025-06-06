import { expect } from 'chai';
import fs from 'fs';
import yaml from 'js-yaml';

describe('GitHub test workflow', function () {
  it('uses Node 20 and expected npm steps', function () {
    const text = fs.readFileSync('.github/workflows/test.yml', 'utf8');
    const config = yaml.load(text);
    const steps = config.jobs.test.steps;

    const setupStep = steps.find(s => s.uses && s.uses.startsWith('actions/setup-node'));
    expect(setupStep, 'setup-node step missing').to.exist;
    expect(String(setupStep.with['node-version'])).to.equal('20');

    const runSteps = steps.filter(s => s.run).map(s => s.run);
    expect(runSteps).to.include.members([
      'npm ci',
      'npm run check-undefined',
      'npm run lint',
      'npm test'
    ]);
  });
});
