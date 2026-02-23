import { expect } from 'chai';
import {
  REQUIRED_SECTIONS,
  evaluateReleaseReadiness,
  parseChecklistBySection
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
      'Rollback Rehearsal'
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
});
