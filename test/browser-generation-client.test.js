import { expect } from 'chai';
import { waitForBrowserGeneration } from '../js/runtime/BrowserGenerationClient.js';

const buildId = 'a'.repeat(64), otherBuild = 'b'.repeat(64);
function channelFactory(reply) {
  return class {
    constructor() {
      this.port1 = { onmessage: null, close() {} };
      this.port2 = { close() {}, receive: () => reply(this.port1) };
    }
  };
}
describe('browser generation client terminal installation ownership', () => {
  it('rejects a known redundant first installer without waiting for the global deadline', async () => {
    const registration = {}, worker = { state: 'installing', postMessage(_message, [port]) { port.receive(); } }; registration.installing = worker;
    const Channel = channelFactory(port => {
      worker.state = 'redundant'; registration.installing = null;
      queueMicrotask(() => port.onmessage({ data: { schemaVersion: 1, buildId, status: 'installing', completedFiles: 448, totalFiles: 1275 } }));
    });
    let failure; try { await waitForBrowserGeneration(registration, buildId, { timeout: 1000, Channel }); } catch (error) { failure = error; }
    expect(failure?.message).to.equal('The complete browser generation could not be installed.');
  });
  it('does not mistake an existing active build for a successful requested replacement', async () => {
    const registration = {}, old = { state: 'activated', postMessage(_message, [port]) { port.receive(); } }, candidate = { state: 'installing', postMessage(_message, [port]) { port.receive(); } };
    registration.active = old; registration.installing = candidate;
    const Channel = channelFactory(port => {
      candidate.state = 'redundant'; registration.installing = null;
      queueMicrotask(() => port.onmessage({ data: { schemaVersion: 1, buildId: otherBuild, status: 'installed', offlineReady: true } }));
    });
    let failure; try { await waitForBrowserGeneration(registration, buildId, { timeout: 1000, Channel }); } catch (error) { failure = error; }
    expect(failure?.message).to.equal('The complete browser generation could not be installed.'); expect(registration.active).to.equal(old);
  });
  it('accepts the verified requested build before considering an obsolete redundant candidate', async () => {
    const registration = {}, old = { state: 'redundant' }, active = { state: 'activated', postMessage(_message, [port]) { port.receive(); } }; registration.waiting = old;
    old.postMessage = (_message, [port]) => { registration.waiting = null; registration.active = active; port.receive(); };
    const Channel = channelFactory(port => queueMicrotask(() => port.onmessage({ data: { schemaVersion: 1, buildId, status: 'installed', offlineReady: true } })));
    const result = await waitForBrowserGeneration(registration, buildId, { timeout: 1000, Channel });
    expect(result).to.include({ buildId, status: 'installed', offlineReady: true });
  });
  it('continues when a newer installer replaces an obsolete redundant candidate', async () => {
    const registration = {}, next = { state: 'installing', postMessage(_message, [port]) { port.receive(); } }, old = { state: 'installing' }; registration.installing = old;
    let replies = 0;
    old.postMessage = (_message, [port]) => { old.state = 'redundant'; registration.installing = next; port.receive(); };
    const Channel = channelFactory(port => queueMicrotask(() => port.onmessage({ data: { schemaVersion: 1, buildId,
      status: ++replies === 1 ? 'installing' : 'installed', offlineReady: replies > 1 } })));
    const result = await waitForBrowserGeneration(registration, buildId, { timeout: 1000, Channel });
    expect(result.status).to.equal('installed'); expect(replies).to.equal(2);
  });
});
