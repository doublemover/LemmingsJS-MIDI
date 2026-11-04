import assert from 'node:assert/strict';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const weights = { interactive: 3, recovery: 2, background: 1 };
const live = phase => ['queued', 'running', 'computed', 'failed-or-unknown'].includes(phase);
export function admissionReference({ maxWorkers = 2, maxQueuedJobs = 4, maxQueuedInputBytes = 512 } = {}) {
  const jobs = new Map(); let time = 0, serial = 0, retired = false;
  const drain = () => {
    if (retired) return;
    const runnable = () => [...jobs.values()].filter(job => ['running', 'failed-or-unknown'].includes(job.phase)).length;
    while (runnable() < maxWorkers) {
      const queued = [...jobs.values()].filter(job => job.phase === 'queued').sort((a, b) =>
        weights[b.priority] + Math.floor((time - b.at) / 1000) - weights[a.priority] - Math.floor((time - a.at) / 1000) || a.serial - b.serial);
      if (!queued.length) break;
      queued[0].phase = 'running'; queued[0].wait = time - queued[0].at;
    }
  };
  const apply = command => {
    const job = jobs.get(command.id);
    if (command.kind === 'acquire') {
      if (job || retired) return false;
      const queued = [...jobs.values()].filter(value => value.phase === 'queued'), active = [...jobs.values()].filter(value => ['running', 'failed-or-unknown'].includes(value.phase));
      const denied = queued.length >= maxQueuedJobs && active.length >= maxWorkers || queued.reduce((sum, value) => sum + value.inputBytes, 0) + command.inputBytes > maxQueuedInputBytes;
      jobs.set(command.id, { ...command, serial: denied ? null : ++serial, at: time, wait: null, bytes: denied ? 0 : command.peak, phase: denied ? 'denied' : 'queued' }); drain();
    } else if (command.kind === 'advance') time += command.ms;
    else if (command.kind === 'dispose') { if (retired) return false; retired = true; for (const value of jobs.values()) if (['queued', 'running', 'computed'].includes(value.phase)) { value.phase = value.phase === 'queued' ? 'canceled' : 'released'; value.bytes = 0; } }
    else {
      if (!job) return false;
      if (command.kind === 'finish') {
        if (job.phase !== 'running') return false;
        if (command.interrupt) return apply({ kind: command.interrupt, id: command.id });
        job.bytes = command.retained; job.phase = command.retained ? 'computed' : 'released';
      } else if (command.kind === 'unknown') {
        if (!['running', 'computed'].includes(job.phase)) return false;
        job.phase = 'failed-or-unknown'; job.bytes = job.peak;
      } else if (command.kind === 'confirm') {
        if (job.phase !== 'failed-or-unknown') return false;
        job.phase = 'released'; job.bytes = 0;
      } else if (command.kind === 'abort') {
        if (!['queued', 'running', 'computed'].includes(job.phase)) return false;
        job.phase = job.phase === 'queued' ? 'canceled' : 'released'; job.bytes = 0;
      } else if (command.kind === 'release') {
        if (!['running', 'computed', 'failed-or-unknown'].includes(job.phase)) return false;
        if (job.phase !== 'failed-or-unknown') { job.phase = 'released'; job.bytes = 0; }
      } else return false;
      drain();
    }
    return true;
  };
  return { jobs, apply, now: () => time, options: { maxWorkers, maxQueuedJobs, maxQueuedInputBytes }, retired: () => retired };
}

export function generateAdmissionTrace(seed, { steps = 128, ...options } = {}) {
  const model = admissionReference(options), trace = []; let word = seed >>> 0, nextId = 0;
  const random = max => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % max; };
  for (let step = 0; step < steps; step++) {
    const candidates = [...model.jobs.values()].filter(job => live(job.phase)), choice = random(10); let command;
    if (choice < 3 || !candidates.length) command = { kind: 'acquire', id: 'job:' + nextId++, priority: Object.keys(weights)[random(3)], inputBytes: random(5) * 64, peak: 8192 + random(4) * 4096 };
    else if (choice === 3) command = { kind: 'advance', ms: random(5000) };
    else {
      const job = candidates[random(candidates.length)];
      const kinds = job.phase === 'queued' ? ['abort'] : job.phase === 'failed-or-unknown' ? ['confirm', 'release'] : job.phase === 'running' ? ['finish', 'abort', 'unknown', 'release'] : ['abort', 'unknown', 'release'];
      const kind = kinds[random(kinds.length)]; command = { kind, id: job.id };
      if (kind === 'finish') {
        command.retained = random(4) * 1024;
        if (command.retained && random(3) === 0) Object.assign(command, { interrupt: ['abort', 'release', 'unknown'][random(3)], budget: ['shared', 'external'][random(2)], when: ['before', 'after'][random(2)] });
      }
    }
    if (!model.apply(command)) throw new Error('Generator emitted an invalid precondition.'); trace.push(command);
  }
  trace.push({ kind: 'dispose' }); return trace;
}

