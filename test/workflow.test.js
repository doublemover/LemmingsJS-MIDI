import { expect } from 'chai';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';

for (const file of ['maintenance-full.yml']) {
  describe('GitHub validation responsibilities: ' + file, () => {
    const config = yaml.load(fs.readFileSync('.github/workflows/' + file, 'utf8'));
    const steps = config.jobs.test.steps;
    const runs = steps.filter(step => step.run).map(step => step.run);
    it('uses supported Node and exactly one full unit/coverage pass', () => {
      const setup = steps.find(step => step.uses?.startsWith('actions/setup-node'));
      expect(Number(setup.with['node-version'])).to.be.at.least(20);
      expect(runs.filter(run => run === 'npm run coverage')).to.have.length(1);
      for (const duplicate of ['npm test', 'npm run test-bench-unit', 'npm run format']) expect(runs).not.to.include(duplicate);
    });
    it('retains each distinct static, browser, protocol and performance check once', () => {
      for (const command of ['npm ci', 'npm run check-undefined', 'npm run lint', 'npm run typecheck:critical',
        'npm run release-readiness', 'npm run depcheck', 'npm run check-mcp-clients',
        'npm run test-e2e:boundaries', 'npm run test-mcp-smoke', 'npm run bench-smoke']) {
        expect(runs.filter(run => run === command), command).to.have.length(1);
      }
      expect(runs.some(run => run.includes('git diff --check'))).to.equal(true);
      const workstation = 'npm run test-e2e:workstation';
      expect(runs.filter(run => run === workstation)).to.have.length(1);
      const script = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts[workstation.slice('npm run '.length)];
      expect(script).to.match(/^node scripts\/check-browser-categories\.js && /);
      expect(script).to.include(' && node scripts/check-browser-results.js');
      const receiptUpload = steps.find(step => step.with?.name === 'workstation-browser-receipts');
      expect(receiptUpload.if).to.equal('always()');
      expect(receiptUpload.with['if-no-files-found']).to.equal('error');
      expect(receiptUpload.with.path).to.include('browser-category-selection.json').and.include('workstation-results.json');
      expect(runs.some(run => run.includes('git checkout origin/master -- tools'))).to.equal(false);
      const browser = steps.findIndex(step => step.run === 'npm run test-e2e:boundaries');
      const start = steps.findIndex(step => step.name === 'Start HTTPS server');
      expect(browser).to.be.lessThan(start);
      expect(start).to.be.lessThan(steps.findIndex(step => step.run === 'npm run test-mcp-smoke'));
      expect(steps[start].run).to.include('node "$GITHUB_WORKSPACE/node_modules/http-server/bin/http-server"');
      const stop = steps.find(step => step.name === 'Stop HTTPS server');
      expect(stop.if).to.equal('always()');
      expect(stop.run).to.include('/proc/$server_pid/cmdline');
      expect(stop.run).to.include('"${server_args[1]}" = "$GITHUB_WORKSPACE/node_modules/http-server/bin/http-server"');
    });
  });
}


