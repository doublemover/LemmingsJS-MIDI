import { expect } from 'chai';
import { loadDeferredWebMidi } from '../js/app/procgen/DeferredWebMidi.js';

const setup = () => {
  const scripts = [], timers = new Set();
  const window = { setTimeout(callback) { timers.add(callback); return callback; }, clearTimeout(callback) { timers.delete(callback); } };
  const document = { createElement() { return { removed: false, remove() { this.removed = true; } }; }, head: { append(script) { scripts.push(script); } } };
  return { window, document, scripts, timers };
};
describe('explicit deferred MIDI library loading', () => {
  it('reuses an installed owner without touching the DOM or requesting permission', async () => {
    const f = setup(); let permissions = 0; f.window.WebMidi = { enable() { permissions++; } };
    expect(await loadDeferredWebMidi(f)).to.equal(f.window.WebMidi); expect(f.scripts).to.have.length(0); expect(permissions).to.equal(0);
  });
  it('shares one pending classic script and cleans its handlers and deadline on success', async () => {
    const f = setup(), first = loadDeferredWebMidi(f), second = loadDeferredWebMidi(f);
    expect(first).to.equal(second); expect(f.scripts).to.have.length(1);
    const script = f.scripts[0]; expect(script.src).to.match(/\/js\/vendor\/webmidi\.js$/); expect(script.async).to.equal(true);
    f.window.WebMidi = { enabled: false }; script.onload(); expect(await first).to.equal(f.window.WebMidi);
    expect(script.removed).to.equal(true); expect(script.onload).to.equal(null); expect(script.onerror).to.equal(null); expect(f.timers.size).to.equal(0);
  });
  it('allows an explicit retry after network failure, timeout or missing initialization', async () => {
    for (const mode of ['network', 'timeout', 'missing']) {
      const f = setup(), first = loadDeferredWebMidi(f), caught = first.catch(error => error);
      if (mode === 'network') f.scripts[0].onerror(); else if (mode === 'timeout') [...f.timers][0](); else f.scripts[0].onload();
      expect(await caught).to.be.instanceOf(Error); expect(f.scripts[0].removed).to.equal(true); expect(f.timers.size).to.equal(0);
      const retry = loadDeferredWebMidi(f); expect(f.scripts).to.have.length(2); f.window.WebMidi = { enabled: false }; f.scripts[1].onload();
      expect(await retry).to.equal(f.window.WebMidi);
    }
  });
  it('isolates pending loads between browser owners and retires an insertion failure', async () => {
    const a = setup(), b = setup(), first = loadDeferredWebMidi(a), second = loadDeferredWebMidi(b);
    expect(first).not.to.equal(second); a.window.WebMidi = {}; b.window.WebMidi = {}; a.scripts[0].onload(); b.scripts[0].onload(); await Promise.all([first, second]);
    const f = setup(); f.document.head.append = () => { throw new Error('CSP refused'); };
    expect(await loadDeferredWebMidi(f).catch(error => error.message)).to.equal('CSP refused'); expect(f.timers.size).to.equal(0);
  });
});
