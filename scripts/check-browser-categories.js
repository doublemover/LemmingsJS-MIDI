import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WORKSTATION_TEST_MATCH, collectBrowserCases, validateWorkstationCollection } from './BrowserTestCatalog.js';

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
export function checkBrowserCategories({ output = '.tmp/browser-category-selection.json', run = spawnSync, log = console.log } = {}) {
  const expectedFiles = readdirSync(path.join(root, 'e2e'), { recursive: true }).map(file => file.replace(/\\/g, '/')).filter(file => WORKSTATION_TEST_MATCH.test(file)).sort();
  const env = { ...process.env };
  for (const key of ['PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'PLAYWRIGHT_JSON_OUTPUT_FILE']) delete env[key];
  const collect = smoke => {
    const result = run(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--project=workstation', '--list', '--reporter=json', ...(smoke ? ['--grep', '@boundary'] : [])],
      { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1048576, env });
    if (result.error || result.status !== 0) throw new Error('Playwright collection failed: ' + (result.error?.message || result.stderr || result.stdout));
    return collectBrowserCases(JSON.parse(result.stdout), 'workstation');
  };
  const full = collect(false), smoke = collect(true), selection = validateWorkstationCollection({ full, smoke, expectedFiles });
  const git = args => { const result = run('git', args, { cwd: root, encoding: 'utf8' }); if (result.status !== 0) throw new Error('Cannot bind browser selection to its Git source.'); return result.stdout.trim(); };
  const helperFiles = readdirSync(path.join(root, 'e2e/helpers'), { recursive: true }).map(file => file.replace(/\\/g, '/')).filter(file => file.endsWith('.js')).sort().map(file => 'e2e/helpers/' + file);
  const runtimeFiles = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'js', 'css', 'test/support', 'procgen.html', 'provenance/runtime-artifacts.json']).split('\0').filter(Boolean);
  const sourceFiles = [...new Set(['playwright.config.js', 'package.json', 'scripts/BrowserTestCatalog.js', 'scripts/check-browser-categories.js', 'scripts/check-browser-results.js', 'scripts/qualify-workstation-gates.js', ...expectedFiles.map(file => 'e2e/' + file), ...helperFiles, ...runtimeFiles])].sort();
  const receipt = { ...selection, source: { head: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']), node: process.version,
    files: sourceFiles.map(file => ({ file, sha256: createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex') })) }, full, smoke,
  scope: 'Collected desktop browser workflows only. Unsupported hardware, receiver/acoustic output and actual assistive technology remain manual/not-run.' };
  const target = path.resolve(root, output); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(receipt, null, 2) + '\n');
  log(`Workstation project: ${selection.fullCount} full / ${selection.smokeCount} PR smoke cases across ${selection.files.length} files.`);
  for (const file of selection.files) log(`  ${file}: ${full.filter(test => test.file === file).length} full / ${smoke.filter(test => test.file === file).length} smoke`);
  for (const category of selection.categories) log(`  ${category.category}: ${category.count} smoke`);
  log('Browser selection receipt: ' + target); return receipt;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); if (args.some(arg => !arg.startsWith('--output=')) || args.length > 1) throw new Error('Usage: check-browser-categories.js [--output=receipt.json]');
    checkBrowserCategories(args[0] ? { output: args[0].slice('--output='.length) } : {});
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
