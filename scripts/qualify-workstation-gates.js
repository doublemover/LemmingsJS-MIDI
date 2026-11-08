import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const mutations = [
  { id: 'save-cancel', category: '@workstation-save-cancel', error: /expect\(.*\)|toEqual/ },
  { id: 'world-rollback', category: '@workstation-world-rollback', error: /toMatchObject/ },
  { id: 'causal-output', category: '@workstation-physical-music', error: /toBeGreaterThan|waitForFunction: Timeout/ },
  { id: 'local-audio', category: '@workstation-local-audio', error: /toBeGreaterThan/ }
];
const reports = path.join(root, '.tmp/workstation-gate-qualification'); mkdirSync(reports, { recursive: true });
const runId = randomUUID();
const summary = { source: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), runId, node: process.version, mutations: [], hardware: 'not-run', acousticOutput: 'not-run' };
for (const mutation of mutations) {
  const reportFile = path.join(reports, mutation.id + '-results.json'), proofFile = path.join(reports, mutation.id + '-proof.json');
  const result = spawnSync(process.execPath, ['scripts/run-browser-boundaries.js', '--project=workstation', '--grep', mutation.category, '--workers=1', '--reporter=json', '--output=.tmp/workstation-gate-qualification/' + mutation.id],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1048576, env: { ...process.env, LEMMINGS_BROWSER_GATE_MUTATION: mutation.id,
      LEMMINGS_BROWSER_MUTATION_RECEIPT: proofFile, LEMMINGS_BROWSER_MUTATION_RUN: runId, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile } });
  writeFileSync(path.join(reports, mutation.id + '.log'), (result.stdout || '') + (result.stderr || ''));
  if (result.error) throw result.error;
  const report = JSON.parse(readFileSync(reportFile, 'utf8')), proof = JSON.parse(readFileSync(proofFile, 'utf8'));
  const errors = [];
  const visit = suite => { for (const spec of suite.specs || []) for (const test of spec.tests || []) for (const run of test.results || []) for (const error of run.errors || []) errors.push(error.message || ''); for (const child of suite.suites || []) visit(child); };
  for (const suite of report.suites || []) visit(suite);
  if (result.status !== 1 || report.stats?.unexpected !== 1 || report.stats?.expected !== 0 || report.errors?.length || proof.runId !== runId || !proof.applied || !errors.some(error => mutation.error.test(error))) throw new Error('Mutation did not fail through its required behavioral gate: ' + mutation.id);
  summary.mutations.push({ ...proof, gateRejectedMutation: true, errors: errors.map(error => error.replace(/\u001b\[[0-9;]*m/g, '')) });
  console.log(mutation.id + ': required behavioral gate rejected the applied fault.');
}
writeFileSync(path.join(reports, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('All four workstation gate mutations were detected. Receipt: ' + path.join(reports, 'summary.json'));
