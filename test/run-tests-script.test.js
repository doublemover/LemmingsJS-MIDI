import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import {
  RUNTIME_GUARD_TARGETS,
  buildMochaArgsForCategories,
  collectChangedFiles,
  formatSelectionLines,
  inferCategoriesFromChangedFiles,
  main,
  parseBoolEnv,
  parseCliArgs,
  resolveBaseRef,
  resolveRuntimeBudgetMs,
  runRuntimeGlobalGuard
} from '../scripts/runTests.js';

const createRunGitStub = (
  responsesByCommand,
  { defaultResponse = { status: 1, stdout: '' } } = {}
) => (args) => {
  const key = args.join(' ');
  const response = responsesByCommand[key];
  if (!response) {
    return defaultResponse;
  }
  return response;
};

describe('scripts/runTests', function () {
  it('parses changed/base/selection options and categories', function () {
    const parsed = parseCliArgs(['--changed', '--base=origin/main', '--print-selection', 'editor']);
    expect(parsed.changed).to.equal(true);
    expect(parsed.baseRef).to.equal('origin/main');
    expect(parsed.printSelection).to.equal(true);
    expect(parsed.categories).to.deep.equal(['editor']);
  });

  it('treats --dry-run as a selection-print alias', function () {
    const parsed = parseCliArgs(['--dry-run']);
    expect(parsed.printSelection).to.equal(true);
  });

  it('parses budget guard environment helpers', function () {
    expect(parseBoolEnv('true')).to.equal(true);
    expect(parseBoolEnv('1')).to.equal(true);
    expect(parseBoolEnv('off')).to.equal(false);
    expect(resolveRuntimeBudgetMs('60000')).to.equal(60000);
    expect(resolveRuntimeBudgetMs('bogus')).to.equal(180000);
    expect(resolveRuntimeBudgetMs(Symbol('budget'))).to.equal(180000);
  });

  it('maps changed files to stable category selection', function () {
    const categories = inferCategoriesFromChangedFiles([
      'test/editor-ui-format.test.js',
      'test/input/editor-keybindings.test.js',
      'tools/offline/export.js',
      '.github/workflows/tests.yml',
      'docs/release-readiness.md'
    ]);
    expect(categories).to.include('editor');
    expect(categories).to.include('offline-tools');
    expect(categories).to.include('workflow');
    expect(categories).to.include('release');
  });

  it('maps generic tools, offline tool sources, and bench paths to their dedicated categories', function () {
    const categories = inferCategoriesFromChangedFiles([
      'tools/packPipeline.js',
      'tools/scanGreenPanel.js',
      'scripts/bench-performance.js'
    ]);
    expect(categories).to.include('offline-tools');
    expect(categories).to.include('tools');
    expect(categories).to.include('bench');
  });

  it('falls back to full suite args whenever core is included', function () {
    const args = buildMochaArgsForCategories(['editor', 'core']);
    expect(args).to.deep.equal(['--recursive']);
  });

  it('builds focused args for release category', function () {
    const args = buildMochaArgsForCategories(['release']);
    expect(args).to.deep.equal(['test/release-readiness.test.js']);
  });

  it('builds focused args for bench category', function () {
    const args = buildMochaArgsForCategories(['bench']);
    expect(args).to.deep.equal(['test/*bench*.test.js']);
  });

  it('uses an explicit base ref without consulting git', function () {
    const runGitCommand = createRunGitStub({});
    const resolved = resolveBaseRef({ baseRef: 'origin/release', runGitCommand });
    expect(resolved).to.deep.equal({
      ref: 'origin/release',
      source: 'explicit'
    });
  });

  it('prefers the current branch upstream when resolving the default base ref', function () {
    const runGitCommand = createRunGitStub({
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': {
        status: 0,
        stdout: 'origin/feature-branch\n'
      }
    });
    const resolved = resolveBaseRef({ runGitCommand });
    expect(resolved).to.deep.equal({
      ref: 'origin/feature-branch',
      source: 'upstream'
    });
  });

  it('falls back to origin HEAD when no upstream is configured', function () {
    const runGitCommand = createRunGitStub({
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD': {
        status: 0,
        stdout: 'origin/master\n'
      }
    });
    const resolved = resolveBaseRef({ runGitCommand });
    expect(resolved).to.deep.equal({
      ref: 'origin/master',
      source: 'origin-head'
    });
  });

  it('falls back through known branch candidates when upstream and origin HEAD are unavailable', function () {
    const runGitCommand = createRunGitStub({
      'rev-parse --verify --quiet origin/master': {
        status: 0,
        stdout: 'abc123\n'
      }
    });
    const resolved = resolveBaseRef({ runGitCommand });
    expect(resolved).to.deep.equal({
      ref: 'origin/master',
      source: 'fallback'
    });
  });

  it('returns null when no safe default base ref can be resolved', function () {
    const runGitCommand = createRunGitStub({});
    const resolved = resolveBaseRef({ runGitCommand });
    expect(resolved).to.equal(null);
  });

  it('collects changed files from git outputs and untracked files', function () {
    const runGitCommand = createRunGitStub({
      'diff --name-only --diff-filter=ACMRD origin/main...HEAD': { status: 0, stdout: 'js/app/boot.js\n' },
      'diff --name-only --cached --diff-filter=ACMRD': { status: 0, stdout: 'js/app/boot.js\n' },
      'diff --name-only --diff-filter=ACMRD': { status: 0, stdout: 'js/editor/EditorController.js\n' },
      'ls-files --others --exclude-standard': { status: 0, stdout: 'test/new.test.js\n' }
    });
    const files = collectChangedFiles({ baseRef: 'origin/main', runGitCommand });
    expect(files).to.deep.equal([
      'js/app/boot.js',
      'js/editor/EditorController.js',
      'test/new.test.js'
    ]);
  });

  it('includes deleted files when collecting changed paths', function () {
    const runGitCommand = createRunGitStub({
      'diff --name-only --diff-filter=ACMRD origin/main...HEAD': { status: 0, stdout: 'mcp/old-tool.js\n' },
      'diff --name-only --cached --diff-filter=ACMRD': { status: 0, stdout: '' },
      'diff --name-only --diff-filter=ACMRD': { status: 0, stdout: '' },
      'ls-files --others --exclude-standard': { status: 0, stdout: '' }
    });
    const files = collectChangedFiles({ baseRef: 'origin/main', runGitCommand });
    expect(files).to.deep.equal(['mcp/old-tool.js']);
  });

  it('formats selection diagnostics with base, files, categories, and mocha args', function () {
    const lines = formatSelectionLines({
      resolvedBase: { ref: 'origin/main', source: 'origin-head' },
      changedFiles: ['tools/packPipeline.js', 'test/offline-tools/packPipeline.test.js'],
      categories: ['offline-tools'],
      mochaArgs: ['test/offline-tools/*.test.js']
    });
    expect(lines).to.deep.equal([
      'Resolved base ref: origin/main (origin-head)',
      'Changed files (2): tools/packPipeline.js, test/offline-tools/packPipeline.test.js',
      'Selected categories: offline-tools',
      'Mocha args: test/offline-tools/*.test.js'
    ]);
  });

  it('keeps critical checkJs typecheck enabled in tsconfig.checkjs.json', function () {
    const config = JSON.parse(readFileSync(new URL('../tsconfig.checkjs.json', import.meta.url), 'utf8'));
    expect(config.compilerOptions?.allowJs).to.equal(true);
    expect(config.compilerOptions?.checkJs).to.equal(true);
    expect(Array.isArray(config.include)).to.equal(true);
    expect(config.include.length).to.be.greaterThan(0);
  });

  it('falls back to full suite when no safe base ref can be resolved', function () {
    const logs = { warn: [], error: [], log: [] };
    const spawned = [];
    const exits = [];
    main(['--changed'], {
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
        return { status: 0 };
      },
      runGitCommand: () => ({ status: 1, stdout: '' }),
      log: {
        warn: (msg) => logs.warn.push(msg),
        error: (msg) => logs.error.push(msg),
        log: (msg) => logs.log.push(msg)
      },
      exit: (code) => exits.push(code)
    });
    expect(logs.warn[0]).to.contain('safe base ref');
    expect(spawned[0].args).to.include('--max-warnings=0');
    expect(spawned[0].args).to.include(RUNTIME_GUARD_TARGETS[0]);
    expect(spawned[1].args).to.include('-p');
    expect(spawned[1].args).to.include('tsconfig.checkjs.json');
    expect(spawned[2].args).to.include('--recursive');
    expect(exits).to.deep.equal([0]);
  });

  it('falls back to full suite when changed-file collection fails for a resolved base', function () {
    const logs = { warn: [], error: [], log: [] };
    const spawned = [];
    const exits = [];
    const runGitCommand = createRunGitStub({
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': {
        status: 0,
        stdout: 'origin/feature-branch\n'
      },
      'diff --name-only --diff-filter=ACMRD origin/feature-branch...HEAD': {
        status: 1,
        stdout: ''
      }
    });
    main(['--changed'], {
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
        return { status: 0 };
      },
      runGitCommand,
      log: {
        warn: (msg) => logs.warn.push(msg),
        error: (msg) => logs.error.push(msg),
        log: (msg) => logs.log.push(msg)
      },
      exit: (code) => exits.push(code)
    });
    expect(logs.warn[0]).to.contain('origin/feature-branch');
    expect(spawned[2].args).to.include('--recursive');
    expect(exits).to.deep.equal([0]);
  });

  it('prints changed-file selection details without running guards or mocha', function () {
    const logs = { warn: [], error: [], log: [] };
    const spawned = [];
    const exits = [];
    const runGitCommand = createRunGitStub({
      'diff --name-only --diff-filter=ACMRD origin/main...HEAD': {
        status: 0,
        stdout: 'tools/packPipeline.js\n'
      },
      'diff --name-only --cached --diff-filter=ACMRD': { status: 0, stdout: '' },
      'diff --name-only --diff-filter=ACMRD': { status: 0, stdout: '' },
      'ls-files --others --exclude-standard': { status: 0, stdout: '' }
    });
    main(['--changed', '--base=origin/main', '--print-selection'], {
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
        return { status: 0 };
      },
      runGitCommand,
      log: {
        warn: (msg) => logs.warn.push(msg),
        error: (msg) => logs.error.push(msg),
        log: (msg) => logs.log.push(msg)
      },
      exit: (code) => exits.push(code)
    });
    expect(spawned).to.have.lengthOf(0);
    expect(logs.warn).to.deep.equal([]);
    expect(logs.log).to.deep.equal([
      'Changed-file test selection: offline-tools',
      'Changed-file base ref: origin/main (explicit)',
      'Resolved base ref: origin/main (explicit)',
      'Changed files (1): tools/packPipeline.js',
      'Selected categories: offline-tools',
      'Mocha args: test/offline-tools/*.test.js'
    ]);
    expect(exits).to.deep.equal([0]);
  });

  it('runs runtime global guard before mocha', function () {
    const spawned = [];
    const exits = [];
    main([], {
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
        return { status: 0 };
      },
      log: {
        warn: () => {},
        error: () => {},
        log: () => {}
      },
      exit: (code) => exits.push(code)
    });
    expect(spawned[0].args).to.include('--max-warnings=0');
    expect(spawned[0].args).to.include(RUNTIME_GUARD_TARGETS[0]);
    expect(spawned[1].args).to.include('-p');
    expect(spawned[1].args).to.include('tsconfig.checkjs.json');
    expect(spawned[2].args).to.include('--recursive');
    expect(exits).to.deep.equal([0]);
  });

  it('aborts test run when runtime global guard fails', function () {
    const spawned = [];
    const exits = [];
    main([], {
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
        if (spawned.length === 1) return { status: 1 };
        return { status: 0 };
      },
      log: {
        warn: () => {},
        error: () => {},
        log: () => {}
      },
      exit: (code) => exits.push(code)
    });
    expect(spawned).to.have.lengthOf(1);
    expect(spawned[0].args).to.include('--max-warnings=0');
    expect(exits).to.deep.equal([1]);
  });

  it('runRuntimeGlobalGuard reports success and failure statuses', function () {
    const exits = [];
    const success = runRuntimeGlobalGuard({
      spawn: () => ({ status: 0 }),
      log: { error: () => {} },
      exit: (code) => exits.push(code)
    });
    const failure = runRuntimeGlobalGuard({
      spawn: () => ({ status: 2 }),
      log: { error: () => {} },
      exit: (code) => exits.push(code)
    });
    expect(success).to.equal(true);
    expect(failure).to.equal(false);
    expect(exits).to.deep.equal([2]);
  });

  it('rejects unknown categories without running mocha', function () {
    const exits = [];
    const spawned = [];
    main(['unknown-category'], {
      spawn: () => {
        spawned.push(true);
        return { status: 0 };
      },
      log: {
        warn: () => {},
        error: () => {},
        log: () => {}
      },
      exit: (code) => exits.push(code)
    });

    expect(spawned).to.have.lengthOf(0);
    expect(exits).to.deep.equal([1]);
  });

  it('fails when budget enforcement is enabled and runtime exceeds threshold', function () {
    const exits = [];
    const spawned = [];
    const originalEnforce = process.env.LEMMINGS_TEST_ENFORCE_BUDGET;
    const originalBudget = process.env.LEMMINGS_TEST_BUDGET_MS;
    const originalNow = Date.now;
    let nowTick = 0;
    Date.now = () => {
      nowTick += 10;
      return nowTick;
    };
    process.env.LEMMINGS_TEST_ENFORCE_BUDGET = 'true';
    process.env.LEMMINGS_TEST_BUDGET_MS = '1';
    try {
      main([], {
        spawn: () => {
          spawned.push(true);
          return { status: 0 };
        },
        log: {
          warn: () => {},
          error: () => {},
          log: () => {}
        },
        exit: (code) => exits.push(code)
      });
    } finally {
      Date.now = originalNow;
      if (originalEnforce == null) delete process.env.LEMMINGS_TEST_ENFORCE_BUDGET;
      else process.env.LEMMINGS_TEST_ENFORCE_BUDGET = originalEnforce;
      if (originalBudget == null) delete process.env.LEMMINGS_TEST_BUDGET_MS;
      else process.env.LEMMINGS_TEST_BUDGET_MS = originalBudget;
    }
    expect(spawned).to.have.lengthOf(3);
    expect(exits).to.deep.equal([1]);
  });
});
