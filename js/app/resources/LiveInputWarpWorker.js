import { createLiveInputWarpWorkerEndpoint } from './LiveInputWarpWorkerEndpoint.js';
const endpoint = createLiveInputWarpWorkerEndpoint({ postMessage: (message, transfers) => globalThis.postMessage(message, transfers), close: () => globalThis.close() });
globalThis.addEventListener('message', event => { void endpoint.receive(event.data); });
globalThis.addEventListener('messageerror', () => endpoint.fail(new Error('The live input processing source could not be decoded.')));
