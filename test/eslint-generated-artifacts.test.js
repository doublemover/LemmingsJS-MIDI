import { expect } from 'chai';
import { ESLint } from 'eslint';

describe('formatter generated-artifact boundary', () => {
  it('ignores generated browser generations and trace/vendor copies before rules or fixes apply', async () => {
    const lint = new ESLint();
    for (const file of ['dist/browser/generation/js/vendor/webmidi.js', 'dist/browser/generation/js/game/GameTimer.js',
      'test-results/run/traces/resources/vendor.js', 'playwright-report/assets/script.js', 'coverage/lcov-report/sorter.js']) {
      expect(await lint.isPathIgnored(file), file).to.equal(true);
    }
  });
  it('continues to guard real runtime sources and does not format the original vendor files', async () => {
    const lint = new ESLint();
    expect(await lint.isPathIgnored('js/vendor/webmidi.js')).to.equal(true);
    expect(await lint.isPathIgnored('js/game/GameTimer.js')).to.equal(false);
    const config = await lint.calculateConfigForFile('js/game/GameTimer.js');
    expect(config.rules['no-undef'][0]).to.equal(2); expect(config.rules['no-restricted-globals'][0]).to.equal(2);
  });
});
