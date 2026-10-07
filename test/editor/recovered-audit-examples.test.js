import { expect } from 'chai';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { EditorSession } from '../../js/editor/EditorSession.js';
import { createEditorProjectFromPackArchive } from '../../js/editor/EditorProjectStorage.js';

describe('preserved editor-audit examples', function() {
  it('retains the original source hashes and round-trips each level in the current parser', function() {
    const checks = JSON.parse(fs.readFileSync('examples/editor-audit/historical-level-verification.json', 'utf8'));
    for (const check of checks) {
      const text = fs.readFileSync(`examples/editor-audit/${check.file.split('/').at(-1)}`, 'utf8');
      expect(createHash('sha256').update(text).digest('hex')).to.equal(check.sha256);
      const session = new EditorSession(); session.loadFromText(text);
      expect(session.getTitle()).to.equal(check.title);
      expect(session.level.getHeader('LEMMINGS')).to.equal(10);
      const again = new EditorSession(); again.loadFromText(session.toText());
      expect(again.toText()).to.equal(session.toText());
    }
  });

  it('preserves all 324 unique classic-level identities in the historical manifest', function() {
    const manifest = JSON.parse(fs.readFileSync('examples/editor-audit/historical-base-level-manifest.json', 'utf8'));
    expect(manifest.format).to.equal('lemmings-classic-json');
    expect(manifest.levels).to.have.lengthOf(324);
    expect(new Set(manifest.levels.map(level => level.id)).size).to.equal(324);
    expect(manifest.packs.map(pack => pack.count)).to.deep.equal([120, 100, 4, 4, 32, 64]);
    for (const level of manifest.levels) {
      expect(level.classicRoundtrip).to.equal(true);
      expect(level.sha256).to.match(/^[a-f0-9]{64}$/);
    }
  });

  it('imports the complete two-level pack with both original level identities', function() {
    const result = createEditorProjectFromPackArchive(fs.readFileSync('examples/editor-audit/audit-level-pack.json', 'utf8'));
    expect(result.ok).to.equal(true);
    expect(result.project.levels.map(level => level.title)).to.deep.equal(['The Orchard Gate', 'HYDRO CHECK: TRIANGLE APPROVED']);
    expect(result.report.summary.errors).to.equal(0);
  });
});
