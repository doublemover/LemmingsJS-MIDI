import { expect } from 'chai';
import fs from 'fs';
import yaml from 'js-yaml';

describe('automerge-repo merge scripts', function () {
  it('includes steps for merging repo metrics and agent info', function () {
    const text = fs.readFileSync('.github/workflows/automerge-repo.yml', 'utf8');
    const config = yaml.load(text);
    const steps = config.jobs['auto-merge'].steps;
    const expected = {
      'Auto-merge metrics.json': 'tools/merge-metrics.sh',
      'Auto-merge searchHistory': 'tools/merge-history.sh',
      'Auto-merge noResultQueries': 'tools/merge-no-results.sh',
      'Auto-merge agentInfo index.md': 'tools/merge-agentinfo-index.sh',
      'Auto-merge agentInfo index-detailed.md': 'tools/merge-agentinfo-index.sh',
      'Auto-merge agentInfo notes': 'tools/merge-agentinfo-notes.sh'
    };
    for (const [name, script] of Object.entries(expected)) {
      const step = steps.find(s => s.name === name);
      expect(step, `${name} missing`).to.exist;
      expect(step.run).to.include(script);
    }
  });
});
