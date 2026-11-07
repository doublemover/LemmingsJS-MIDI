import { createProcgenSimulationWorkerEndpoint } from './ProcgenSimulationWorkerEndpoint.js';
const endpoint = createProcgenSimulationWorkerEndpoint({ postMessage: (value, transfers) => globalThis.postMessage(value, transfers), close: () => globalThis.close() });
globalThis.addEventListener('message', event => { void endpoint.receive(event.data); });
globalThis.addEventListener('messageerror', () => endpoint.fail(new Error('The authoritative simulation message could not be decoded.')));
