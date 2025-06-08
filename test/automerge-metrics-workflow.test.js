import { expect } from 'chai';
import fs from 'fs';
import yaml from 'js-yaml';

describe('automerge repository workflow', function () {
  it('syncs tools from master', function () {
    const text = fs.readFileSync('.github/workflows/automerge-repo.yml', 'utf8');
    const config = yaml.load(text);
    const steps = config.jobs['auto-merge'].steps;
    const syncStep = steps.find(
      s => s.run && s.run.includes('git checkout origin/master -- tools')
    );
    expect(syncStep, 'sync tools step missing').to.exist;
  });
});
