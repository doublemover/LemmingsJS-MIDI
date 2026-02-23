#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mochaBin = require.resolve('mocha/bin/mocha.js');
const eslintBin = path.join(
  path.dirname(require.resolve('eslint/package.json')),
  'bin',
  'eslint.js'
);
const tscBin = path.join(
  path.dirname(require.resolve('typescript/package.json')),
  'bin',
  'tsc'
);
const CHECK_JS_CONFIG = 'tsconfig.checkjs.json';
const DEFAULT_TEST_RUNTIME_BUDGET_MS = 180000;

const RUNTIME_GUARD_TARGETS = Object.freeze([
  'js/game/**/*.js',
  'js/lemmings/**/*.js',
  'js/midi/**/*.js',
  'js/util/**/*.js'
]);

const CATEGORY_PATTERNS = Object.freeze({
  core: ['--recursive'],
  bench: ['test/*bench*.test.js'],
  release: ['test/release-readiness.test.js'],
  workflow: ['test/*workflow*.test.js'],
  tools: ['test/tools/*.test.js'],
  'offline-tools': ['test/offline-tools/*.test.js'],
  editor: ['test/editor/*.test.js']
});

const CATEGORY_ORDER = Object.freeze([
  'core',
  'editor',
  'tools',
  'offline-tools',
  'bench',
  'release',
  'workflow'
]);

