import { createProcgenOwnedAudioOutputWorkerEndpoint } from './ProcgenOwnedAudioOutputWorkerEndpoint.js';
const endpoint = createProcgenOwnedAudioOutputWorkerEndpoint({ postMessage: value => globalThis.postMessage(value), close: () => globalThis.close() });
globalThis.addEventListener('message', event => endpoint.receive(event.data));
globalThis.addEventListener('messageerror', () => endpoint.fail(new Error('The independent owned-audio message could not decode.')));
