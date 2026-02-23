import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import {
  RUNTIME_GUARD_TARGETS,
  buildMochaArgsForCategories,
  collectChangedFiles,
  inferCategoriesFromChangedFiles,
  main,
  parseBoolEnv,
  parseCliArgs,
  resolveRuntimeBudgetMs,
  runRuntimeGlobalGuard
} from '../scripts/runTests.js';

const createRunGitStub = (responsesByCommand) => (args) => {
  const key = args.join(' ');
  const response = responsesByCommand[key];
  if (!response) {
    return { status: 0, stdout: '' };
  }
  return response;
};

describe('scripts/runTests', function () {
  it('parses changed/base options and categories', function () {
    const parsed = parseCliArgs(['--changed', '--base=origin/main', 'editor']);
    expect(parsed.changed).to.equal(true);
    expect(parsed.baseRef).to.equal('origin/main');
    expect(parsed.categories).to.deep.equal(['editor']);
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
      'js/editor/EditorController.js',
      'tools/offline/export.js',
      '.github/workflows/tests.yml',
      'docs/release-readiness.md'
    ]);
    expect(categories).to.include('editor');
    expect(categories).to.include('offline-tools');
    expect(categories).to.include('workflow');
    expect(categories).to.include('release');
  });

  it('maps tools and bench paths to their dedicated categories', function () {
    const categories = inferCategoriesFromChangedFiles([
      'tools/packPipeline.js',
      'scripts/bench-performance.js'
    ]);
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

  it('collects changed files from git outputs and untracked files', function () {
    const runGitCommand = createRunGitStub({
      'diff --name-only --diff-filter=ACMRD HEAD': { status: 0, stdout: 'js/app/boot.js\n' },
      'diff --name-only --cached --diff-filter=ACMRD': { status: 0, stdout: 'js/app/boot.js\n' },
      'diff --name-only --diff-filter=ACMRD': { status: 0, stdout: 'js/editor/EditorController.js\n' },
      'ls-files --others --exclude-standard': { status: 0, stdout: 'test/new.test.js\n' }
    });
    const files = collectChangedFiles({ runGitCommand });
    expect(files).to.deep.equal([
      'js/app/boot.js',
      'js/editor/EditorController.js',
      'test/new.test.js'
    ]);
  });

  it('includes deleted files when collecting changed paths', function () {
    const runGitCommand = createRunGitStub({
      'diff --name-only --diff-filter=ACMRD HEAD': { status: 0, stdout: 'mcp/old-tool.js\n' },
      'diff --name-only --cached --diff-filter=ACMRD': { status: 0, stdout: '' },
      'diff --name-only --diff-filter=ACMRD': { status: 0, stdout: '' },
      'ls-files --others --exclude-standard': { status: 0, stdout: '' }
    });
    const files = collectChangedFiles({ runGitCommand });
    expect(files).to.deep.equal(['mcp/old-tool.js']);
  });

  it('keeps critical checkJs typecheck enabled in tsconfig.checkjs.json', function () {
    const config = JSON.parse(readFileSync(new URL('../tsconfig.checkjs.json', import.meta.url), 'utf8'));
    expect(config.compilerOptions?.allowJs).to.equal(true);
    expect(config.compilerOptions?.checkJs).to.equal(true);
    expect(Array.isArray(config.include)).to.equal(true);
    expect(config.include.length).to.be.greaterThan(0);
  });

  it('falls back to full suite when changed-file detection fails', function () {
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
    expect(logs.warn[0]).to.contain('falling back to full suite');
    expect(spawned[0].args).to.include('--max-warnings=0');
    expect(spawned[0].args).to.include(RUNTIME_GUARD_TARGETS[0]);
    expect(spawned[1].args).to.include('-p');
    expect(spawned[1].args).to.include('tsconfig.checkjs.json');
    expect(spawned[2].args).to.include('--recursive');
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