const parseBoolEnv = (value) => {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const toNumberOrNaN = (value) => {
  try {
    return Number(value);
  } catch {
    return Number.NaN;
  }
};

const resolveRuntimeBudgetMs = (value) => {
  const parsed = toNumberOrNaN(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TEST_RUNTIME_BUDGET_MS;
  return Math.trunc(parsed);
};

const parseCliArgs = (argv = []) => {
  const result = {
    changed: false,
    baseRef: null,
    categories: []
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || '');
    if (!arg) continue;
    if (arg === '--changed') {
      result.changed = true;
      continue;
    }
    if (arg.startsWith('--base=')) {
      const value = arg.slice('--base='.length).trim();
      if (!value) {
        throw new Error('Missing value for --base');
      }
      result.baseRef = value;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    result.categories.push(arg);
  }

  return result;
};

const normalizeFilePath = (filePath) => String(filePath || '').replace(/\\/g, '/');

const inferCategoriesFromChangedFiles = (files) => {
  const categories = new Set();
  if (!Array.isArray(files) || files.length === 0) {
    categories.add('core');
    return Array.from(categories);
  }

  for (const file of files) {
    const normalized = normalizeFilePath(file);
    if (!normalized) continue;

    if (
      normalized === 'docs/release-readiness.md' ||
      normalized.startsWith('scripts/check-release-readiness') ||
      normalized === 'test/release-readiness.test.js'
    ) {
      categories.add('release');
      continue;
    }

    if (
      normalized.startsWith('docs/') ||
      normalized.endsWith('.md') ||
      normalized === 'README' ||
      normalized === 'README.md'
    ) {
      categories.add('core');
      continue;
    }

    if (
      normalized.startsWith('js/editor/') ||
      normalized.startsWith('js/app/editor') ||
      normalized.startsWith('css/editor') ||
      normalized.startsWith('test/editor/')
    ) {
      categories.add('editor');
      continue;
    }

    if (
      normalized.startsWith('tools/offline/') ||
      normalized.startsWith('test/offline-tools/')
    ) {
      categories.add('offline-tools');
      continue;
    }

    if (
      normalized.startsWith('tools/') ||
      normalized.startsWith('test/tools/') ||
      normalized.startsWith('scripts/check-undefined') ||
      normalized.startsWith('scripts/check-mcp-client-compat')
    ) {
      categories.add('tools');
      continue;
    }

    if (
      normalized.startsWith('scripts/bench-') ||
      /^test\/bench.*\.test\.js$/.test(normalized)
    ) {
      categories.add('bench');
      continue;
    }

    if (
      normalized.startsWith('.github/workflows/') ||
      /^test\/.*workflow.*\.test\.js$/.test(normalized)
    ) {
      categories.add('workflow');
      continue;
    }

    if (
      normalized.startsWith('js/') ||
      normalized.startsWith('test/') ||
      normalized.startsWith('mcp/') ||
      normalized.startsWith('scripts/') ||
      normalized.startsWith('css/') ||
      normalized === 'package.json'
    ) {
      categories.add('core');
      continue;
    }

    categories.add('core');
  }

  return Array.from(categories);
};

const defaultRunGitCommand = (args) => spawnSync('git', args, { encoding: 'utf8' });

const readGitFileList = (args, runGitCommand = defaultRunGitCommand) => {
  const result = runGitCommand(args);
  if (!result || result.error || result.status !== 0) {
    return null;
  }
  const stdout = String(result.stdout || '');
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const collectChangedFiles = ({ baseRef = null, runGitCommand = defaultRunGitCommand } = {}) => {
  const files = new Set();
  const baseSpec = baseRef ? `${baseRef}...HEAD` : 'HEAD';

  const compared = readGitFileList(['diff', '--name-only', '--diff-filter=ACMRD', baseSpec], runGitCommand);
  if (!compared) return null;
  for (const file of compared) files.add(file);

  const staged = readGitFileList(['diff', '--name-only', '--cached', '--diff-filter=ACMRD'], runGitCommand) || [];
  for (const file of staged) files.add(file);

  const unstaged = readGitFileList(['diff', '--name-only', '--diff-filter=ACMRD'], runGitCommand) || [];
  for (const file of unstaged) files.add(file);

  const untracked = readGitFileList(['ls-files', '--others', '--exclude-standard'], runGitCommand) || [];
  for (const file of untracked) files.add(file);

  return Array.from(files).sort((a, b) => a.localeCompare(b));
};

const validateCategories = (categories) => {
  for (const category of categories) {
    if (!CATEGORY_PATTERNS[category]) {
      throw new Error(`Unknown category: ${category}`);
    }
  }
};

const buildMochaArgsForCategories = (categories) => {
  const unique = new Set(categories);
  validateCategories(unique);
  if (unique.has('core')) {
    return ['--recursive'];
  }

  const args = [];
  for (const category of CATEGORY_ORDER) {
    if (!unique.has(category)) continue;
    args.push(...CATEGORY_PATTERNS[category]);
  }
  return args.length ? args : ['--recursive'];
};

const runMocha = (
  args,
  {
    spawn = spawnSync,
    log = console,
    exit = process.exit,
    enforceBudget = false,
    budgetMs = DEFAULT_TEST_RUNTIME_BUDGET_MS,
    preRunElapsedMs = 0
  } = {}
) => {
  const mochaStart = Date.now();
  const res = spawn(process.execPath, [mochaBin, ...args], { stdio: 'inherit' });
  const mochaElapsedMs = Math.max(0, Date.now() - mochaStart);
  const totalElapsedMs = preRunElapsedMs + mochaElapsedMs;
  if (res.error) {
    log.error(`Failed to run mocha: ${res.error.message}`);
    exit(1);
    return;
  }
  if (typeof res.status !== 'number') {
    log.error('Mocha exited without a status code.');
    exit(1);
    return;
  }
  if (res.status === 0) {
    log.log(`Test runtime: ${(totalElapsedMs / 1000).toFixed(2)}s (budget ${(budgetMs / 1000).toFixed(2)}s)`);
    if (enforceBudget && totalElapsedMs > budgetMs) {
      log.error(`Test runtime budget exceeded: ${totalElapsedMs}ms > ${budgetMs}ms`);
      exit(1);
      return;
    }
  }
  exit(res.status);
};

const runRuntimeGlobalGuard = (
  {
    spawn = spawnSync,
    log = console,
    exit = process.exit
  } = {}
) => {
  const args = ['--max-warnings=0', ...RUNTIME_GUARD_TARGETS];
  const res = spawn(process.execPath, [eslintBin, ...args], { stdio: 'inherit' });
  if (res.error) {
    log.error(`Failed to run runtime global guard: ${res.error.message}`);
    exit(1);
    return false;
  }
  if (typeof res.status !== 'number') {
    log.error('Runtime global guard exited without a status code.');
    exit(1);
    return false;
  }
  if (res.status !== 0) {
    exit(res.status);
    return false;
  }
  return true;
};

const runCriticalTypecheckGuard = (
  {
    spawn = spawnSync,
    log = console,
    exit = process.exit
  } = {}
) => {
  const args = ['-p', CHECK_JS_CONFIG, '--pretty', 'false'];
  const res = spawn(process.execPath, [tscBin, ...args], { stdio: 'inherit' });
  if (res.error) {
    log.error(`Failed to run critical typecheck guard: ${res.error.message}`);
    exit(1);
    return false;
  }
  if (typeof res.status !== 'number') {
    log.error('Critical typecheck guard exited without a status code.');
    exit(1);
    return false;
  }
  if (res.status !== 0) {
    exit(res.status);
    return false;
  }
  return true;
};

const main = (
  argv = process.argv.slice(2),
  {
    spawn = spawnSync,
    runGitCommand = defaultRunGitCommand,
    log = console,
    exit = process.exit
  } = {}
) => {
  const runStartMs = Date.now();
  const enforceRuntimeBudget = parseBoolEnv(process.env.LEMMINGS_TEST_ENFORCE_BUDGET);
  const runtimeBudgetMs = resolveRuntimeBudgetMs(process.env.LEMMINGS_TEST_BUDGET_MS);
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    log.error(error.message);
    exit(1);
    return;
  }

  const categories = new Set(parsed.categories);

  if (parsed.changed) {
    const changedFiles = collectChangedFiles({
      baseRef: parsed.baseRef,
      runGitCommand
    });
    if (!changedFiles) {
      log.warn('Unable to resolve changed files from git; falling back to full suite.');
      categories.add('core');
    } else {
      const inferred = inferCategoriesFromChangedFiles(changedFiles);
      for (const category of inferred) {
        categories.add(category);
      }
      log.log(`Changed-file test selection: ${Array.from(categories).sort().join(', ')}`);
    }
  }

  if (categories.size === 0) {
    categories.add('core');
  }

  let mochaArgs;
  try {
    mochaArgs = buildMochaArgsForCategories(Array.from(categories));
  } catch (error) {
    log.error(error.message);
    exit(1);
    return;
  }

  if (!runRuntimeGlobalGuard({ spawn, log, exit })) {
    return;
  }
  if (!runCriticalTypecheckGuard({ spawn, log, exit })) {
    return;
  }
  const preMochaElapsedMs = Math.max(0, Date.now() - runStartMs);
  runMocha(mochaArgs, {
    spawn,
    log,
    exit,
    enforceBudget: enforceRuntimeBudget,
    budgetMs: runtimeBudgetMs,
    preRunElapsedMs: preMochaElapsedMs
  });
};

const isMain = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch (error) {
    return false;
  }
})();

if (isMain) {
  main();
}

export {
  CATEGORY_PATTERNS,
  RUNTIME_GUARD_TARGETS,
  buildMochaArgsForCategories,
  collectChangedFiles,
  inferCategoriesFromChangedFiles,
  main,
  parseCliArgs,
  parseBoolEnv,
  runCriticalTypecheckGuard,
  resolveRuntimeBudgetMs,
  runRuntimeGlobalGuard
};
