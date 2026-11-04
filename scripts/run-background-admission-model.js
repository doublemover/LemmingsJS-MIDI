import { generateAdmissionTrace, replayAdmissionTrace, shrinkAdmissionTrace } from '../test/support/background-admission-model.js';

const options = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
const seeds = Number(options.seeds ?? 128), steps = Number(options.steps ?? 512), seed = Number(options.seed ?? 9991186), name = String(options.name ?? 'local');
const maxHeapMiB = Number(options['max-heap-mib'] ?? 256);
if (!Number.isSafeInteger(seeds) || seeds < 1 || seeds > 4096 || !Number.isSafeInteger(steps) || steps < 1 || steps > 4096 || !Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff || !/^[a-z0-9_-]{1,32}$/i.test(name) || !Number.isSafeInteger(maxHeapMiB) || maxHeapMiB < 64 || maxHeapMiB > 1024) throw new Error('Use bounded --seeds=1..4096 --steps=1..4096 --seed=1..4294967295 --max-heap-mib=64..1024 --name=AGENT.');
const started = performance.now(), maxMs = 120000; let transitions = 0, maximumObservedHeapBytes = 0;
const checkBudget = () => {
  maximumObservedHeapBytes = Math.max(maximumObservedHeapBytes, process.memoryUsage().heapUsed);
  if (performance.now() - started > maxMs || maximumObservedHeapBytes > maxHeapMiB * 1048576) throw Object.assign(new Error('Admission campaign exceeded its120s/' + maxHeapMiB + 'MiBobserved heap budget.'), { code: 'campaign-budget' });
};
for (let index = 0; index < seeds; index++) {
  checkBudget();
  const currentSeed = (seed + index) >>> 0 || 1, maxWorkers = index % 2 + 1, trace = generateAdmissionTrace(currentSeed, { steps, maxWorkers });
  try { transitions += (await replayAdmissionTrace(trace, { maxWorkers, checkBudget })).transitions; }
  catch (error) {
    if (error.code === 'campaign-budget') throw error;
    const signature = error.message, shrunk = await shrinkAdmissionTrace(error.modelTrace.prefix, async candidate => {
      checkBudget(); try { await replayAdmissionTrace(candidate, { maxWorkers, checkBudget }); return false; } catch (failure) { if (failure.code === 'campaign-budget') throw failure; return failure.message === signature; }
    });
    console.error(JSON.stringify({ name, seed: currentSeed, maxWorkers, signature, ...shrunk })); throw error;
  }
}
checkBudget();
console.log(JSON.stringify({ schema: 'background-admission-campaign/v1', name, seed, seeds, steps, transitions, elapsedMs: performance.now() - started,
  budget: { maxMs, maxHeapBytes: maxHeapMiB * 1048576, observationEveryTransitions: 32 }, maximumObservedHeapBytes }));
