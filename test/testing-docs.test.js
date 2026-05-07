import fs from 'node:fs';
import { expect } from 'chai';

const testingDoc = fs.readFileSync('docs/TESTING.md', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const extractNpmRunScripts = (text) => {
  const scripts = new Set();
  const pattern = /`npm run ([^`\s]+)(?:\s+[^`]*)?`/g;
  let match;
  while ((match = pattern.exec(text))) {
    scripts.add(match[1]);
  }
  return [...scripts].sort();
};

describe('testing documentation', function () {
  it('keeps milestone checkpoint commands aligned with package scripts', function () {
    const section = testingDoc.split('## Milestone checkpoint evidence')[1] || '';
    expect(section).to.include('Capture matrix');
    const documentedScripts = extractNpmRunScripts(section);
    expect(documentedScripts).to.include.members([
      'capture:e2e:midi',
      'capture:e2e:editor',
      'capture:e2e:procgen',
      'test-e2e',
      'test-e2e:harness',
      'test-editor',
      'bench-procgen-soak',
      'test-bench-unit',
      'format',
      'check-undefined',
      'lint',
      'typecheck:critical'
    ]);
    const missing = documentedScripts.filter(script => !packageJson.scripts[script]);
    expect(missing).to.deep.equal([]);
  });

  it('documents disposable capture output instead of committed artifacts', function () {
    const section = testingDoc.split('## Milestone checkpoint evidence')[1] || '';
    expect(section).to.include('temp/e2e-captures/');
    expect(section).to.include('do not create committed galleries or manifests');
    expect(section).to.include('Use `npm run release-readiness` only when');
  });
});
