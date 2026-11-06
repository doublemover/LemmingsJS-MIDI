import { createBufferedWarpVoiceWorkerEndpoint } from './BufferedWarpVoiceWorkerEndpoint.js';
const endpoint = createBufferedWarpVoiceWorkerEndpoint({ postMessage: (message, transfers) => globalThis.postMessage(message, transfers), close: () => globalThis.close() });
globalThis.addEventListener('message', event => { void endpoint.receive(event.data); });
globalThis.addEventListener('messageerror', () => endpoint.fail(new Error('The streaming warp request could not be decoded.')));
