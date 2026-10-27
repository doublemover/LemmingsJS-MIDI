import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createProcgenOperationalSnapshot } from '../js/app/procgen/workstation/ProcgenOperationalState.js';
import { createProcgenOperationalView } from '../js/app/procgen/workstation/ProcgenOperationalView.js';

describe('owned operational status presentation', () => {
  let dom, document, view, current, calls, statuses;
  beforeEach(() => {
    dom = new JSDOM('<body><div id="original"><button id="procgenListen">Listen locally</button><button id="procgenPanic">Panic</button></div></body>'); document = dom.window.document; calls = []; statuses = [];
    current = createProcgenOperationalSnapshot({ identity: 'one', simulation: { available: true }, transport: { playing: false, clockSource: 'internal' }, output: { enabled: true }, physical: { prepared: true, accepted: 1 }, lanes: [] });
    view = createProcgenOperationalView({ document, readSnapshot: () => current, performAction: (...args) => calls.push(args), onStatus: text => statuses.push(text) }); document.body.append(view.element); view.render(current);
  });
  afterEach(() => { view.dispose(); dom.window.close(); });
  it('borrows existing enable/Panic controls once, keeps live atoms separate and restores their DOM lease', () => {
    expect(document.querySelectorAll('#procgenPanic')).to.have.length(1); expect(view.element.contains(document.getElementById('procgenPanic'))).to.equal(true);
    expect(view.element.textContent).to.include('World running'); expect(view.element.textContent).to.include('Music stopped'); expect(view.element.textContent).to.include('acoustic');
    const listen = document.getElementById('procgenListen'), panic = document.getElementById('procgenPanic'); view.dispose(); view.dispose();
    expect(document.getElementById('original').contains(listen)).to.equal(true); expect(document.getElementById('original').contains(panic)).to.equal(true); expect(listen.getAttribute('aria-describedby')).to.equal(null);
  });
  it('rejects a stale recovery target and executes a current action exactly once', async () => {
    const button = view.element.querySelector('[data-operational-action=play]'); current = { ...current, identity: 'two' }; button.click();
    expect(calls).to.have.length(0); expect(statuses.at(-1)).to.include('state changed'); button.click(); await Promise.resolve(); expect(calls).to.deep.equal([['play', 'two']]);
    view.dispose(); button.click(); expect(calls).to.have.length(1);
  });
  it('retains a critical warning on unavailable refresh and does not create duplicate audio activation controls', () => {
    current = createProcgenOperationalSnapshot({ identity: 'quota', storage: { error: new Error('quota') } }); view.render(current); view.render(null);
    expect(view.element.textContent).to.include('Project save failed'); expect(view.element.textContent).to.include('refresh is unavailable');
    current = createProcgenOperationalSnapshot({ identity: 'off', simulation: { available: true }, output: { enabled: false, selectedBackend: 'synth' } }); view.render(current);
    expect(document.getElementById('procgenListen').textContent).to.equal('Listen locally'); expect(view.element.querySelector('button[data-operational-action=listen]')).to.equal(document.getElementById('procgenListen'));
    expect([...view.element.querySelectorAll('button')].filter(button => !button.hidden && button.textContent === 'Listen locally')).to.have.length(1);
  });
});
