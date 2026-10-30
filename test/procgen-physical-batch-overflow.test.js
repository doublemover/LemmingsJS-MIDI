import { expect } from 'chai';
import { Worker } from 'node:worker_threads';
import { physicalBatchOverflow, physicalOverflowGraph, observePhysicalOverflow } from './helpers/physicalBatchOverflow.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';

const assertRecovery = result => {
  expect(result.limits).to.deep.equal({ facts: 4096, terminalFacts: 256 }); expect(result.listenerErrors).to.equal(0);
  const [initial, dense, complete, rearmed] = result.rows;
  expect(initial).to.include({ activeVoices: 1, recoveryRequired: false }); expect(initial.completeness.status).to.equal('complete');
  expect(dense.actors).to.equal(result.actorCount); expect(dense.completeness.status).to.equal('incomplete'); expect(dense.completeness.dropped).to.be.greaterThan(0);
  expect(dense).to.include({ activeVoices: 0, recoveryRequired: true }); expect(dense.intents.map(value => value.terminationReason)).to.include('incomplete-source');
  expect(complete).to.include({ actors: 1, activeVoices: 0, recoveryRequired: true }); expect(complete.completeness.status).to.equal('complete'); expect(complete.intents).to.deep.equal([]);
  expect(result.rearm).to.include({ status: 'rearmed', resumesHeldVoices: false }); expect(rearmed).to.include({ activeVoices: 1, recoveryRequired: false });
  expect(rearmed.intents.find(value => value.kind === 'begin').voiceId).not.to.equal(initial.intents.find(value => value.kind === 'begin').voiceId);
};
describe('real dense physical batch overflow recovery', function() {
  this.timeout(20000); const results = new Map();
  it('imports its execution-worker entry safely during recursive main-thread discovery', async () => {
    await import('./helpers/physicalBatchOverflowWorker.js');
  });
  for (const actorCount of [1024, 1025]) it('ends held output and requires explicit recovery after ' + actorCount + ' actual actors overflow', () => {
    const result = physicalBatchOverflow({ actorCount }); assertRecovery(result); results.set(actorCount, result);
  });
  it('reproduces the exact committed frontiers and recovery in a real execution worker', async () => {
    const worker = new Worker(new URL('./helpers/physicalBatchOverflowWorker.js', import.meta.url), { workerData: { actorCount: 1025 } });
    const receiver = createCausalMusicEngine({ getGraph: () => physicalOverflowGraph }), received = [];
    try {
      const result = await new Promise((resolve, reject) => {
        worker.on('message', message => { try {
          if (message.type === 'batch') received.push(observePhysicalOverflow(message.batch, receiver));
          else if (message.type === 'rearm') receiver.rearm({ discardUnknownHeldState: true });
          else if (message.type === 'result') resolve(message.result); else reject(new Error('Unknown physical worker message'));
        } catch (error) { reject(error); } });
        worker.once('error', reject); worker.once('exit', code => { if (code) reject(new Error('Physical worker exited: ' + code)); });
      });
      assertRecovery(result); expect(result).to.deep.equal(results.get(1025)); expect(received).to.deep.equal(result.rows);
    } finally { await worker.terminate(); receiver.dispose(); }
  });
});
