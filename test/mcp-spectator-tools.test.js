import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createSpectatorTools } from '../mcp/spectatorTools.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error('Timed out while waiting for condition.');
};

const connectSocket = async (url) => {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      ws.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      ws.off('open', onOpen);
      reject(error);
    };
    ws.once('open', onOpen);
    ws.once('error', onError);
  });
  return ws;
};

describe('mcp spectator tools', function () {
  let tempDir = '';
  let spectatorHtmlPath = '';

  beforeEach(async function () {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-mcp-spectator-'));
    spectatorHtmlPath = path.join(tempDir, 'spectator.html');
    await fs.writeFile(spectatorHtmlPath, '<!doctype html><html><body>spectator</body></html>', 'utf8');
  });

  afterEach(async function () {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    tempDir = '';
    spectatorHtmlPath = '';
  });

  it('streams frames and handles human keyboard/mouse input when enabled', async function () {
    const capturedEvents = [];
    const keyCalls = [];
    const mouseClicks = [];
    let captureCalls = 0;
    let focusCalls = 0;

    const { startSpectatorServer, stopSpectatorServer } = createSpectatorTools({
      spectatorHtmlPath,
      captureFrame: async () => {
        captureCalls += 1;
        return {
          ok: true,
          frame: {
            mimeType: 'image/jpeg',
            dataBase64: 'ZmFrZQ==',
            tickIndex: 7,
            takenAt: 'now'
          }
        };
      },
      resolveCanvasMetrics: async () => ({ rect: { x: 10, y: 20, width: 200, height: 100 } }),
      normalizeKeyToken: (token) => token,
      ensureGameFocus: async () => { focusCalls += 1; }
    });

    const session = {
      page: {
        keyboard: {
          down: async (key) => { keyCalls.push(['down', key]); },
          up: async (key) => { keyCalls.push(['up', key]); },
          press: async (key) => { keyCalls.push(['press', key]); }
        },
        mouse: {
          click: async (x, y) => { mouseClicks.push([x, y]); }
        }
      },
      events: {
        add: (event) => capturedEvents.push(event)
      },
      spectator: null
    };

    const baseUrl = await startSpectatorServer(session, {
      port: 0,
      allowHumanInput: true,
      frameIntervalMs: 50
    });

    const ws = await connectSocket(baseUrl.replace('http://', 'ws://'));
    await waitFor(() => captureCalls > 0);
    expect(captureCalls).to.be.greaterThan(0);

    ws.send(JSON.stringify({ type: 'key', action: 'press', key: 'A' }));
    ws.send(JSON.stringify({ type: 'key', action: 'press', key: '   ' }));
    ws.send(JSON.stringify({ type: 'click', x: 0.5, y: 0.5 }));
    ws.send(JSON.stringify({ type: 'click', x: 1, y: 1 }));
    await waitFor(() => keyCalls.length === 1 && mouseClicks.length === 2);

    expect(focusCalls).to.equal(1);
    expect(keyCalls).to.deep.equal([['press', 'A']]);
    expect(mouseClicks[0][0]).to.equal(110);
    expect(mouseClicks[0][1]).to.equal(70);
    expect(mouseClicks[1][0]).to.equal(209);
    expect(mouseClicks[1][1]).to.equal(119);
    expect(capturedEvents.some((event) => event.summary === 'key:press:A')).to.equal(true);
    expect(capturedEvents.some((event) => event.summary?.startsWith('click:'))).to.equal(true);

    ws.close();
    await new Promise((resolve) => ws.once('close', resolve));
    stopSpectatorServer(session);
    expect(session.spectator).to.equal(null);
  });

  it('ignores inbound human input when allowHumanInput is disabled', async function () {
    const keyCalls = [];
    const mouseClicks = [];
    const { startSpectatorServer, stopSpectatorServer } = createSpectatorTools({
      spectatorHtmlPath,
      captureFrame: async () => ({ ok: false, reason: 'capture_disabled' }),
      resolveCanvasMetrics: async () => ({ rect: { x: 0, y: 0, width: 100, height: 100 } }),
      normalizeKeyToken: (token) => token,
      ensureGameFocus: async () => {}
    });

    const session = {
      page: {
        keyboard: {
          down: async (key) => { keyCalls.push(['down', key]); },
          up: async (key) => { keyCalls.push(['up', key]); },
          press: async (key) => { keyCalls.push(['press', key]); }
        },
        mouse: {
          click: async (x, y) => { mouseClicks.push([x, y]); }
        }
      },
      events: { add() {} },
      spectator: null
    };

    const baseUrl = await startSpectatorServer(session, {
      port: 0,
      allowHumanInput: false,
      frameIntervalMs: 50
    });
    const ws = await connectSocket(baseUrl.replace('http://', 'ws://'));
    ws.send(JSON.stringify({ type: 'key', action: 'press', key: 'A' }));
    ws.send(JSON.stringify({ type: 'click', x: 0.5, y: 0.5 }));
    await delay(100);

    expect(keyCalls).to.deep.equal([]);
    expect(mouseClicks).to.deep.equal([]);

    ws.close();
    await new Promise((resolve) => ws.once('close', resolve));
    stopSpectatorServer(session);
  });

  it('clamps click offsets for tiny fractional canvas metrics', async function () {
    const mouseClicks = [];
    const { startSpectatorServer, stopSpectatorServer } = createSpectatorTools({
      spectatorHtmlPath,
      captureFrame: async () => ({ ok: false, reason: 'capture_disabled' }),
      resolveCanvasMetrics: async () => ({ rect: { x: 10, y: 20, width: 0.25, height: 0.5 } }),
      normalizeKeyToken: (token) => token,
      ensureGameFocus: async () => {}
    });

    const session = {
      page: {
        keyboard: {
          down: async () => {},
          up: async () => {},
          press: async () => {}
        },
        mouse: {
          click: async (x, y) => { mouseClicks.push([x, y]); }
        }
      },
      events: { add() {} },
      spectator: null
    };

    const baseUrl = await startSpectatorServer(session, {
      port: 0,
      allowHumanInput: true,
      frameIntervalMs: 50
    });
    const ws = await connectSocket(baseUrl.replace('http://', 'ws://'));
    ws.send(JSON.stringify({ type: 'click', x: 1, y: 1 }));
    await waitFor(() => mouseClicks.length === 1);

    expect(mouseClicks[0][0]).to.equal(10);
    expect(mouseClicks[0][1]).to.equal(20);

    ws.close();
    await new Promise((resolve) => ws.once('close', resolve));
    stopSpectatorServer(session);
  });
});
