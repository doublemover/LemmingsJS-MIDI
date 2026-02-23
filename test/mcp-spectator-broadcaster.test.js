import { expect } from 'chai';
import {
  SpectatorBroadcaster,
  SPECTATOR_SKIP_POLICIES,
  normalizeSpectatorStreamConfig
} from '../mcp/spectatorBroadcaster.js';

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.pendingCallbacks = [];
    this.deferCallbacks = false;
  }

  send(data, callback) {
    this.sent.push(data);
    if (this.deferCallbacks) {
      this.pendingCallbacks.push(callback);
      return;
    }
    if (typeof callback === 'function') {
      callback();
    }
  }

  flush() {
    const callbacks = this.pendingCallbacks.slice();
    this.pendingCallbacks = [];
    for (const callback of callbacks) {
      if (typeof callback === 'function') {
        callback();
      }
    }
  }

  close() {
    this.readyState = 3;
  }
}

describe('SpectatorBroadcaster', function () {
  it('keeps only the latest pending frame for slow clients in latest mode', function () {
    const broadcaster = new SpectatorBroadcaster({
      frameSkipPolicy: SPECTATOR_SKIP_POLICIES.LATEST
    });
    const socket = new FakeSocket();
    socket.deferCallbacks = true;
    broadcaster.attach(socket);

    broadcaster.broadcast({ frame: 1 });
    broadcaster.broadcast({ frame: 2 });
    broadcaster.broadcast({ frame: 3 });

    expect(socket.sent).to.have.lengthOf(1);
    socket.flush();
    expect(socket.sent).to.have.lengthOf(2);
    expect(JSON.parse(socket.sent[0]).frame).to.equal(1);
    expect(JSON.parse(socket.sent[1]).frame).to.equal(3);

    const snapshot = broadcaster.getSnapshot();
    expect(snapshot.droppedFrames).to.equal(1);
  });

  it('sends every frame in none mode', function () {
    const broadcaster = new SpectatorBroadcaster({
      frameSkipPolicy: SPECTATOR_SKIP_POLICIES.NONE
    });
    const socket = new FakeSocket();
    socket.deferCallbacks = true;
    broadcaster.attach(socket);

    broadcaster.broadcast({ frame: 1 });
    broadcaster.broadcast({ frame: 2 });
    broadcaster.broadcast({ frame: 3 });

    expect(socket.sent).to.have.lengthOf(3);
  });

  it('queues and delivers empty-string payloads in latest mode', function () {
    const broadcaster = new SpectatorBroadcaster({
      frameSkipPolicy: SPECTATOR_SKIP_POLICIES.LATEST
    });
    const socket = new FakeSocket();
    socket.deferCallbacks = true;
    broadcaster.attach(socket);

    broadcaster.broadcast('first');
    broadcaster.broadcast('');

    expect(socket.sent).to.deep.equal(['first']);
    socket.flush();
    expect(socket.sent).to.deep.equal(['first', '']);
  });

  it('deduplicates repeat attachment of the same socket', function () {
    const broadcaster = new SpectatorBroadcaster({
      frameSkipPolicy: SPECTATOR_SKIP_POLICIES.NONE
    });
    const socket = new FakeSocket();
    broadcaster.attach(socket);
    broadcaster.attach(socket);

    broadcaster.broadcast({ frame: 1 });
    expect(socket.sent).to.have.lengthOf(1);
    expect(broadcaster.getSnapshot().connectedClients).to.equal(1);
  });

  it('skips payloads that cannot be serialized to JSON', function () {
    const broadcaster = new SpectatorBroadcaster();
    const socket = new FakeSocket();
    broadcaster.attach(socket);

    expect(() => broadcaster.broadcast({ value: BigInt(1) })).to.not.throw();
    expect(socket.sent).to.have.lengthOf(0);
  });

  it('normalizes spectator stream settings to safe bounds', function () {
    const normalized = normalizeSpectatorStreamConfig({
      frameIntervalMs: 10,
      jpegQuality: 999,
      frameSkipPolicy: 'invalid'
    });
    expect(normalized.frameIntervalMs).to.equal(50);
    expect(normalized.jpegQuality).to.equal(100);
    expect(normalized.frameSkipPolicy).to.equal(SPECTATOR_SKIP_POLICIES.LATEST);
  });

  it('closes and removes all tracked sockets during cleanup', function () {
    const broadcaster = new SpectatorBroadcaster();
    const first = new FakeSocket();
    const second = new FakeSocket();
    broadcaster.attach(first);
    broadcaster.attach(second);
    broadcaster.closeAll();

    expect(first.readyState).to.equal(3);
    expect(second.readyState).to.equal(3);
    expect(broadcaster.getSnapshot().connectedClients).to.equal(0);
  });
});
