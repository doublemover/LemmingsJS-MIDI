import { expect } from 'chai';
import fs from 'node:fs';

const readText = (path) => fs.readFileSync(path, 'utf8');

const extractNpmScripts = (markdown) => {
  const scripts = new Set();
  const commandRegex = /`(npm(?: run)? [^`]+?)`/g;
  for (const match of markdown.matchAll(commandRegex)) {
    const command = match[1].trim();
    if (command === 'npm test' || command.startsWith('npm test ')) {
      scripts.add('test');
      continue;
    }
    const scriptMatch = command.match(/^npm run ([^\s`]+)/);
    if (scriptMatch) scripts.add(scriptMatch[1]);
  }
  return scripts;
};

describe('milestone checkpoint guidance docs', function() {
  it('keeps documented npm commands aligned with package scripts', function() {
    const packageJson = JSON.parse(readText('package.json'));
    const documentedScripts = new Set([
      ...extractNpmScripts(readText('docs/TESTING.md')),
      ...extractNpmScripts(readText('docs/playwright-tests.md'))
    ]);

    for (const script of documentedScripts) {
      expect(packageJson.scripts, `missing package script ${script}`).to.have.property(script);
    }
  });

  it('documents the disposable milestone capture and closeout contract', function() {
    const testingDoc = readText('docs/TESTING.md');
    const playwrightDoc = readText('docs/playwright-tests.md');

    expect(testingDoc).to.contain('## Milestone checkpoint evidence');
    expect(testingDoc).to.contain('Issues:');
    expect(testingDoc).to.contain('Skipped checks:');
    expect(testingDoc).to.contain('Follow-up risks:');
    expect(playwrightDoc).to.contain('## Milestone Capture Matrix');
    for (const script of [
      'capture:e2e:midi',
      'capture:e2e:editor',
      'capture:e2e:procgen',
      'capture:e2e:game-hud'
    ]) {
      expect(playwrightDoc).to.contain(`npm run ${script}`);
    }
    expect(playwrightDoc).to.contain('temp/e2e-captures/');
    expect(playwrightDoc).to.contain('do not commit screenshots');
  });
});
