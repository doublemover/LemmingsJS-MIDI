import { expect } from 'chai';
import { attachEvents } from '../mcp/eventEnvelope.js';
import { EventQueue } from '../mcp/eventQueue.js';

const createQueue = () => {
  let id = 0;
  let time = 0;
  return new EventQueue({
    maxEvents: 8,
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

describe('attachEvents', function () {
  it('filters out agent events in minimal mode and preserves summaries', function () {
    const session = {
      eventsMode: 'minimal',
      events: createQueue()
    };
    session.events.add({ source: 'agent', type: 'input', summary: 'action' });
    session.events.add({ source: 'human', type: 'input', summary: 'keypress' });
    const payload = attachEvents(session, { ok: true });

    expect(payload.events.events).to.have.lengthOf(1);
    expect(payload.events.events[0].source).to.equal('human');
    expect(payload.events.humanSummary).to.equal('keypress');
  });

  it('returns payload unchanged when events mode is none', function () {
    const session = {
      eventsMode: 'none',
      events: createQueue()
    };
    session.events.add({ source: 'human', type: 'input', summary: 'click' });
    const payload = { ok: true };
    const result = attachEvents(session, payload);
    expect(result).to.equal(payload);
    expect(result.events).to.equal(undefined);
  });

  it('returns non-object payloads unchanged', function () {
    const session = {
      eventsMode: 'minimal',
      events: createQueue()
    };
    session.events.add({ source: 'human', type: 'input', summary: 'click' });
    const payload = 'ok';
    const result = attachEvents(session, payload);
    expect(result).to.equal(payload);
  });

  it('returns payload unchanged when session has no drainable event queue', function () {
    const session = {
      eventsMode: 'minimal',
      events: null
    };
    const payload = { ok: true };
    const result = attachEvents(session, payload);
    expect(result).to.equal(payload);
    expect(result.events).to.equal(undefined);
  });
});