describe('parallel pull-request validation responsibilities', () => {
  const jobs = yaml.load(fs.readFileSync('.github/workflows/test.yml', 'utf8')).jobs;
  const commands = job => job.steps.filter(step => step.run).map(step => step.run);
  const runs = Object.values(jobs).flatMap(commands);
  it('starts independent validation lanes without a serial prerequisite', () => {
    for (const name of ['checks', 'unit-coverage', 'browser-boundaries', 'workstation', 'mcp-smoke', 'native-midi-codec', 'lifecycle-engines']) {
      const job = jobs[name]; expect(job.needs, name).to.equal(undefined);
      expect(Number(job.steps.find(step => step.uses?.startsWith('actions/setup-node')).with['node-version']), name).to.be.at.least(20);
      expect(commands(job).filter(command => command === 'npm ci'), name).to.have.length(1);
    }
  });
  it('keeps every static, protocol, performance and complete coverage gate once', () => {
    for (const command of ['npm run provenance:check', 'npm audit --audit-level=moderate', 'npm run check-undefined', 'npm run lint', 'npm run typecheck:critical', 'npm run release-readiness', 'npm run depcheck', 'npm run check-mcp-clients', 'npm run test-e2e:boundaries', 'npm run test-mcp-smoke', 'npm run bench-smoke', 'npm run coverage']) expect(runs.filter(run => run === command), command).to.have.length(1);
    expect(commands(jobs['unit-coverage'])).to.include('npm run coverage');
    expect(commands(jobs.checks).some(run => run.includes('git diff --check'))).to.equal(true);
    for (const duplicate of ['npm test', 'npm run test-bench-unit', 'npm run format']) expect(runs).not.to.include(duplicate);
    expect(runs.some(run => run.includes('git checkout origin/master -- tools'))).to.equal(false);
  });
  it('partitions the full browser selection on separate one-worker runners', () => {
    const job = jobs.workstation, { shard, total } = job.strategy.matrix;
    expect(job.strategy['fail-fast']).to.equal(false); expect(total).to.deep.equal([shard.length]); expect(shard.length).to.be.at.least(2);
    expect(shard).to.deep.equal(Array.from({ length: shard.length }, (_, index) => index + 1));
    const run = commands(job).find(command => command.includes('--shard='));
    expect(run).to.include('--project=workstation --grep @boundary --workers=1');
    expect(run).to.include('--shard=${{ matrix.shard }}/${{ matrix.total }}').and.include('--reporter=line,blob');
    expect(run).not.to.include('--fully-parallel');
    const steps = job.steps, begin = steps.findIndex(step => step.id === 'workstation_cohort');
    expect(steps.findIndex(step => step.run === 'npm run check:browser-categories')).to.be.lessThan(begin);
    const source = steps.findIndex(step => step.run === 'node scripts/check-browser-results.js --source-only');
    expect(source).to.be.greaterThan(begin); expect(steps[source].if).to.include('always()').and.include('steps.workstation_cohort.outcome');
    expect(steps.find(step => step.with?.name === 'workstation-source-${{ matrix.shard }}').with['if-no-files-found']).to.equal('error');
    const blob = job.steps.find(step => step.with?.path === 'blob-report');
    expect(blob.if).to.equal('always()'); expect(blob.with.name).to.include('${{ matrix.shard }}'); expect(blob.with.overwrite).to.equal(true); expect(blob.with['if-no-files-found']).to.equal('error');
    const diagnostics = job.steps.find(step => step.with?.path === 'test-results');
    expect(diagnostics.with.name).to.include('${{ matrix.shard }}').and.include('${{ github.run_attempt }}');
  });
  it('qualifies merged reports against the complete source-bound catalog after failed shards too', () => {
    const job = jobs['workstation-results']; expect(job.needs).to.deep.equal(['workstation']); expect(job.if).to.equal('${{ !cancelled() }}');
    const download = job.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
    expect(download.uses).to.match(/@[a-f0-9]{40}$/); expect(download.with.pattern).to.equal('workstation-blob-*'); expect(download.with['merge-multiple']).to.equal(true);
    const commands = job.steps.map(step => step.run), merge = job.steps.find(step => step.run?.startsWith('npx playwright merge-reports'));
    expect(commands.indexOf('npm run check:browser-categories')).to.be.lessThan(commands.indexOf(merge.run));
    expect(merge.env.PLAYWRIGHT_JSON_OUTPUT_NAME).to.equal('.tmp/workstation-results.json');
    expect(commands.indexOf(merge.run)).to.be.lessThan(commands.indexOf('node scripts/check-browser-results.js --smoke'));
    const receipt = job.steps.find(step => step.with?.name === 'workstation-browser-receipts');
    expect(receipt.if).to.equal('always()'); expect(receipt.with['if-no-files-found']).to.equal('error'); expect(receipt.with.path).to.include('browser-category-selection.json').and.include('workstation-results.json').and.include('workstation-result-qualification.json');
  });
  it('retains the stable test check and requires every independent job and matrix result', () => {
    expect(jobs.test.if).to.equal('${{ always() }}');
    expect([...jobs.test.needs].sort()).to.deep.equal(Object.keys(jobs).filter(name => name !== 'test').sort());
    expect(jobs.test.steps.at(-1).env.NEEDS_RESULTS).to.equal('${{ toJSON(needs) }}');
  });
  it('fails the aggregate on failed, skipped, cancelled or absent validation results', function() {
    this.timeout(10000);
    const run = jobs.test.steps.at(-1).run, code = run.match(/node --input-type=module -e '([\s\S]*)'\s*$/)[1];
    const passed = Object.fromEntries(jobs.test.needs.map(name => [name, { result: 'success' }]));
    const execute = results => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000, env: { ...process.env, NEEDS_RESULTS: JSON.stringify(results) } });
    expect(execute(passed).status).to.equal(0);
    for (const result of ['failure', 'skipped', 'cancelled']) { const failed = { ...passed, workstation: { result } }, actual = execute(failed); expect(actual.status, actual.stderr).to.equal(1); expect(actual.stderr).to.include('workstation: ' + result); }
    expect(execute({}).status).not.to.equal(0);
  });
  it('owns the HTTPS smoke server within its isolated job and always verifies its PID before cleanup', () => {
    const steps = jobs['mcp-smoke'].steps, start = steps.findIndex(step => step.name === 'Start HTTPS server'), stop = steps.find(step => step.name === 'Stop HTTPS server');
    expect(start).to.be.lessThan(steps.findIndex(step => step.run === 'npm run test-mcp-smoke')); expect(stop.if).to.equal('always()');
    expect(steps[start].run).to.include('LEMMINGS_HTTP_OWNER="${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${GITHUB_JOB}"');
    expect(stop.run).to.include('grep -zFxq "LEMMINGS_HTTP_OWNER=${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${GITHUB_JOB}" "/proc/$server_pid/environ"');
  });
});
