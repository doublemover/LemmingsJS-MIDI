import { createProcgenNativeOutputWorkerEndpoint } from './ProcgenNativeOutputWorkerEndpoint.js';
const endpoint = createProcgenNativeOutputWorkerEndpoint({ postMessage: value => globalThis.postMessage(value), close: () => globalThis.close() });
globalThis.addEventListener('message', event => endpoint.receive(event.data));
globalThis.addEventListener('messageerror', () => endpoint.fail(new Error('The native consumer worker control could not be decoded.')));
