import { expect } from 'chai';
import fs from 'fs';
import yaml from 'js-yaml';

describe('dependency-review workflow', function () {
  it('sets comment-summary-in-pr and fail-on-severity', function () {
    const text = fs.readFileSync('.github/workflows/dependency-review.yml', 'utf8');
    const data = yaml.load(text);
    const jobs = data.jobs || {};
    const workflow = jobs['dependency-review'];
    expect(workflow).to.be.an('object');
    const step = workflow.steps.find(s => s.uses && s.uses.startsWith('actions/dependency-review-action'));
    expect(step).to.be.an('object');
    expect(step.with['comment-summary-in-pr']).to.equal('always');
    expect(step.with['fail-on-severity']).to.equal('moderate');
  });
});
