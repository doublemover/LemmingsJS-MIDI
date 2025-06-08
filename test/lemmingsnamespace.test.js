import { expect } from 'chai';
import path from 'path';
import { pathToFileURL } from 'url';

describe('LemmingsNamespace', function () {
  it('exports the same instance as window.Lemmings', async function () {
    const win = {};
    global.window = win;
    const modUrl = pathToFileURL(path.resolve('js/LemmingsNamespace.js')).href + `?t=${Date.now()}`;
    const { Lemmings } = await import(modUrl);
    expect(window.Lemmings).to.equal(Lemmings);
    delete global.window;
  });
});
