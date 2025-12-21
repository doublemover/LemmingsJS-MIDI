import { expect } from 'chai';
import path from 'path';
import { pathToFileURL } from 'url';

describe('LemmingsNamespace', function () {
  it('exports the registry without creating globals', async function () {
    const win = {};
    global.window = win;
    const modUrl = pathToFileURL(path.resolve('js/LemmingsNamespace.js')).href + `?t=${Date.now()}`;
    const { Lemmings } = await import(modUrl);
    expect(Lemmings).to.be.an('object');
    expect(window.Lemmings).to.equal(undefined);
    delete global.window;
  });
});
