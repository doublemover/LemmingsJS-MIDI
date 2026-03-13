import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkTextHygieneFiles,
  findTextHygieneIssues,
  listTrackedFiles,
  main,
  reconcileIssuesAgainstBaseline
} from '../scripts/check-text-hygiene.js';

describe('scripts/check-text-hygiene.js', function () {
  it('parses tracked files from git ls-files -z output', function () {
    const files = listTrackedFiles({
      cwd: process.cwd(),
      runGitCommand: () => ({
        status: 0,
        stdout: Buffer.from('docs/TESTING.md\0test/run-tests-script.test.js\0', 'utf8'),
        stderr: Buffer.alloc(0)
      })
    });
    expect(files).to.deep.equal([
      'docs/TESTING.md',
      'test/run-tests-script.test.js'
    ]);
  });

  it('reports trailing whitespace and extra blank lines at end of file', function () {
    const issues = findTextHygieneIssues('docs/example.md', 'alpha  \nbeta\n\n');
    expect(issues).to.deep.equal([
      {
        filePath: 'docs/example.md',
        line: 1,
        column: 6,
        reason: 'trailing whitespace'
      },
      {
        filePath: 'docs/example.md',
        line: 4,
        column: 1,
        reason: 'extra blank line at end of file'
      }
    ]);
  });

  it('checks text files and skips binary buffers', function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-text-hygiene-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'clean.txt'), 'clean line\n');
      fs.writeFileSync(path.join(tempDir, 'bad.txt'), 'bad line \n');
      fs.writeFileSync(path.join(tempDir, 'binary.bin'), Buffer.from([0, 1, 2, 3]));

      const result = checkTextHygieneFiles(['clean.txt', 'bad.txt', 'binary.bin'], {
        cwd: tempDir
      });
      expect(result.checkedFiles).to.equal(2);
      expect(result.issues).to.deep.equal([
        {
          filePath: 'bad.txt',
          line: 1,
          column: 9,
          reason: 'trailing whitespace'
        }
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('filters exact legacy issues through the baseline and reports stale baseline entries', function () {
    const issues = [
      {
        filePath: 'docs/example.md',
        line: 1,
        column: 6,
        reason: 'trailing whitespace'
      },
      {
        filePath: 'docs/example.md',
        line: 4,
        column: 1,
        reason: 'extra blank line at end of file'
      }
    ];
    const reconciled = reconcileIssuesAgainstBaseline(
      issues,
      new Set([
        'docs/example.md:1:6 trailing whitespace',
        'docs/old.md:2:1 trailing whitespace'
      ])
    );
    expect(reconciled.remainingIssues).to.deep.equal([
      {
        filePath: 'docs/example.md',
        line: 4,
        column: 1,
        reason: 'extra blank line at end of file'
      }
    ]);
    expect(reconciled.ignoredIssueCount).to.equal(1);
    expect(reconciled.staleEntries).to.deep.equal([
      'docs/old.md:2:1 trailing whitespace'
    ]);
  });

  it('main exits non-zero when explicit files fail the hygiene check', function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-text-hygiene-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'bad.md'), 'bad  \n');
      const logs = [];
      const exits = [];
      main(['bad.md'], {
        cwd: tempDir,
        log: (message) => logs.push(message),
        error: (message) => logs.push(message),
        exit: (code) => exits.push(code)
      });
      expect(logs).to.deep.equal(['bad.md:1:4 trailing whitespace']);
      expect(exits).to.deep.equal([1]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('main reports success for clean explicit files', function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-text-hygiene-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'clean.md'), 'clean\n');
      const logs = [];
      const exits = [];
      main(['clean.md'], {
        cwd: tempDir,
        log: (message) => logs.push(message),
        error: (message) => logs.push(message),
        exit: (code) => exits.push(code)
      });
      expect(logs).to.deep.equal(['Text hygiene OK: 1 text files checked.']);
      expect(exits).to.deep.equal([0]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('main uses the baseline for repo-wide runs and reports ignored legacy issues', function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-text-hygiene-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'legacy.md'), 'legacy  \n');
      const logs = [];
      const exits = [];
      main([], {
        cwd: tempDir,
        runGitCommand: () => ({
          status: 0,
          stdout: Buffer.from('legacy.md\0', 'utf8'),
          stderr: Buffer.alloc(0)
        }),
        loadBaseline: () => new Set(['legacy.md:1:7 trailing whitespace']),
        log: (message) => logs.push(message),
        error: (message) => logs.push(message),
        exit: (code) => exits.push(code)
      });
      expect(logs).to.deep.equal([
        'Text hygiene OK: 1 text files checked (1 baseline issues ignored).'
      ]);
      expect(exits).to.deep.equal([0]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
