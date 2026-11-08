import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { qualifyWorkstationResults } from './BrowserTestCatalog.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function verifyBrowserSelectionSource(selection, { rootDir = root } = {}) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
  if (revision.status !== 0 || revision.stdout.trim() !== selection.source.head) throw new Error('Browser source revision changed after collection.');
  for (const source of selection.source.files) {
    const digest = createHash('sha256').update(readFileSync(path.join(rootDir, source.file))).digest('hex');
    if (digest !== source.sha256) throw new Error('Browser source changed after collection: ' + source.file);
  }
  return selection.source;
}
export function checkBrowserResults({ smoke = false, sourceOnly = false, rootDir = root } = {}) {
  const selection = JSON.parse(readFileSync(path.join(rootDir, '.tmp/browser-category-selection.json'), 'utf8'));
  verifyBrowserSelectionSource(selection, { rootDir });
  if (sourceOnly) return { sourceOnly: true, source: selection.source };
  const resultPath = path.join(rootDir, '.tmp/workstation-results.json'), report = JSON.parse(readFileSync(resultPath, 'utf8'));
  const result = qualifyWorkstationResults(report), key = test => `${test.file}:${test.line}:${test.title}`;
  const expected = (smoke ? selection.smoke : selection.full).map(key).sort(), actual = result.cases.map(key).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Executed browser cases differ from the required collected selection.');
  const qualification = { source: selection.source, project: result.project, mode: smoke ? 'smoke' : 'full', passed: result.passed, skipped: result.skipped,
    categories: result.categories, reportSha256: createHash('sha256').update(readFileSync(resultPath)).digest('hex'), durationMs: report.stats?.duration,
    hardware: 'not-run', receiverAndAcoustics: 'not-run', actualAssistiveTechnology: 'not-run' };
  writeFileSync(path.join(rootDir, '.tmp/workstation-result-qualification.json'), JSON.stringify(qualification, null, 2) + '\n');
  return qualification;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--smoke', '--source-only'].includes(arg))) throw new Error('Usage: check-browser-results.js [--smoke|--source-only]');
  const result = checkBrowserResults({ smoke: args.includes('--smoke'), sourceOnly: args.includes('--source-only') });
  if (result.sourceOnly) console.log(`Browser source ${result.source.head}: ${result.source.files.length} file hashes unchanged.`);
  else console.log(`Workstation ${result.mode}: ${result.passed} passed / ${result.skipped.length} explicit benchmark skips; every required capability passed on the collected source.`);
}
