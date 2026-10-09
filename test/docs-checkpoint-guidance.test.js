import { expect } from 'chai';
import fs from 'node:fs';

describe('documented testing commands', () => {
  it('resolve to maintained package scripts', () => {
    const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
    const names = new Set();
    for (const file of ['docs/TESTING.md', 'docs/playwright-tests.md']) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bnpm run ([\w:-]+)/g)) names.add(match[1]);
      if (/\bnpm test\b/.test(text)) names.add('test');
    }
    expect(names.size).to.be.greaterThan(0);
    for (const name of names) expect(scripts, 'documented command ' + name).to.have.property(name);
  });
});
