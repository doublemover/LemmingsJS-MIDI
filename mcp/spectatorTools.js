import fs from 'node:fs/promises';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { normalizeSpectatorStreamConfig, SpectatorBroadcaster } from './spectatorBroadcaster.js';

const createSpectatorTools = ({
  spectatorHtmlPath,
  captureFrame,
  resolveCanvasMetrics,
  normalizeKeyToken,
  ensureGameFocus
}) => {
  const handleSpectatorInput = async (session, payload) => {
    if (!payload || !session.spectator?.allowHumanInput) return;
    if (payload.type === 'key') {
      const key = normalizeKeyToken(payload.key);
      await ensureGameFocus(session);
      if (payload.action === 'down') {
        await session.page.keyboard.down(key);
      } else if (payload.action === 'up') {
        await session.page.keyboard.up(key);
      }
      session.events.add({
        source: 'human',
        type: 'input',
        summary: `key:${payload.action}:${key}`
      });
      return;
    }
    if (payload.type === 'click') {
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      const metrics = await resolveCanvasMetrics(session);
      if (!metrics) return;
      const x = metrics.rect.x + metrics.rect.width * payload.x;
      const y = metrics.rect.y + metrics.rect.height * payload.y;
      await session.page.mouse.click(x, y);
      session.events.add({
        source: 'human',
        type: 'input',
        summary: `click:${payload.x.toFixed(2)},${payload.y.toFixed(2)}`
      });
    }
  };

  const startSpectatorServer = async (session, options = {}) => {
    const html = await fs.readFile(spectatorHtmlPath, 'utf8');
    const port = Number.isFinite(options.port) ? options.port : 0;
    const allowHumanInput = options.allowHumanInput === true;
    const streamConfig = normalizeSpectatorStreamConfig(options);
    const broadcaster = new SpectatorBroadcaster({
      frameSkipPolicy: streamConfig.frameSkipPolicy
    });

    const server = http.createServer((req, res) => {
      if (req.url && req.url !== '/' && req.url !== '/index.html') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      broadcaster.attach(ws);
      ws.send(JSON.stringify({
        type: 'hello',
        allowHumanInput,
        streamConfig
      }));
      if (session.spectator?.lastFrame) {
        ws.send(JSON.stringify(session.spectator.lastFrame));
      }
      ws.on('message', async (data) => {
        if (!allowHumanInput) return;
        let payload;
        try {
          payload = JSON.parse(data.toString());
        } catch {
          return;
        }
        await handleSpectatorInput(session, payload);
      });
      ws.on('close', () => {
        broadcaster.detach(ws);
      });
      ws.on('error', () => {
        broadcaster.detach(ws);
      });
    });

    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const baseUrl = `http://127.0.0.1:${actualPort}`;

    session.spectator = {
      server,
      wss,
      broadcaster,
      allowHumanInput,
      streamConfig,
      url: baseUrl,
      lastFrame: null,
      frameTimer: null,
      isCapturing: false
    };

    session.spectator.frameTimer = setInterval(async () => {
      const spectator = session.spectator;
      if (!spectator) return;
      if (spectator.isCapturing) return;
      if (spectator.broadcaster.getSnapshot().connectedClients <= 0) return;
      spectator.isCapturing = true;
      try {
        const result = await captureFrame(session, {
          target: 'stageCanvas',
          format: 'jpeg',
          quality: spectator.streamConfig.jpegQuality,
          delivery: 'inline'
        });
        if (session.spectator !== spectator) return;
        if (result.ok && result.frame?.dataBase64) {
          const payload = {
            type: 'frame',
            mimeType: result.frame.mimeType,
            dataBase64: result.frame.dataBase64,
            tickIndex: result.frame.tickIndex ?? null,
            takenAt: result.frame.takenAt ?? null
          };
          spectator.lastFrame = payload;
          spectator.broadcaster.broadcast(payload);
        }
      } catch (err) {
        session.events.add({
          source: 'system',
          type: 'error',
          summary: 'spectator capture failed',
          data: { message: err ? String(err) : 'unknown' }
        });
      } finally {
        if (session.spectator === spectator) {
          spectator.isCapturing = false;
        }
      }
    }, streamConfig.frameIntervalMs);

    return baseUrl;
  };

  const stopSpectatorServer = (session) => {
    if (!session.spectator) return;
    const { server, wss, frameTimer, broadcaster } = session.spectator;
    if (frameTimer) clearInterval(frameTimer);
    broadcaster?.closeAll();
    try {
      wss?.close();
    } catch {
      /* ignore */
    }
    try {
      server?.close();
    } catch {
      /* ignore */
    }
    session.spectator = null;
  };

  return {
    startSpectatorServer,
    stopSpectatorServer
  };
};

export { createSpectatorTools };
