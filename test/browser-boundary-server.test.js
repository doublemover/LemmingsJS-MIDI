import { expect } from 'chai';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { withBoundaryServer, runBrowserBoundaries } from '../scripts/run-browser-boundaries.js';

const closed = baseURL => new Promise((resolve, reject) => {
  const url = new URL(baseURL), socket = createConnection({ host: url.hostname, port: Number(url.port) });
  socket.once('connect', () => { socket.destroy(); reject(new Error('Owned server remained listening')); });
  socket.once('error', error => { if (error.code === 'ECONNREFUSED') resolve(); else reject(error); });
});

describe('owned browser boundary server', () => {
  it('serves this checkout concurrently on distinct owned ports and closes each lease', async () => {
    const origins = [];
    await Promise.all([0, 1].map(() => withBoundaryServer(async origin => {
      origins.push(origin);
      const response = await fetch(origin + '/package.json');
      expect(response.status).to.equal(200); expect((await response.json()).name).to.equal('lemmings-js-midi');
    })));
    expect(new Set(origins).size).to.equal(2);
    await Promise.all(origins.map(closed));
  });

  it('closes a failed lease without touching an independent listener', async () => {
    let requests = 0, owned;
    const foreign = createServer((request, response) => { requests++; response.end('independent listener'); });
    await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + foreign.address().port;
    const failure = new Error('boundary fixture failed');
    try {
      try { await withBoundaryServer(async baseURL => { owned = baseURL; expect(baseURL).not.to.equal(origin); throw failure; }); expect.fail('Expected fixture failure'); }
      catch (error) { expect(error).to.equal(failure); }
      await closed(owned); expect(requests).to.equal(0);
      expect(await (await fetch(origin)).text()).to.equal('independent listener');
    } finally { await new Promise(resolve => foreign.close(resolve)); }
  });

  it('propagates an actual Playwright startup failure and releases its own server', async function() {
    this.timeout(10000);
    let origin;
    const code = await runBrowserBoundaries(['--unknown-boundary-option'], { env: { ...process.env, CI: '1', LEMMINGS_E2E_BASE_URL: 'http://127.0.0.1:8080' }, stdio: 'ignore',
      log: value => { origin = value.split(' ').at(-1); } });
    expect(code).not.to.equal(0); expect(new URL(origin).port).not.to.equal('8080'); await closed(origin);
  });
});
