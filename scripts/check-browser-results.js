import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualifyWorkstationResults } from './BrowserTestCatalog.js';

const root = fileURLToPath(new URL('../', import.meta.url)), args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--smoke')) throw new Error('Usage: check-browser-results.js [--smoke]');
const selection = JSON.parse(readFileSync(path.join(root, '.tmp/browser-category-selection.json'), 'utf8'));
const resultPath = path.join(root, '.tmp/workstation-results.json'), report = JSON.parse(readFileSync(resultPath, 'utf8'));
const result = qualifyWorkstationResults(report), key = test => `${test.file}:${test.line}:${test.title}`;
const expected = (args.includes('--smoke') ? selection.smoke : selection.full).map(key).sort(), actual = result.cases.map(key).sort();
if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Executed browser cases differ from the required collected selection.');
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (revision.status !== 0 || revision.stdout.trim() !== selection.source.head) throw new Error('Browser source revision changed after collection.');
for (const source of selection.source.files) {
  const digest = createHash('sha256').update(readFileSync(path.join(root, source.file))).digest('hex');
  if (digest !== source.sha256) throw new Error('Browser source changed after collection: ' + source.file);
}
const qualification = { source: selection.source, project: result.project, mode: args.includes('--smoke') ? 'smoke' : 'full', passed: result.passed, skipped: result.skipped,
  categories: result.categories, reportSha256: createHash('sha256').update(readFileSync(resultPath)).digest('hex'), durationMs: report.stats?.duration,
  hardware: 'not-run', receiverAndAcoustics: 'not-run', actualAssistiveTechnology: 'not-run' };
writeFileSync(path.join(root, '.tmp/workstation-result-qualification.json'), JSON.stringify(qualification, null, 2) + '\n');
console.log(`Workstation ${qualification.mode}: ${qualification.passed} passed / ${qualification.skipped.length} explicit benchmark skips; every required capability passed on the collected source.`);
