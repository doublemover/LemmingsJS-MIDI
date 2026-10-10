import { expect } from 'chai';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
describe('real-action procgen behavior regressions', () => {
  let results;
  before(() => {
    // Keep process isolation until the complete suite has verified scoped action fixtures.
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/bench-procgen-behavior.js', import.meta.url)), '--policy=current'], { encoding: 'utf8', timeout: 15000 });
    results = JSON.parse(output).results;
  });
  for (const fixture of ['retired-blocker', 'shallow-step', 'pit']) {
    it(`reaches the ${fixture} goal with current real-action policy`, () => {
      const current = results.find(r => r.fixture === fixture && r.policy === 'current');
      expect(current.reachedGoal).to.equal(true); expect(current.survival).to.equal(1);
      expect(current.rendered).to.equal(false);
      if (fixture === 'pit') expect(current.assists).to.have.length(1);
    });
  }
});
