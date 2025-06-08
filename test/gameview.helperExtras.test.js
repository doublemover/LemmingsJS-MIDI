import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';

// stub GameFactory for GameView constructor
class GameFactoryStub {
  constructor() {}
}

// minimal window/history stubs
function setupEnv() {
  global.window = { location: { search: '' }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  global.history = { replaceState() {} };
  Lemmings.GameFactory = GameFactoryStub;
}

function cleanupEnv() {
  delete global.window;
  delete global.history;
}

describe('GameView helper extras', function () {
  beforeEach(setupEnv);
  afterEach(cleanupEnv);

  it('changeHtmlText updates text and ignores null', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const el = { innerText: 'old' };
    view.changeHtmlText(el, 'new');
    expect(el.innerText).to.equal('new');
    view.changeHtmlText(null, 'ignored');
    expect(el.innerText).to.equal('new');
  });

  it('prefixNumbers prefixes list items', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.prefixNumbers(['A', 'B'])).to.eql(['1 - A', '2 - B']);
  });

  it('strToNum (parseInt version) handles valid and invalid strings', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.strToNum('10')).to.equal(10);
    expect(view.strToNum('2.5')).to.equal(2);
    expect(view.strToNum('foo')).to.equal(0);
  });

  it('clearHtmlList removes all options from select', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const select = { options: [1,2,3], remove(i){ this.options.splice(i,1); } };
    view.clearHtmlList(select);
    expect(select.options).to.have.lengthOf(0);
  });

  it('arrayToSelect creates option elements from array', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const select = { options: [], remove(i){ this.options.splice(i,1); }, appendChild(el){ this.options.push(el); } };
    global.document = { createElement(){ return {}; } };
    view.arrayToSelect(select, ['Alice', 'Bob']);
    expect(select.options).to.have.lengthOf(2);
    expect(select.options[0].textContent).to.equal('Alice');
    expect(select.options[0].value).to.equal('0');
    expect(select.options[1].textContent).to.equal('Bob');
    expect(select.options[1].value).to.equal('1');
    delete global.document;
  });
});
