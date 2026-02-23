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
});
