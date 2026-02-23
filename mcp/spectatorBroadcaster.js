const SPECTATOR_SKIP_POLICIES = Object.freeze({
  LATEST: 'latest',
  NONE: 'none'
});

const DEFAULT_SPECTATOR_STREAM_CONFIG = Object.freeze({
  frameIntervalMs: 500,
  jpegQuality: 60,
  frameSkipPolicy: SPECTATOR_SKIP_POLICIES.LATEST
});

const clampInt = (value, fallback, min, max) => {
  let number;
  try {
    number = Number(value);
  } catch {
    number = Number.NaN;
  }
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
};

const normalizeFrameSkipPolicy = (policy) => {
  const normalized = String(policy ?? '').trim().toLowerCase();
  if (normalized === SPECTATOR_SKIP_POLICIES.NONE) return SPECTATOR_SKIP_POLICIES.NONE;
  return SPECTATOR_SKIP_POLICIES.LATEST;
};

/**
 * Normalize spectator streaming knobs to bounded safe values.
 *
 * @param {{
 *   frameIntervalMs?: number,
 *   jpegQuality?: number,
 *   frameSkipPolicy?: string
 * }} [config]
 * @returns {{frameIntervalMs:number,jpegQuality:number,frameSkipPolicy:string}}
 */
const normalizeSpectatorStreamConfig = (config = {}) => ({
  frameIntervalMs: clampInt(config.frameIntervalMs, DEFAULT_SPECTATOR_STREAM_CONFIG.frameIntervalMs, 50, 5000),
  jpegQuality: clampInt(config.jpegQuality, DEFAULT_SPECTATOR_STREAM_CONFIG.jpegQuality, 1, 100),
  frameSkipPolicy: normalizeFrameSkipPolicy(config.frameSkipPolicy)
});

class SpectatorBroadcaster {
  constructor({ frameSkipPolicy = DEFAULT_SPECTATOR_STREAM_CONFIG.frameSkipPolicy } = {}) {
    this.frameSkipPolicy = normalizeFrameSkipPolicy(frameSkipPolicy);
    this.clients = new Set();
  }

  attach(ws) {
    if (!ws) return null;
    for (const existingClient of this.clients) {
      if (existingClient.ws === ws) {
        return existingClient;
      }
    }
    const client = {
      ws,
      sending: false,
      queuedFrame: null,
      sentCount: 0,
      droppedCount: 0
    };
    this.clients.add(client);
    return client;
  }

  detach(ws) {
    let removed = false;
    for (const client of this.clients) {
      if (client.ws === ws) {
        this.clients.delete(client);
        removed = true;
      }
    }
    return removed;
  }

  broadcast(payload) {
    if (payload == null) return;
    let serialized;
    try {
      serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    } catch {
      return;
    }
    for (const client of this.clients) {
      this._sendFrame(client, serialized);
    }
  }

  getSnapshot() {
    let connectedClients = 0;
    let droppedFrames = 0;
    let sentFrames = 0;
    for (const client of this.clients) {
      if (client?.ws?.readyState === 1) {
        connectedClients += 1;
      }
      droppedFrames += client.droppedCount;
      sentFrames += client.sentCount;
    }
    return {
      connectedClients,
      sentFrames,
      droppedFrames,
      frameSkipPolicy: this.frameSkipPolicy
    };
  }

  closeAll() {
    for (const client of this.clients) {
      try {
        client.ws?.close();
      } catch (error) {
        // Ignore close failures and continue cleanup.
      }
      this.clients.delete(client);
    }
  }

  _sendFrame(client, serialized) {
    const ws = client.ws;
    if (!ws || ws.readyState !== 1) {
      this.clients.delete(client);
      return;
    }

    if (this.frameSkipPolicy === SPECTATOR_SKIP_POLICIES.LATEST && client.sending) {
      if (client.queuedFrame !== null) {
        client.droppedCount += 1;
      }
      client.queuedFrame = serialized;
      return;
    }

    client.sending = true;
    try {
      ws.send(serialized, (error) => {
        client.sending = false;
        if (error || ws.readyState !== 1) {
          this.clients.delete(client);
          return;
        }
        client.sentCount += 1;
        if (this.frameSkipPolicy === SPECTATOR_SKIP_POLICIES.LATEST && client.queuedFrame !== null) {
          const queued = client.queuedFrame;
          client.queuedFrame = null;
          this._sendFrame(client, queued);
        }
      });
    } catch (error) {
      client.sending = false;
      this.clients.delete(client);
    }
  }
}

export {
  DEFAULT_SPECTATOR_STREAM_CONFIG,
  SPECTATOR_SKIP_POLICIES,
  SpectatorBroadcaster,
  normalizeSpectatorStreamConfig
};
