import { BACKGROUND_JOB_PROTOCOL, BACKGROUND_JOB_KINDS, runBackgroundJobKernel } from './BackgroundJobKernels.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';

let used = false;
globalThis.addEventListener('message', async event => {
  const request = event.data;
  const respond = payload => globalThis.postMessage({ protocol: BACKGROUND_JOB_PROTOCOL, jobId: request?.jobId,
    ownerEpoch: request?.ownerEpoch, sourceRevision: request?.sourceRevision, ...payload });
  try {
    if (used || request?.protocol !== BACKGROUND_JOB_PROTOCOL || !/^background-[0-9]+$/.test(request.jobId || '') ||
        !Number.isSafeInteger(request.ownerEpoch) || request.ownerEpoch < 0 || !['number', 'string'].includes(typeof request.sourceRevision) ||
        String(request.sourceRevision).length > 256 || !BACKGROUND_JOB_KINDS.includes(request.kind)) throw new Error('Invalid background job worker envelope.');
    used = true;
    if (request.requiredIdentity?.activeExecution === 'bound' && !compareActiveExecutionIdentity(request.requiredIdentity, 'browser-background-jobs').matched)
      throw new Error('Background worker executes a different immutable build.');
    const result = await runBackgroundJobKernel(request.kind, request.input, { ...request.limits,
      onProgress: progress => respond({ type: 'progress', progress }) });
    respond({ type: 'computed', result, executionIdentity: getActiveExecutionIdentity('browser-background-jobs') });
  } catch (error) { respond({ type: 'failed', error: { code: String(error.code || error.name).slice(0, 64), message: String(error.message || error).slice(0, 512) } }); }
  finally { globalThis.close(); }
});
globalThis.addEventListener('messageerror', () => globalThis.close());
