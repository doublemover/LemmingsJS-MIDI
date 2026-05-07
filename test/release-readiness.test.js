import { expect } from 'chai';
import {
  REQUIRED_SECTIONS,
  evaluateReleaseReadiness,
  looksLikeWindowsAbsolutePath,
  parseChecklistBySection,
  run
} from '../scripts/check-release-readiness.js';

describe('release readiness checklist', function () {
  it('parses checklist entries grouped by section', function () {
    const sections = parseChecklistBySection('## Compatibility\n- [x] API contract validated\n\n## Migration\n- [ ] migration notes');
    expect(Array.from(sections.keys())).to.deep.equal(['Compatibility', 'Migration']);
    expect(sections.get('Compatibility')).to.deep.equal([
      { checked: true, text: 'API contract validated' }
    ]);
    expect(sections.get('Migration')).to.deep.equal([
      { checked: false, text: 'migration notes' }
    ]);
  });

  it('parses headings with leading spaces and trailing hash markers', function () {
    const sections = parseChecklistBySection('  ## Performance ##\n- [x] bench replay parity');
    expect(Array.from(sections.keys())).to.deep.equal(['Performance']);
    expect(sections.get('Performance')).to.deep.equal([
      { checked: true, text: 'bench replay parity' }
    ]);
  });

  it('passes when required sections are present and fully checked', function () {
    const markdown = REQUIRED_SECTIONS.map((section) => (
      `## ${section}\n- [x] complete`
    )).join('\n\n');

    const summary = evaluateReleaseReadiness(markdown, { requireAllChecked: true });
    expect(summary.ok).to.equal(true);
    expect(summary.missingSections).to.deep.equal([]);
    expect(summary.emptySections).to.deep.equal([]);
    expect(summary.uncheckedItems).to.deep.equal([]);
  });

  it('fails when required sections are missing or unchecked', function () {
    const markdown = [
      '## Compatibility',
      '- [x] api compatibility verified',
      '',
      '## Migration',
      '- [ ] migration rehearsal pending'
    ].join('\n');

    const summary = evaluateReleaseReadiness(markdown, { requireAllChecked: true });
    expect(summary.ok).to.equal(false);
    expect(summary.missingSections).to.include.members([
      'Performance',
      'Accessibility',
      'Runtime Controls'
    ]);
    expect(summary.uncheckedItems).to.deep.equal([
      { section: 'Migration', text: 'migration rehearsal pending' }
    ]);
  });

  it('allows unchecked entries in non-strict mode while still requiring structure', function () {
    const markdown = REQUIRED_SECTIONS.map((section) => (
      `## ${section}\n- [ ] pending`
    )).join('\n\n');

    const summary = evaluateReleaseReadiness(markdown, { requireAllChecked: false });
    expect(summary.ok).to.equal(true);
    expect(summary.counts.uncheckedCount).to.equal(REQUIRED_SECTIONS.length);
  });

  it('run emits summary and succeeds when checklist passes', function () {
    const logs = [];
    const exits = [];
    run([], {
      cwd: 'C:/workspace',
      fsImpl: {
        readFileSync() {
          return REQUIRED_SECTIONS.map(section => `## ${section}\n- [x] complete`).join('\n\n');
        }
      },
      log: {
        log(message) {
          logs.push(message);
        },
        error() {}
      },
      exit(code) {
        exits.push(code);
      }
    });
    expect(exits).to.deep.equal([]);
    expect(logs).to.have.lengthOf(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.ok).to.equal(true);
    expect(parsed.strict).to.equal(true);
  });

  it('distinguishes Windows-style absolute paths from POSIX roots', function () {
    expect(looksLikeWindowsAbsolutePath('/workspace/docs/release-readiness.md')).to.equal(false);
    expect(looksLikeWindowsAbsolutePath('docs/release-readiness.md')).to.equal(false);
    expect(looksLikeWindowsAbsolutePath('C:/workspace/docs/release-readiness.md')).to.equal(true);
    expect(looksLikeWindowsAbsolutePath('C:\\workspace\\docs\\release-readiness.md')).to.equal(true);
    expect(looksLikeWindowsAbsolutePath('\\\\server\\share\\release-readiness.md')).to.equal(true);
  });

  it('run exits non-zero when checklist file cannot be loaded', function () {
    const errors = [];
    const exits = [];
    run([], {
      cwd: 'C:/workspace',
      fsImpl: {
        readFileSync() {
          throw new Error('missing');
        }
      },
      log: {
        log() {},
        error(message) {
          errors.push(message);
        }
      },
      exit(code) {
        exits.push(code);
      }
    });
    expect(exits).to.deep.equal([1]);
    expect(errors[0]).to.contain('Unable to read release-readiness document');
  });

  it('run supports non-strict mode via --strict=false', function () {
    const exits = [];
    run(['--strict=false'], {
      cwd: 'C:/workspace',
      fsImpl: {
        readFileSync() {
          return REQUIRED_SECTIONS.map(section => `## ${section}\n- [ ] pending`).join('\n\n');
        }
      },
      log: {
        log() {},
        error() {}
      },
      exit(code) {
        exits.push(code);
      }
    });
    expect(exits).to.deep.equal([]);
  });

  it('run exits non-zero and emits summary when checklist requirements fail', function () {
    const logs = [];
    const exits = [];
    run([], {
      cwd: 'C:/workspace',
      fsImpl: {
        readFileSync() {
          return '## Compatibility\n- [x] complete';
        }
      },
      log: {
        log(message) {
          logs.push(message);
        },
        error() {}
      },
      exit(code) {
        exits.push(code);
      }
    });
    expect(exits).to.deep.equal([1]);
    expect(logs).to.have.lengthOf(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.ok).to.equal(false);
    expect(parsed.missingSections).to.include('Migration');
  });

  it('run supports release checklist file override via environment variable', function () {
    const originalPath = process.env.LEMMINGS_RELEASE_READINESS_PATH;
    process.env.LEMMINGS_RELEASE_READINESS_PATH = 'docs/custom-readiness.md';
    const reads = [];
    const exits = [];
    try {
      run([], {
        cwd: 'C:/workspace',
        fsImpl: {
          readFileSync(file, encoding) {
            reads.push({ file, encoding });
            return REQUIRED_SECTIONS.map(section => `## ${section}\n- [x] done`).join('\n\n');
          }
        },
        log: {
          log() {},
          error() {}
        },
        exit(code) {
          exits.push(code);
        }
      });
    } finally {
      if (originalPath == null) {
        delete process.env.LEMMINGS_RELEASE_READINESS_PATH;
      } else {
        process.env.LEMMINGS_RELEASE_READINESS_PATH = originalPath;
      }
    }

    expect(reads).to.have.lengthOf(1);
    expect(reads[0].encoding).to.equal('utf8');
    expect(reads[0].file.replace(/\\/g, '/')).to.equal('C:/workspace/docs/custom-readiness.md');
    expect(exits).to.deep.equal([]);
  });

  it('run prioritizes --file over environment path override', function () {
    const originalPath = process.env.LEMMINGS_RELEASE_READINESS_PATH;
    process.env.LEMMINGS_RELEASE_READINESS_PATH = 'docs/env-readiness.md';
    const reads = [];
    try {
      run(['--file=docs/arg-readiness.md'], {
        cwd: 'C:/workspace',
        fsImpl: {
          readFileSync(file) {
            reads.push(file);
            return REQUIRED_SECTIONS.map(section => `## ${section}\n- [x] done`).join('\n\n');
          }
        },
        log: {
          log() {},
          error() {}
        },
        exit() {}
      });
    } finally {
      if (originalPath == null) {
        delete process.env.LEMMINGS_RELEASE_READINESS_PATH;
      } else {
        process.env.LEMMINGS_RELEASE_READINESS_PATH = originalPath;
      }
    }

    expect(reads).to.have.lengthOf(1);
    expect(reads[0].replace(/\\/g, '/')).to.equal('C:/workspace/docs/arg-readiness.md');
  });
});
