import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import { UserInputManager } from '../js/UserInputManager.js';

// basic DOM element stub used for UserInputManager
function createStubElement() {
  return {
    width: 100,
    height: 100,
    addCalls: [],
    removeCalls: [],
    addEventListener(type, handler) { this.addCalls.push([type, handler]); },
    removeEventListener(type, handler) { this.removeCalls.push([type, handler]); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  };
}

describe('UserInputManager.dispose', function() {
  it('clears listeners added via _addListener', function() {
    const element = createStubElement();
    const uim = new UserInputManager(element);

    const initialLen = uim._listeners.length;
    function cb1() {}
    function cb2() {}

    uim._addListener('click', cb1);
    uim._addListener('contextmenu', cb2);

    expect(uim._listeners.length).to.equal(initialLen + 2);
    expect(uim._listeners.slice(-2)).to.eql([
      ['click', cb1],
      ['contextmenu', cb2]
    ]);

    uim.dispose();

    expect(uim._listeners.length).to.equal(0);
    expect(element.removeCalls).to.include.deep.members([
      ['click', cb1],
      ['contextmenu', cb2]
    ]);
    expect(element.removeCalls.length).to.equal(initialLen + 2);
  });
});
