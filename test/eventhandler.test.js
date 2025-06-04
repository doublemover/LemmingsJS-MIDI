import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { EventHandler } from '../js/EventHandler.js';

globalThis.lemmings = Lemmings;

describe('EventHandler', function() {
  it('invokes listeners in order and supports removal', function() {
    const ev = new EventHandler();
    const calls = [];
    const a = (v) => calls.push('a' + v);
    const b = (v) => calls.push('b' + v);
    const c = (v) => calls.push('c' + v);

    ev.on(a);
    ev.on(b);
    ev.on(c);
    ev.trigger(1);
    expect(calls).to.eql(['a1', 'b1', 'c1']);

    ev.off(b);
    calls.length = 0;
    ev.trigger(2);
    expect(calls).to.eql(['a2', 'c2']);
  });
});
