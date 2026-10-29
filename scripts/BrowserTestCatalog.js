export const WORKSTATION_TEST_MATCH = /(?:^|[/\\])(?:[^/\\]*workstation[^/\\]*|procgen-(?:actor-effects|action-chains|physical-midi|causal-visual|lane-display|midi-parameter-evidence|operational-status|sound-world-isolation|import-admission|take-workbench|project-naming|project-paging|render-recovery)|physical-junction-controls|causal-take-audio-render)\.spec\.js$/;
export const WORKSTATION_SMOKE_GREP = /@boundary/;
export const REQUIRED_WORKSTATION_CATEGORIES = Object.freeze([
  'boot', 'physical-music', 'local-audio', 'transport', 'storage', 'import-refusal',
  'world-undo', 'world-rollback', 'save-cancel', 'queued-launch', 'clock-fallback', 'dock', 'typed-controls', 'physical-route'
]);

export function collectBrowserCases(report, project) {
  const cases = [], seen = new Set();
  function visit(suite, parents = []) {
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      if (test.projectName !== project) continue;
      const file = String(spec.file || suite.file || '').replace(/\\/g, '/').replace(/^.*\/e2e\//, '').replace(/^e2e\//, '');
      const key = `${file}:${spec.line}:${spec.column}:${[...titles, spec.title].join(' › ')}`;
      if (seen.has(key)) throw new Error('Duplicate browser case: ' + key);
      seen.add(key);
      const tags = (spec.tags || []).map(tag => tag.startsWith('@') ? tag : '@' + tag);
      cases.push(Object.freeze({ file, line: spec.line, title: [...titles, spec.title].join(' › '), tags: Object.freeze(tags), project,
        expectedStatus: test.expectedStatus || null, lastStatus: test.results?.at(-1)?.status || null }));
    }
    for (const child of suite.suites || []) visit(child, titles);
  }
  if (report.errors?.length) throw new Error('Browser collection failed: ' + report.errors.map(error => error.message).join('; '));
  for (const suite of report.suites || []) visit(suite);
  return Object.freeze(cases);
}

export function qualifyWorkstationResults(report) {
  const cases = collectBrowserCases(report, 'workstation');
  if (!cases.length) throw new Error('Required workstation results contain zero tests.');
  const skipped = [];
  for (const test of cases) {
    if (test.lastStatus === 'skipped' && test.tags.includes('@benchmark')) { skipped.push(test.title); continue; }
    if (test.expectedStatus !== 'passed' || test.lastStatus !== 'passed') throw new Error('Required workstation case did not pass: ' + test.title);
  }
  const categories = REQUIRED_WORKSTATION_CATEGORIES.map(category => {
    const count = cases.filter(test => test.tags.includes('@workstation-' + category) && test.lastStatus === 'passed' && test.expectedStatus === 'passed').length;
    if (!count) throw new Error('Required workstation capability has zero passing tests: ' + category);
    return { category, passed: count };
  });
  return { project: 'workstation', passed: cases.length - skipped.length, skipped, categories, cases };
}

export function validateWorkstationCollection({ full, smoke, expectedFiles }) {
  if (!full.length || !smoke.length) throw new Error('Required workstation browser category selected zero tests.');
  const files = [...new Set(full.map(test => test.file))].sort(), smokeFiles = new Set(smoke.map(test => test.file));
  const expected = [...new Set(expectedFiles.map(file => file.replace(/\\/g, '/').replace(/^e2e\//, '')))].sort();
  if (!expected.length) throw new Error('No workstation files were discovered.');
  for (const file of expected) {
    if (!files.includes(file)) throw new Error('Workstation project does not collect required file: ' + file);
    if (!smokeFiles.has(file)) throw new Error('Required workstation file has no PR smoke case: ' + file);
  }
  for (const file of files) if (!expected.includes(file)) throw new Error('Workstation project collected an unexpected file: ' + file);
  const fullKeys = new Set(full.map(test => `${test.file}:${test.line}:${test.title}`));
  for (const test of smoke) if (!fullKeys.has(`${test.file}:${test.line}:${test.title}`)) throw new Error('Smoke case is absent from the full workstation project: ' + test.title);
  const categories = REQUIRED_WORKSTATION_CATEGORIES.map(category => {
    const tag = '@workstation-' + category, selected = smoke.filter(test => test.tags.includes(tag));
    if (!selected.length) throw new Error('Required workstation category selected zero tests: ' + category);
    return Object.freeze({ category, tag, count: selected.length, files: Object.freeze([...new Set(selected.map(test => test.file))].sort()) });
  });
  return Object.freeze({ project: 'workstation', fullCount: full.length, smokeCount: smoke.length, files: Object.freeze(files), categories: Object.freeze(categories) });
}