export async function replayAdmissionTrace(trace, { factory = createBackgroundWorkerAdmission, checkBudget = () => {}, ...options } = {}) {
  const model = admissionReference(options), handles = new Map(), shared = createResourceBudget(), external = createResourceBudget(); let hook = null, service;
  const execute = command => {
    const handle = handles.get(command.id);
    if (command.kind === 'abort') handle.controller.abort(new Error('Modeled source cancellation'));
    else if (command.kind === 'release') handle.lease.release();
    else if (command.kind === 'unknown') handle.lease.retainUnknown(new Error('Modeled unknown retirement'));
    else if (command.kind === 'confirm') handle.lease.confirmRetirement();
    else if (command.kind === 'dispose') service.dispose();
  };
  const adapter = (actual, name) => ({ diagnostics: actual.diagnostics, release: actual.release, reserve(request) {
    const interrupt = when => { if (hook?.budget === name && hook.when === when) { const command = hook; hook = null; execute({ kind: command.interrupt, id: command.id }); } };
    interrupt('before'); actual.reserve(request); interrupt('after');
  } });
  service = factory({ ...model.options, resourceBudget: adapter(shared, 'shared'), now: model.now });
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  let step = 0;
  try {
    for (const command of trace) {
      if (step % 32 === 0) checkBudget();
      if (!model.apply(command)) return { valid: false, step };
      if (command.kind === 'acquire') {
        const handle = { controller: new AbortController(), lease: null, rejected: false }; handles.set(command.id, handle);
        service.acquire({ kind: 'parse-json', ownerId: command.id, ownerEpoch: 1, sourceRevision: 'model:1', priority: command.priority,
          inputBytes: command.inputBytes, estimatedPeakBytes: command.peak, budgetAdapter: adapter(external, 'external'), signal: handle.controller.signal,
          deadlineMs: 600000, onCancel(_reason, lease) { lease.release(); } }).then(lease => { handle.lease = lease; }, () => { handle.rejected = true; });
      } else if (command.kind === 'finish') {
        hook = command.interrupt ? command : null; const completed = handles.get(command.id).lease.computationFinished({ retainedBytes: command.retained });
        assert.equal(completed, !command.interrupt, 'retired computation cannot publish a result'); assert.equal(hook, null, 'resize interrupt must execute');
      } else if (command.kind !== 'advance') execute(command);
      await settle();
      const values = [...model.jobs.values()], diagnostics = service.diagnostics();
      assert.equal(diagnostics.activeWorkers, values.filter(job => ['running', 'failed-or-unknown'].includes(job.phase)).length, 'active ownership');
      assert.equal(diagnostics.retainedResults, values.filter(job => job.phase === 'computed').length, 'retained ownership');
      assert.equal(diagnostics.queuedJobs, values.filter(job => job.phase === 'queued').length, 'queue inventory');
      assert.equal(diagnostics.queuedInputBytes, values.filter(job => job.phase === 'queued').reduce((sum, job) => sum + job.inputBytes, 0), 'queued input ownership');
      assert.equal(diagnostics.retired, model.retired(), 'owner retirement');
      const bytes = values.reduce((sum, job) => sum + job.bytes, 0);
      const accounted = values.reduce((sum, job) => sum + Math.ceil(job.bytes * 1.25), 0);
      for (const [name, budget] of [['shared', shared], ['external', external]]) {
        assert.equal(budget.diagnostics().residentBytes, bytes, name + ' resident estimate');
        assert.equal(budget.diagnostics().accountedBytes, accounted, name + ' accounted estimate with candidate overhead');
      }
      for (const job of values) {
        const handle = handles.get(job.id);
        if (['denied', 'canceled'].includes(job.phase)) assert.equal(handle.rejected, true, job.id + ' terminal refusal');
        else if (job.phase === 'queued') assert.equal(handle.lease, null, job.id + ' queued producer must not start');
        else { assert.equal(handle.lease?.getState().phase, job.phase, job.id + ' phase'); assert.equal(handle.lease.getState().queueWaitMs, job.wait, job.id + ' queue age'); }
      }
      step++;
    }
    return { valid: true, transitions: step, jobs: handles.size };
  } catch (error) { error.modelTrace = { step, command: trace[step], prefix: trace.slice(0, step + 1) }; throw error; }
  finally {
    hook = null;
    for (const handle of handles.values()) if (handle.lease?.getState().phase === 'failed-or-unknown') handle.lease.confirmRetirement();
    service.dispose(); for (const handle of handles.values()) handle.lease?.release(); await settle();
  }
}

export async function shrinkAdmissionTrace(trace, reproduces) {
  let current = trace.slice(), attempts = 0;
  for (const id of new Set(trace.map(command => command.id).filter(Boolean))) {
    const candidate = trace.filter(command => !command.id || command.id === id); attempts++;
    if (await reproduces(candidate)) { current = candidate; break; }
  }
  let width = Math.max(1, Math.floor(current.length / 2));
  while (width) {
    let changed = false;
    for (let start = 0; start < current.length; start += width) {
      const candidate = current.slice(0, start).concat(current.slice(start + width)); attempts++;
      if (await reproduces(candidate)) { current = candidate; changed = true; break; }
    }
    if (!changed) width = Math.floor(width / 2);
  }
  return { trace: current, attempts };
}
