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
});
