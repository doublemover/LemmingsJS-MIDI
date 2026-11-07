import { expect } from 'chai';
import { WORKSTATION_TEST_MATCH, REQUIRED_WORKSTATION_CATEGORIES, collectBrowserCases, validateWorkstationCollection, qualifyWorkstationResults } from '../scripts/BrowserTestCatalog.js';
import { inferCategoriesFromChangedFiles, buildMochaArgsForCategories } from '../scripts/runTests.js';

describe('required workstation browser collection', () => {
  const cases = () => REQUIRED_WORKSTATION_CATEGORIES.map((category, index) => ({ file: 'procgen-workstation-workflow.spec.js', line: index + 1, title: category, tags: ['@boundary', '@workstation-' + category], project: 'workstation' }));
  const validate = (full, smoke = full, expectedFiles = ['procgen-workstation-workflow.spec.js']) => validateWorkstationCollection({ full, smoke, expectedFiles });
  it('discovers future workstation specs and keeps unrelated browser projects separate', () => {
    for (const file of ['C:\\repo\\e2e\\procgen-workstation-future.spec.js', '/repo/e2e/procgen-action-chains.spec.js', 'procgen-project-naming.spec.js', 'procgen-actor-effects.spec.js', 'causal-take-audio-render.spec.js', 'sound-content-workstation.spec.js', 'nested/future-workstation-flow.spec.js']) expect(WORKSTATION_TEST_MATCH.test(file), file).to.equal(true);
    for (const file of ['harness.game.spec.js', 'midi-ui.spec.js', 'helpers/workstationDock.js']) expect(WORKSTATION_TEST_MATCH.test(file), file).to.equal(false);
  });
  it('fails empty projects, missing capability categories and a new file without a PR smoke case', () => {
    expect(() => validate([], [])).to.throw('zero tests');
    for (const category of REQUIRED_WORKSTATION_CATEGORIES) expect(() => validate(cases().filter(test => test.title !== category)), category).to.throw('zero tests: ' + category);
    const extra = { file: 'procgen-workstation-future.spec.js', line: 1, title: 'new workflow', tags: [], project: 'workstation' };
    expect(() => validate([...cases(), extra], cases(), [extra.file, cases()[0].file])).to.throw('no PR smoke case');
    expect(() => validate(cases(), cases(), ['procgen-workstation-unreachable.spec.js'])).to.throw('does not collect required file');
  });
  it('rejects smoke-only cases and unexpected project files instead of inventing reachability', () => {
    expect(() => validate(cases(), [...cases(), { ...cases()[0], line: 999 }])).to.throw('absent from the full');
    expect(() => validate([...cases(), { ...cases()[0], file: 'unrelated.spec.js' }])).to.throw('unexpected file');
    const result = validate(cases()); expect(result.fullCount).to.equal(REQUIRED_WORKSTATION_CATEGORIES.length); expect(result.categories.every(category => category.count === 1)).to.equal(true);
  });
  it('reads real Playwright nested suites by project and rejects collection errors or duplicate cases', () => {
    const spec = { file: 'C:\\repo\\e2e\\procgen-workstation-workflow.spec.js', line: 4, column: 1, title: 'trusted local audio', tags: ['workstation-local-audio'], tests: [{ projectName: 'workstation' }, { projectName: 'desktop' }] };
    const report = { suites: [{ title: 'file', suites: [{ title: 'workflow', specs: [spec] }] }] };
    const result = collectBrowserCases(report, 'workstation'); expect(result).to.have.length(1); expect(result[0]).to.include({ file: 'procgen-workstation-workflow.spec.js', title: 'file › workflow › trusted local audio' });
    expect(result[0].tags).to.deep.equal(['@workstation-local-audio']); expect(Object.isFrozen(result)).to.equal(true);
    expect(() => collectBrowserCases({ errors: [{ message: 'syntax failure' }] }, 'workstation')).to.throw('syntax failure');
    const parameterized = { suites: [{ title: 'DPR 1', specs: [spec] }, { title: 'DPR 2', specs: [spec] }] };
    expect(collectBrowserCases(parameterized, 'workstation')).to.have.length(2);
    report.suites[0].suites[0].specs.push(spec); expect(() => collectBrowserCases(report, 'workstation')).to.throw('Duplicate browser case');
  });
  it('routes workstation, future worker and storage schema edits to both procgen contracts and nested music integration', () => {
    for (const file of ['js/app/procgen/workstation/ProcgenWorkstation.js', 'js/app/procgen/workstation/storage/FutureSchema.js', 'js/app/procgen/workers/FutureWorker.js', 'js/app/procgen/workstation/ProcgenSessionStorage.js', 'js/app/procgenBoot.js', 'js/app/resources/InstrumentMotionPolicy.js', 'test/instrument-motion-policy.test.js']) {
      const categories = inferCategoriesFromChangedFiles([file]), args = buildMochaArgsForCategories(categories);
      expect(categories, file).to.include('procgen'); expect(args, file).to.include.members(['test/procgen-*.test.js', 'test/midi/procgen-workstation-music.test.js']);
      expect(args, file).to.include('test/instrument-motion-policy.test.js');
    }
    expect(buildMochaArgsForCategories(['midi2'])).to.include.members(['test/midi/ump-packet-codec.test.js', 'test/midi/ump-stream-decoder.test.js', 'test/midi/midi-protocol-lowering.test.js']);
  });
  it('requires actual passes for every capability and permits only explicitly tagged benchmark skips', () => {
    const specs = REQUIRED_WORKSTATION_CATEGORIES.map((category, index) => ({ file: 'procgen-workstation-workflow.spec.js', line: index + 1, title: category, tags: ['workstation-' + category], tests: [{ projectName: 'workstation', expectedStatus: 'passed', results: [{ status: 'passed' }] }] }));
    const report = { suites: [{ specs }] };
    expect(qualifyWorkstationResults(report).passed).to.equal(REQUIRED_WORKSTATION_CATEGORIES.length);
    const first = specs[0].tests[0]; first.results[0].status = 'skipped'; expect(() => qualifyWorkstationResults(report)).to.throw('did not pass');
    first.results[0].status = 'passed'; first.expectedStatus = 'failed'; expect(() => qualifyWorkstationResults(report)).to.throw('did not pass'); first.expectedStatus = 'passed';
    const tag = specs[0].tags; specs[0].tags = []; expect(() => qualifyWorkstationResults(report)).to.throw('zero passing'); specs[0].tags = tag;
    specs.push({ file: 'procgen-workstation-view.spec.js', title: 'opt-in latency', tags: ['benchmark'], tests: [{ projectName: 'workstation', expectedStatus: 'skipped', results: [{ status: 'skipped' }] }] });
    expect(qualifyWorkstationResults(report).skipped).to.deep.equal(['opt-in latency']);
    specs.at(-1).tags = []; expect(() => qualifyWorkstationResults(report)).to.throw('did not pass');
  });
});
