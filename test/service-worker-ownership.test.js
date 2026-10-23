import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../service-worker.js', import.meta.url)), 'utf8');

const fixture = ({ installing = null } = {}) => {
  const listeners = new Map(), deleted = [], claims = [];
  const self = {
    registration: { scope: 'https://example.test/lemmings/', installing, waiting: null },
    location: { origin: 'https://example.test' },
    clients: { async claim() { claims.push(1); } },
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  const caches = {
    async keys() { return ['lemmings-core-%2Flemmings%2F-v0', 'lemmings-core-%2Flemmings%2F-v1',
      'lemmings-runtime-%2Flemmings%2F-v2', 'lemmings-core-%2Fother%2F-v0', 'lemmings-core-v0', 'other-app-recording-cache']; },
    async delete(key) { deleted.push(key); return true; }
  };
  vm.runInNewContext(source, { self, caches, URL, Request, fetch: () => Promise.reject(new Error('unexpected fetch')) });
  const activate = async () => {
    let task;
    listeners.get('activate')({ waitUntil(value) { task = value; } });
    await task;
  };
  return { activate, deleted, claims };
};

describe('service worker cache ownership', () => {
  it('deletes only an older cache of its own scope while keeping newer and sibling caches', async () => {
    const worker = fixture();
    await worker.activate();
    expect(worker.deleted).to.deep.equal(['lemmings-core-%2Flemmings%2F-v0']);
    expect(worker.claims).to.have.length(1);
  });

  it('keeps all caches when a candidate worker is installing', async () => {
    const worker = fixture({ installing: { state: 'installing' } });
    await worker.activate();
    expect(worker.deleted).to.deep.equal([]);
  });
});
