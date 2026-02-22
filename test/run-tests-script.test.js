import { expect } from 'chai';
import {
  buildMochaArgsForCategories,
  collectChangedFiles,
  inferCategoriesFromChangedFiles,
  main,
  parseCliArgs
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

  it('maps changed files to stable category selection', function () {
    const categories = inferCategoriesFromChangedFiles([
      'js/editor/EditorController.js',
      'tools/offline/export.js',
      '.github/workflows/tests.yml'
    ]);
    expect(categories).to.include('editor');
    expect(categories).to.include('offline-tools');
    expect(categories).to.include('workflow');
  });

  it('falls back to full suite args whenever core is included', function () {
    const args = buildMochaArgsForCategories(['editor', 'core']);
    expect(args).to.deep.equal(['--recursive']);
  });

  it('collects changed files from git outputs and untracked files', function () {
    const runGitCommand = createRunGitStub({
      'diff --name-only --diff-filter=ACMR HEAD': { status: 0, stdout: 'js/app/boot.js\n' },
      'diff --name-only --cached --diff-filter=ACMR': { status: 0, stdout: 'js/app/boot.js\n' },
      'diff --name-only --diff-filter=ACMR': { status: 0, stdout: 'js/editor/EditorController.js\n' },
      'ls-files --others --exclude-standard': { status: 0, stdout: 'test/new.test.js\n' }
    });
    const files = collectChangedFiles({ runGitCommand });
    expect(files).to.deep.equal([
      'js/app/boot.js',
      'js/editor/EditorController.js',
      'test/new.test.js'
    ]);
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
    expect(spawned[0].args).to.include('--recursive');
    expect(exits).to.deep.equal([0]);
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
});
