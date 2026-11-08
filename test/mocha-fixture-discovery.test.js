import { expect } from 'chai';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

describe('Node and browser fixture discovery boundary', () => {
  it('loads real tests without importing a browser-only extension as a Node module', function() {
    this.timeout(15000);
    const output = execFileSync(process.execPath, [require.resolve('mocha/bin/mocha.js'), '--dry-run', '--reporter=json',
      'test/support/workstation-zoom/background.js', 'test/midi/ump-packet-codec.test.js'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024
    });
    const report = JSON.parse(output); expect(report.stats.tests).to.be.greaterThan(0); expect(report.stats.failures).to.equal(0);
    expect(report.tests.every(test => !test.file?.replaceAll('\\', '/').includes('/test/support/'))).to.equal(true);
  });
});
