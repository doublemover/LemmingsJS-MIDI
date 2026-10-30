import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createBackgroundJobWorkerEndpoint } from '../../js/app/resources/BackgroundJobWorkerEndpoint.js';

// Exercise the production paged transport and kernels with explicit ownership.
// This supplies browser Worker semantics to headless orchestration fixtures.
class BackgroundWorker {
  constructor(endpointOptions = {}) {
    this.terminated = false;
    this.endpoint = createBackgroundJobWorkerEndpoint({ ...endpointOptions, close() {}, postMessage: (message, transfer = []) => {
      const data = structuredClone(message, { transfer });
      queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data }); });
    } });
  }
  postMessage(message, transfer = []) {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => { if (!this.terminated) void this.endpoint.receive(data); });
  }
  terminate() { this.terminated = true; }
}

export function createTestBackgroundJobs(endpointOptions = {}) {
  const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: class extends BackgroundWorker { constructor() { super(endpointOptions); } } });
  return { ...jobs, dispose() { jobs.dispose(); admission.dispose(); } };
}
