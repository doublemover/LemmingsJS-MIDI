import { parentPort, workerData } from 'node:worker_threads';
import { physicalBatchOverflow } from './physicalBatchOverflow.js';
const result = physicalBatchOverflow({ ...workerData, onBatch: batch => parentPort.postMessage({ type: 'batch', batch }), onRearm: () => parentPort.postMessage({ type: 'rearm' }) });
parentPort.postMessage({ type: 'result', result });
