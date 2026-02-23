import { expect } from 'chai';
import { EventQueue } from '../mcp/eventQueue.js';

describe('EventQueue', function () {
  const createQueue = (maxEvents = 4) => {
    let id = 0;
    let time = 0;
    return new EventQueue({
      maxEvents,
      idFactory() {
        id += 1;
        return `evt-${id}`;
      },
      timeFactory() {
        time += 1;
        return `t-${time}`;
      }
    });
  };

  it('drains events after a cursor and advances lastDelivered', function () {
    const queue = createQueue(8);
    queue.add({ source: 'agent', type: 'a', summary: 'first' });
    queue.add({ source: 'agent', type: 'b', summary: 'second' });

    const firstDrain = queue.drain(undefined);
    expect(firstDrain.cursor).to.equal('2');
    expect(firstDrain.events).to.have.lengthOf(2);
    expect(firstDrain.events[0].type).to.equal('a');
    expect(firstDrain.events[1].type).to.equal('b');
    expect(queue.lastDelivered).to.equal(2);

    const none = queue.drain(undefined);
    expect(none).to.equal(null);
  });

  it('drops oldest entries when capacity is exceeded and drains from available head', function () {
    const queue = createQueue(3);
    queue.add({ source: 'agent', type: 'a' }); // seq 1
    queue.add({ source: 'agent', type: 'b' }); // seq 2
    queue.add({ source: 'agent', type: 'c' }); // seq 3
    queue.add({ source: 'agent', type: 'd' }); // seq 4 (drops seq 1)
    queue.add({ source: 'agent', type: 'e' }); // seq 5 (drops seq 2)

    const drainFromOldCursor = queue.drain('0');
    expect(drainFromOldCursor.cursor).to.equal('5');
    expect(drainFromOldCursor.events.map((event) => event.type)).to.deep.equal(['c', 'd', 'e']);
  });

  it('supports drain without updating the queue cursor', function () {
    const queue = createQueue(4);
    queue.add({ source: 'agent', type: 'a' });
    queue.add({ source: 'agent', type: 'b' });

    const envelope = queue.drain(undefined, { updateCursor: false });
    expect(envelope.cursor).to.equal('2');
    expect(queue.lastDelivered).to.equal(0);

    const second = queue.drain(undefined);
    expect(second.events).to.have.lengthOf(2);
    expect(queue.lastDelivered).to.equal(2);
  });

  it('normalizes fractional cursors before draining', function () {
    const queue = createQueue(4);
    queue.add({ source: 'agent', type: 'a' });
    queue.add({ source: 'agent', type: 'b' });
    queue.add({ source: 'agent', type: 'c' });

    const envelope = queue.drain('1.9');
    expect(envelope.events.map((event) => event.type)).to.deep.equal(['b', 'c']);
    expect(envelope.cursor).to.equal('3');
  });

  it('preserves human summary on peek drains', function () {
    const queue = createQueue(4);
    queue.add({ source: 'human', type: 'input', summary: 'first' });
    queue.add({ source: 'agent', type: 'state', summary: 'sync' });

    const peek = queue.drain(undefined, {
      updateCursor: false,
      includeHumanSummary: true
    });
    expect(peek.humanSummary).to.equal('first');
    expect(queue.lastDelivered).to.equal(0);
    expect(queue.humanSummaryParts.length).to.equal(1);

    const committed = queue.drain(undefined, {
      updateCursor: true,
      includeHumanSummary: true
    });
    expect(committed.humanSummary).to.equal('first');
    expect(queue.humanSummaryParts.length).to.equal(0);
  });

  it('emits and clears human summary only when requested', function () {
    const queue = createQueue(8);
    queue.add({ source: 'human', type: 'input', summary: 'click' });
    queue.add({ source: 'agent', type: 'state', summary: 'agent-update' });
    queue.add({ source: 'human', type: 'input', summary: 'keypress' });

    const noSummary = queue.drain(undefined, { includeHumanSummary: false });
    expect(noSummary.humanSummary).to.equal(undefined);

    const stillNone = queue.drain(noSummary.cursor, { includeHumanSummary: true });
    expect(stillNone).to.equal(null);

    queue.add({ source: 'agent', type: 'state', summary: 'refresh' });
    const withSummary = queue.drain(noSummary.cursor, { includeHumanSummary: true });
    expect(withSummary.humanSummary).to.equal('click; keypress');

    queue.add({ source: 'agent', type: 'state', summary: 'next' });
    const cleared = queue.drain(withSummary.cursor, { includeHumanSummary: true });
    expect(cleared.humanSummary).to.equal(undefined);
  });

  it('captures event payload snapshots instead of live object references', function () {
    const queue = createQueue(4);
    const data = { nested: { count: 1 } };
    const resourceUris = ['res://one'];

    queue.add({ source: 'system', type: 'watch-trigger', data, resourceUris });
    data.nested.count = 99;
    resourceUris.push('res://two');

    const envelope = queue.drain(undefined);
    expect(envelope.events[0].data).to.deep.equal({ nested: { count: 1 } });
    expect(envelope.events[0].resourceUris).to.deep.equal(['res://one']);
  });

  it('normalizes non-string summaries so falsy values are preserved', function () {
    const queue = createQueue(4);
    queue.add({ source: 'human', type: 'input', summary: 0 });
    queue.add({ source: 'human', type: 'input', summary: false });

    const envelope = queue.drain('0', { includeHumanSummary: true });
    expect(envelope.events.map((event) => event.summary)).to.deep.equal(['0', 'false']);
    expect(envelope.humanSummary).to.equal('0; false');
  });

  it('falls back to cycle-safe cloning when structuredClone is unavailable', function () {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
    if (descriptor && descriptor.configurable !== true && descriptor.writable !== true) {
      this.skip();
      return;
    }

    const queue = createQueue(4);
    const data = { nested: { count: 1 } };
    data.self = data;

    const restoreStructuredClone = () => {
      if (descriptor) {
        Object.defineProperty(globalThis, 'structuredClone', descriptor);
      } else {
        delete globalThis.structuredClone;
      }
    };

    try {
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        writable: true,
        value: undefined
      });
      queue.add({ source: 'system', type: 'watch', data });
    } finally {
      restoreStructuredClone();
    }

    data.nested.count = 99;
    const envelope = queue.drain(undefined);
    expect(envelope.events[0].data).to.not.equal(data);
    expect(envelope.events[0].data.nested.count).to.equal(1);
    expect(envelope.events[0].data.self).to.equal(envelope.events[0].data);
  });

  it('bounds human summary history to avoid unbounded growth', function () {
    const queue = createQueue(6);
    queue.maxHumanSummaryParts = 3;
    queue.add({ source: 'human', type: 'input', summary: 'first' });
    queue.add({ source: 'human', type: 'input', summary: 'second' });
    queue.add({ source: 'human', type: 'input', summary: 'third' });
    queue.add({ source: 'human', type: 'input', summary: 'fourth' });
    queue.add({ source: 'human', type: 'input', summary: 'fifth' });

    const envelope = queue.drain('0');
    expect(envelope.humanSummary).to.equal('third; fourth; fifth');
    expect(queue.humanSummaryParts.length).to.equal(0);
  });

  it('normalizes constructor human summary limit and supports explicit option', function () {
    const queue = new EventQueue({
      maxEvents: 4,
      maxHumanSummaryParts: 1,
      idFactory() { return 'evt'; },
      timeFactory() { return 'fixed-time'; }
    });

    expect(queue.maxHumanSummaryParts).to.equal(1);
    queue.add({ source: 'human', type: 'input', summary: 'first' });
    queue.add({ source: 'human', type: 'input', summary: 'second' });

    const envelope = queue.drain('0');
    expect(envelope.events).to.have.lengthOf(2);
    expect(envelope.humanSummary).to.equal('second');
    expect(queue.maxHumanSummaryParts).to.equal(1);
  });

  it('treats non-positive human summary max as disabled', function () {
    const queue = new EventQueue({
      maxEvents: 8,
      maxHumanSummaryParts: 0,
      idFactory() { return 'evt'; },
      timeFactory() { return 'fixed-time'; }
    });

    expect(queue.maxHumanSummaryParts).to.equal(0);
    queue.add({ source: 'human', type: 'input', summary: 'first' });
    queue.add({ source: 'human', type: 'input', summary: 'second' });
    const envelope = queue.drain('0', { includeHumanSummary: true });
    expect(envelope.humanSummary).to.equal(undefined);
  });

  it('defaults summary limit when configured value is invalid', function () {
    const queue = new EventQueue({
      maxEvents: 4,
      maxHumanSummaryParts: -10,
      idFactory() { return 'evt'; },
      timeFactory() { return 'fixed-time'; }
    });
    expect(queue.maxHumanSummaryParts).to.equal(24);
  });

  it('normalizes invalid maxEvents inputs to a usable default capacity', function () {
    const queue = new EventQueue({
      maxEvents: Number.NaN,
      idFactory() { return 'evt'; },
      timeFactory() { return 'fixed-time'; }
    });
    expect(queue.maxEvents).to.equal(1000);

    queue.add({ source: 'agent', type: 'state' });
    const envelope = queue.drain('0');
    expect(envelope.events).to.have.lengthOf(1);
  });

  it('normalizes bigint capacity inputs without throwing', function () {
    const queue = new EventQueue({
      maxEvents: 4n,
      maxHumanSummaryParts: 2n,
      idFactory() { return 'evt'; },
      timeFactory() { return 'fixed-time'; }
    });
    expect(queue.maxEvents).to.equal(4);
    expect(queue.maxHumanSummaryParts).to.equal(2);
    queue.add({ source: 'human', type: 'input', summary: 'a' });
    queue.add({ source: 'human', type: 'input', summary: 'b' });
    queue.add({ source: 'human', type: 'input', summary: 'c' });
    const envelope = queue.drain('0');
    expect(envelope.humanSummary).to.equal('b; c');
  });

  it('caps extremely large maxEvents values to a safe upper bound', function () {
    const queue = new EventQueue({
      maxEvents: 1e9,
      idFactory() { return 'evt'; },
      timeFactory() { return 'fixed-time'; }
    });
    expect(queue.maxEvents).to.equal(10000);
    expect(queue.events.length).to.equal(10000);
  });

  it('caps oversized human summary limits at runtime', function () {
    const queue = createQueue(8);
    queue.maxHumanSummaryParts = 1e9;
    queue.add({ source: 'human', type: 'input', summary: 'a' });
    expect(queue.maxHumanSummaryParts).to.equal(2048);
  });

  it('rebalances buffered human summaries when maxHumanSummaryParts shrinks at runtime', function () {
    const queue = createQueue(8);
    queue.maxHumanSummaryParts = 5;
    queue.add({ source: 'human', type: 'input', summary: 'a' });
    queue.add({ source: 'human', type: 'input', summary: 'b' });
    queue.add({ source: 'human', type: 'input', summary: 'c' });
    queue.add({ source: 'human', type: 'input', summary: 'd' });
    queue.add({ source: 'human', type: 'input', summary: 'e' });

    queue.maxHumanSummaryParts = 2;
    queue.add({ source: 'human', type: 'input', summary: 'f' });

    const envelope = queue.drain('0');
    expect(envelope.humanSummary).to.equal('e; f');
  });

  it('clears buffered human summaries when summary retention is disabled at runtime', function () {
    const queue = createQueue(8);
    queue.maxHumanSummaryParts = 4;
    queue.add({ source: 'human', type: 'input', summary: 'first' });
    queue.add({ source: 'human', type: 'input', summary: 'second' });
    expect(queue.humanSummaryParts.length).to.equal(2);

    queue.maxHumanSummaryParts = 0;
    queue.add({ source: 'human', type: 'input', summary: 'third' });

    const envelope = queue.drain('0', { includeHumanSummary: true });
    expect(envelope.humanSummary).to.equal(undefined);
    expect(queue.humanSummaryParts.length).to.equal(0);
  });

  it('clears buffered human summaries when retention is disabled before non-human events', function () {
    const queue = createQueue(8);
    queue.maxHumanSummaryParts = 4;
    queue.add({ source: 'human', type: 'input', summary: 'first' });
    queue.add({ source: 'human', type: 'input', summary: 'second' });
    expect(queue.humanSummaryParts.length).to.equal(2);

    queue.maxHumanSummaryParts = 0;
    queue.add({ source: 'agent', type: 'state', summary: 'refresh' });

    const envelope = queue.drain('0', { includeHumanSummary: true });
    expect(envelope.humanSummary).to.equal(undefined);
    expect(queue.humanSummaryParts.length).to.equal(0);
  });

  it('rebalances buffered summaries when retention shrinks before non-human events', function () {
    const queue = createQueue(8);
    queue.maxHumanSummaryParts = 5;
    queue.add({ source: 'human', type: 'input', summary: 'a' });
    queue.add({ source: 'human', type: 'input', summary: 'b' });
    queue.add({ source: 'human', type: 'input', summary: 'c' });
    queue.add({ source: 'human', type: 'input', summary: 'd' });
    queue.add({ source: 'human', type: 'input', summary: 'e' });

    queue.maxHumanSummaryParts = 2;
    queue.add({ source: 'agent', type: 'state', summary: 'refresh' });

    const envelope = queue.drain('0', { includeHumanSummary: true });
    expect(envelope.humanSummary).to.equal('d; e');
  });

  it('reorders wrapped summaries correctly when shrinking the runtime summary cap', function () {
    const queue = createQueue(16);
    queue.maxHumanSummaryParts = 5;
    queue.add({ source: 'human', type: 'input', summary: 'a' });
    queue.add({ source: 'human', type: 'input', summary: 'b' });
    queue.add({ source: 'human', type: 'input', summary: 'c' });
    queue.add({ source: 'human', type: 'input', summary: 'd' });
    queue.add({ source: 'human', type: 'input', summary: 'e' });
    queue.add({ source: 'human', type: 'input', summary: 'f' });
    expect(queue.humanSummaryStart).to.equal(1);

    queue.maxHumanSummaryParts = 2;
    queue.add({ source: 'human', type: 'input', summary: 'g' });

    const envelope = queue.drain('0', { includeHumanSummary: true });
    expect(envelope.humanSummary).to.equal('f; g');
  });
});
