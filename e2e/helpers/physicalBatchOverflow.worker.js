import { physicalBatchOverflow } from '../../test/helpers/physicalBatchOverflow.js';
globalThis.onmessage = event => {
  try {
    const result = physicalBatchOverflow({ ...event.data, onBatch: batch => globalThis.postMessage({ type: 'batch', batch }), onRearm: () => globalThis.postMessage({ type: 'rearm' }) });
    globalThis.postMessage({ type: 'result', result });
  }
  catch (error) { globalThis.postMessage({ error: error.message }); }
};
