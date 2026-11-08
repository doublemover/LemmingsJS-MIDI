import { createBackgroundJobWorkerEndpoint } from './BackgroundJobWorkerEndpoint.js';
const endpoint = createBackgroundJobWorkerEndpoint({ postMessage: (value, transfers) => globalThis.postMessage(value, transfers), close: () => globalThis.close() });
globalThis.addEventListener('message', event => { void endpoint.receive(event.data); });
globalThis.addEventListener('messageerror', () => endpoint.fail(new Error('Background snapshot message could not be decoded.')));
