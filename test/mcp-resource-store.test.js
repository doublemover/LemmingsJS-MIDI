import { expect } from 'chai';
import { ResourceStore } from '../mcp/resourceStore.js';

describe('ResourceStore', function () {
  const createStore = () => {
    let id = 0;
    let time = 0;
    return new ResourceStore({
      maxItems: 2,
      idFactory() {
        id += 1;
        return `res-${id}`;
      },
      timeFactory() {
        time += 1;
        return `t-${time}`;
      }
    });
  };

  it('stores, lists, and retrieves resources by URI', function () {
    const store = createStore();
    const first = store.put({
      sessionId: 's1',
      bytes: Buffer.from('alpha'),
      mimeType: 'text/plain'
    });
    const second = store.put({
      sessionId: 's1',
      bytes: Buffer.from('beta'),
      mimeType: 'text/plain'
    });

    const list = store.list();
    expect(list).to.have.lengthOf(2);
    expect(list[0].uri).to.equal(first.uri);
    expect(list[1].uri).to.equal(second.uri);

    const resource = store.get(first.uri);
    expect(resource.uri).to.equal(first.uri);
    expect(resource.bytes.toString('utf8')).to.equal('alpha');
  });

  it('evicts oldest entries when maxItems is exceeded and clears sessions', function () {
    const store = createStore();
    const first = store.put({
      sessionId: 's1',
      bytes: Buffer.from('one'),
      mimeType: 'text/plain'
    });
    store.put({
      sessionId: 's2',
      bytes: Buffer.from('two'),
      mimeType: 'text/plain'
    });
    store.put({
      sessionId: 's2',
      bytes: Buffer.from('three'),
      mimeType: 'text/plain'
    });

    expect(store.get(first.uri)).to.equal(null);

    store.clearSession('s2');
    expect(store.list()).to.have.lengthOf(0);
  });

  it('rejects oversized payloads and enforces URI session matching', function () {
    let id = 0;
    const store = new ResourceStore({
      maxBytes: 4,
      maxItems: 4,
      idFactory() {
        id += 1;
        return `res-${id}`;
      }
    });
    const rejected = store.put({
      sessionId: 's1',
      bytes: Buffer.from('12345'),
      mimeType: 'text/plain'
    });
    expect(rejected).to.equal(null);
    expect(store.list()).to.have.lengthOf(0);

    const accepted = store.put({
      sessionId: 's1',
      bytes: Buffer.from('1234'),
      mimeType: 'text/plain'
    });
    expect(accepted).to.not.equal(null);
    const mismatchedUri = accepted.uri.replace('/sessions/s1/', '/sessions/s2/');
    expect(store.get(mismatchedUri)).to.equal(null);
    expect(store.get(accepted.uri)).to.not.equal(null);
  });

  it('normalizes list limits and constructor capacities', function () {
    const store = new ResourceStore({
      maxBytes: Number.NaN,
      maxItems: Number.NaN,
      ttlMs: -1,
      idFactory() { return 'res'; },
      timeFactory() { return 't-0'; }
    });
    expect(store.maxBytes).to.equal(256 * 1024 * 1024);
    expect(store.maxItems).to.equal(5000);
    expect(store.defaultTtlMs).to.equal(10 * 60 * 1000);

    store.put({
      sessionId: 's1',
      bytes: Buffer.from('x'),
      mimeType: 'text/plain'
    });
    expect(store.list({ limit: 0 })).to.deep.equal([]);
    expect(store.list({ limit: Number.NaN })).to.have.lengthOf(1);
  });

  it('falls back to default capacities when constructor numeric values are non-coercible', function () {
    const store = new ResourceStore({
      maxBytes: Symbol('bytes'),
      maxItems: Symbol('items'),
      ttlMs: Symbol('ttl'),
      idFactory() { return 'res'; },
      timeFactory() { return 't-0'; }
    });
    expect(store.maxBytes).to.equal(256 * 1024 * 1024);
    expect(store.maxItems).to.equal(5000);
    expect(store.defaultTtlMs).to.equal(10 * 60 * 1000);
  });

  it('clones caller buffers and rejects invalid byte payloads', function () {
    const store = createStore();
    const source = Buffer.from('alpha');
    const saved = store.put({
      sessionId: 's1',
      bytes: source,
      mimeType: 'text/plain'
    });
    source[0] = 'z'.charCodeAt(0);
    expect(store.get(saved.uri).bytes.toString('utf8')).to.equal('alpha');

    const invalid = store.put({
      sessionId: 's1',
      bytes: { nope: true },
      mimeType: 'text/plain'
    });
    expect(invalid).to.equal(null);
  });

  it('returns defensive copies for stored bytes and meta payloads', function () {
    const store = createStore();
    const meta = { tag: 'snapshot', nested: { n: 1 } };
    const saved = store.put({
      sessionId: 's1',
      bytes: Buffer.from('alpha'),
      mimeType: 'text/plain',
      meta
    });
    meta.tag = 'mutated';
    meta.nested.n = 99;

    const first = store.get(saved.uri);
    expect(first.meta.tag).to.equal('snapshot');
    expect(first.meta.nested.n).to.equal(1);
    first.bytes[0] = 'z'.charCodeAt(0);
    first.meta.tag = 'local-change';

    const second = store.get(saved.uri);
    expect(second.bytes.toString('utf8')).to.equal('alpha');
    expect(second.meta.tag).to.equal('snapshot');
  });

  it('falls back to cycle-safe meta cloning when structuredClone is unavailable', function () {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
    if (descriptor && descriptor.configurable !== true && descriptor.writable !== true) {
      this.skip();
      return;
    }

    const store = createStore();
    const meta = { tag: 'snapshot', nested: { n: 1 } };
    meta.self = meta;

    const restoreStructuredClone = () => {
      if (descriptor) {
        Object.defineProperty(globalThis, 'structuredClone', descriptor);
      } else {
        delete globalThis.structuredClone;
      }
    };

    let saved = null;
    try {
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        writable: true,
        value: undefined
      });
      saved = store.put({
        sessionId: 's1',
        bytes: Buffer.from('alpha'),
        mimeType: 'text/plain',
        meta
      });
    } finally {
      restoreStructuredClone();
    }

    meta.nested.n = 99;
    const resource = store.get(saved.uri);
    expect(resource.meta).to.not.equal(meta);
    expect(resource.meta.tag).to.equal('snapshot');
    expect(resource.meta.nested.n).to.equal(1);
    expect(resource.meta.self).to.equal(resource.meta);
  });

  it('defaults mime type when omitted', function () {
    const store = createStore();
    const saved = store.put({
      sessionId: 's1',
      bytes: Buffer.from('x')
    });
    const item = store.get(saved.uri);
    expect(item.mimeType).to.equal('application/octet-stream');
  });

  it('expires resources by ttl and updates byte accounting', function () {
    const store = new ResourceStore({
      maxItems: 10,
      maxBytes: 1024,
      ttlMs: 5,
      idFactory() {
        return 'exp-1';
      },
      timeFactory() {
        return 't-exp';
      }
    });
    const originalDateNow = Date.now;
    try {
      Date.now = () => 1000;
      const saved = store.put({
        sessionId: 's1',
        bytes: Buffer.from('abc'),
        mimeType: 'text/plain'
      });
      expect(store.totalBytes).to.equal(3);
      expect(store.get(saved.uri)).to.not.equal(null);
      expect(store.list()).to.have.lengthOf(1);

      Date.now = () => 1006;
      expect(store.get(saved.uri)).to.equal(null);
      expect(store.list()).to.have.lengthOf(0);
      expect(store.totalBytes).to.equal(0);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('generates unique ids when idFactory collisions occur', function () {
    let callCount = 0;
    const store = new ResourceStore({
      maxItems: 10,
      maxBytes: 1024,
      idFactory() {
        callCount += 1;
        return 'dup-id';
      },
      timeFactory() {
        return `t-${callCount}`;
      }
    });

    const first = store.put({
      sessionId: 's1',
      bytes: Buffer.from('abc'),
      mimeType: 'text/plain'
    });
    const second = store.put({
      sessionId: 's1',
      bytes: Buffer.from('z'),
      mimeType: 'text/plain'
    });

    expect(first.uri).to.not.equal(second.uri);
    expect(store.list()).to.have.lengthOf(2);
    expect(store.totalBytes).to.equal(4);
    expect(store.get(first.uri).bytes.toString('utf8')).to.equal('abc');
    expect(store.get(second.uri).bytes.toString('utf8')).to.equal('z');
  });

  it('normalizes unsafe idFactory output before building resource URIs', function () {
    const store = new ResourceStore({
      maxItems: 10,
      maxBytes: 1024,
      idFactory() {
        return 'bad/id ?value';
      },
      timeFactory() {
        return 't-1';
      }
    });

    const saved = store.put({
      sessionId: 's1',
      bytes: Buffer.from('x'),
      mimeType: 'text/plain'
    });

    expect(saved.uri).to.match(/^lemmings:\/\/sessions\/s1\/resources\/badidvalue$/);
    expect(store.get(saved.uri).bytes.toString('utf8')).to.equal('x');
  });

  it('normalizes session ids and rejects blank values', function () {
    const store = createStore();
    const saved = store.put({
      sessionId: '  s1  ',
      bytes: Buffer.from('x'),
      mimeType: 'text/plain'
    });
    expect(saved.uri).to.match(/^lemmings:\/\/sessions\/s1\/resources\//);
    expect(store.get(saved.uri)).to.not.equal(null);

    const rejected = store.put({
      sessionId: '   ',
      bytes: Buffer.from('y'),
      mimeType: 'text/plain'
    });
    expect(rejected).to.equal(null);

    store.put({
      sessionId: 's2',
      bytes: Buffer.from('z'),
      mimeType: 'text/plain'
    });
    store.clearSession('  s1  ');
    expect(store.get(saved.uri)).to.equal(null);
    expect(store.list()).to.have.lengthOf(1);
  });
});
