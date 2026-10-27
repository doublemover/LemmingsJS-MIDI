import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { getProcgenCommandDispatcher } from '../js/app/controls/ProcgenCommandDispatcher.js';
import { createProcgenCommandPalette } from '../js/app/controls/ProcgenCommandPalette.js';
import { getPointerGestureArbiter } from '../js/app/controls/PointerGestureArbiter.js';

const fixture = () => {
  const dom = new JSDOM('<body><button id="opener">Commands</button><canvas id="world" tabindex="0"></canvas><div id="panel" tabindex="0"></div></body>');
  const { document } = dom.window, window = dom.window, registrations = [], palettes = [], calls = [];
  window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  let added = 0, removed = 0, epoch = 1;
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (name, ...args) => { if (name === 'keydown') added++; add(name, ...args); };
  window.removeEventListener = (name, ...args) => { if (name === 'keydown') removed++; remove(name, ...args); };
  const dispatcher = getProcgenCommandDispatcher({ document, window });
  const command = (id, extra = {}) => ({ id, label: id, contexts: ['physical-world'], matches: event => event.code === 'KeyT', execute: () => calls.push(id), ...extra });
  const register = options => { const value = dispatcher.register({ getContext: () => ({ epoch }), isCurrent: context => context.epoch === epoch, ...options }); registrations.push(value); return value; };
  const press = (target = document.getElementById('world'), extra = {}) => { const event = new window.KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, composed: true, cancelable: true, ...extra }); target.dispatchEvent(event); return event; };
  const palette = () => { const value = createProcgenCommandPalette({ document, dispatcher, getScopeLabel: () => 'Selected lane: Lead' }); palettes.push(value); return value; };
  return { document, window, dispatcher, calls, command, register, press, palette,
    get added() { return added; }, get removed() { return removed; }, replace() { epoch++; },
    dispose() { for (const value of palettes) value.dispose(); for (const value of registrations) value.dispose(); dom.window.close(); } };
};

describe('one desktop command owner per composed keyboard event', () => {
  let f; beforeEach(() => { f = fixture(); }); afterEach(() => f.dispose());
  it('installs once and chooses one enabled focused-context action before global aliases', () => {
    f.register({ commands: [f.command('world')] });
    f.register({ priority: 100, accepts: (_event, input) => input.path.some(node => node.id === 'panel'), commands: [f.command('panel'), f.command('duplicate')] });
    expect(f.added).to.equal(1); expect(getProcgenCommandDispatcher(f)).to.equal(f.dispatcher);
    expect(f.press().defaultPrevented).to.equal(true); expect(f.press(f.document.getElementById('panel')).defaultPrevented).to.equal(true);
    expect(f.calls).to.deep.equal(['world', 'panel']); expect(f.dispatcher.inspect()).to.include({ groups: 2, commands: 3, installed: true });
  });
  it('does not fall through a disabled contextual command into a conflicting global action', () => {
    f.register({ commands: [f.command('destructive-global')] });
    f.register({ priority: 100, commands: [f.command('disabled-panel', { enabled: () => false })] });
    expect(f.press().defaultPrevented).to.equal(false); expect(f.calls).to.have.length(0);
  });
  it('keeps modal, composition, dead/process keys and composed shadow text input out of world commands', () => {
    f.register({ commands: [f.command('nuke')] });
    for (const extra of [{ isComposing: true }, { key: 'Dead' }, { key: 'Process' }, { key: 'Compose' }, { key: 'Unidentified' }, { keyCode: 229 }]) expect(f.press(undefined, extra).defaultPrevented).to.equal(false);
    const dialog = f.document.createElement('dialog'); dialog.open = true; f.document.body.append(dialog); f.press(); dialog.remove();
    const host = f.document.createElement('div'), input = f.document.createElement('input'); host.attachShadow({ mode: 'open' }).append(input); f.document.body.append(host);
    f.press(input);
    const closed = f.document.createElement('div'), privateInput = f.document.createElement('input'); closed.setAttribute('role', 'textbox'); closed.attachShadow({ mode: 'closed' }).append(privateInput); f.document.body.append(closed); f.press(privateInput);
    expect(f.calls).to.have.length(0);
  });
  it('preserves native button activation, ranges, radio arrows and ARIA control navigation', () => {
    f.register({ commands: [f.command('global', { matches: () => true })] });
    const button = f.document.getElementById('opener'); expect(f.press(button, { key: ' ', code: 'Space' }).defaultPrevented).to.equal(false);
    for (const role of ['slider', 'separator', 'radio', 'tab', 'combobox']) {
      const target = f.document.createElement('div'); target.setAttribute('role', role); f.document.body.append(target);
      expect(f.press(target, { key: 'ArrowRight', code: 'ArrowRight' }).defaultPrevented).to.equal(false);
    }
    for (const type of ['range', 'radio']) { const input = f.document.createElement('input'); input.type = type; f.document.body.append(input); f.press(input, { key: 'ArrowUp', code: 'ArrowUp' }); }
    expect(f.calls).to.have.length(0);
  });
  it('continues only its owned repeatable key and stops at source changes, blur, composition or release', () => {
    f.register({ commands: [f.command('pan', { repeat: true })] });
    f.press(undefined, { repeat: true }); expect(f.calls).to.have.length(0);
    f.press(); f.press(undefined, { repeat: true }); expect(f.calls).to.have.length(2);
    f.replace(); f.press(undefined, { repeat: true }); f.press(undefined, { repeat: true }); expect(f.calls).to.have.length(2);
    f.press(); f.window.dispatchEvent(new f.window.Event('blur')); f.press(undefined, { repeat: true }); expect(f.calls).to.have.length(3);
    f.press(); f.window.dispatchEvent(new f.window.CompositionEvent('compositionstart')); f.press(undefined, { repeat: true }); expect(f.calls).to.have.length(4);
    f.window.dispatchEvent(new f.window.CompositionEvent('compositionend')); f.press(); f.window.dispatchEvent(new f.window.KeyboardEvent('keyup', { key: 't', code: 'KeyT' })); f.press(undefined, { repeat: true }); expect(f.calls).to.have.length(5);
  });
  it('shares compiled custom bindings and platform labels across command groups', () => {
    f.register({ commands: [f.command('world.zoomIn', { bindingKey: 'zoomIn', bindings: ['KeyZ'] })] });
    f.register({ priority: 100, commands: [f.command('pattern.nextStep', { bindings: ['ArrowRight'] })] });
    expect(f.dispatcher.getShortcut('world.zoomIn')).to.equal('Z');
    f.dispatcher.setBindings({ bindings: { zoomIn: ['KeyG'], 'pattern.nextStep': ['Ctrl+KeyL', 'Meta+KeyL'] } });
    f.press(undefined, { key: 'z', code: 'KeyZ' }); f.press(undefined, { key: 'g', code: 'KeyG' });
    f.press(undefined, { key: 'l', code: 'KeyL', ctrlKey: true });
    expect(f.calls).to.deep.equal(['world.zoomIn', 'pattern.nextStep']);
    expect(f.dispatcher.getShortcut('world.zoomIn')).to.equal('G'); expect(f.dispatcher.getShortcut('pattern.nextStep')).to.equal('Ctrl+L');
    Object.defineProperty(f.window.navigator, 'platform', { value: 'MacIntel', configurable: true });
    expect(f.dispatcher.getShortcut('pattern.nextStep')).to.equal('Cmd+L');
    f.press(undefined, { key: 'l', code: 'KeyL', metaKey: true }); expect(f.calls).to.have.length(3);
  });
  it('keeps pending hints neutral and invalidates held keys and borrowed entries on configuration change', () => {
    f.register({ commands: [f.command('pan', { bindings: ['KeyT'], repeat: true })] });
    const stale = f.dispatcher.list()[0]; f.press(); f.dispatcher.setBindingsPending();
    expect(f.dispatcher.getShortcut('pan')).to.equal(''); expect(stale.run().status).to.equal('stale');
    f.press(); f.press(undefined, { repeat: true }); expect(f.calls).to.have.length(1);
    f.dispatcher.setBindings({ bindings: { pan: ['KeyG'] } }); f.press(undefined, { key: 'g', code: 'KeyG', repeat: true });
    expect(f.calls).to.have.length(1); f.press(undefined, { key: 'g', code: 'KeyG' }); expect(f.calls).to.have.length(2);
  });
  it('owns immutable bounded configuration and publishes only admitted profiles', () => {
    f.register({ commands: [f.command('pan', { bindings: ['KeyT'] })] }); let notices = 0;
    const unwatch = f.dispatcher.watchBindings(() => notices++), config = { bindings: { pan: ['KeyG'] } };
    f.dispatcher.setBindings(config); config.bindings.pan[0] = 'KeyH'; expect(f.dispatcher.getShortcut('pan')).to.equal('G');
    const revision = f.dispatcher.bindingState().revision;
    for (const bindings of [{ pan: Array(17).fill('KeyG') }, { pan: ['a'.repeat(129)] }, Object.fromEntries(Array.from({ length: 513 }, (_, i) => ['key' + i, []])), JSON.parse('{"__proto__":["KeyG"]}')]) {
      expect(() => f.dispatcher.setBindings({ bindings })).to.throw(TypeError); expect(f.dispatcher.bindingState().revision).to.equal(revision);
    }
    expect(notices).to.equal(1); unwatch(); f.dispatcher.setBindings(null); expect(notices).to.equal(1);
    expect(() => f.register({ commands: [f.command('pan')] })).to.throw(TypeError);
  });
  it('tracks an entire composition session even when its local owner stops propagation and resets on blur', () => {
    f.register({ commands: [f.command('nuke', { bindings: ['KeyT'] })] }); const input = f.document.createElement('input'); f.document.body.append(input);
    input.addEventListener('compositionstart', event => event.stopPropagation());
    input.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true })); f.press();
    input.dispatchEvent(new f.window.CompositionEvent('compositionupdate', { bubbles: true, data: 't' })); f.press(); expect(f.calls).to.have.length(0);
    input.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true })); f.press(); expect(f.calls).to.have.length(1);
    input.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true })); f.window.dispatchEvent(new f.window.Event('blur'));
    f.press(); expect(f.calls).to.have.length(2);
  });
  it('keeps explicitly configured emergency output separate from modal and captured world edits', () => {
    f.register({ commands: [f.command('world.nuke', { bindings: ['F8'] })] });
    f.register({ priority: 200, commands: [f.command('output.panic', { bindings: [], emergency: true })] });
    f.dispatcher.setBindings({ bindings: { 'output.panic': ['F8'] } });
    const dialog = f.document.createElement('dialog'), input = f.document.createElement('input'); dialog.open = true; dialog.append(input); f.document.body.append(dialog);
    const press = extra => f.press(input, { key: 'F8', code: 'F8', ...extra });
    press(); press({ repeat: true }); press({ isComposing: true });
    expect(f.calls).to.deep.equal(['output.panic']);
    input.addEventListener('keydown', event => event.preventDefault(), { once: true }); press(); expect(f.calls).to.have.length(1);
    f.window.dispatchEvent(new f.window.CompositionEvent('compositionstart')); press(); expect(f.calls).to.have.length(1);
    f.window.dispatchEvent(new f.window.CompositionEvent('compositionend')); dialog.remove();
    const owner = {}, arbiter = getPointerGestureArbiter(f.document); let cancelled = 0;
    arbiter.acquire({ targetKey: 'draft', identity: owner, getIdentity: () => owner, onCancel: () => cancelled++ });
    f.press(undefined, { key: 'F8', code: 'F8' }); expect(f.calls.at(-1)).to.equal('output.panic'); expect(cancelled).to.equal(0); expect(arbiter.inspect()).to.exist;
    arbiter.cancel('test-cleanup');
  });
  it('advances its own repeated selection while rejecting a later unrelated selection change', () => {
    let step = 0;
    f.register({ getContext: () => ({ step }), isCurrent: context => context.step === step,
      commands: [f.command('next-step', { repeat: true, execute: () => { step++; } })] });
    f.press(); f.press(undefined, { repeat: true }); f.press(undefined, { repeat: true }); expect(step).to.equal(3);
    step = 9; f.press(undefined, { repeat: true }); expect(step).to.equal(9);
  });
  it('ignores held destructive commands and keeps held-key storage bounded', () => {
    f.register({ commands: [f.command('nuke', { matches: () => true })] }); f.press(); f.press(undefined, { repeat: true }); expect(f.calls).to.deep.equal(['nuke']);
    for (let index = 0; index < 40; index++) f.press(undefined, { code: 'Fixture' + index }); expect(f.dispatcher.inspect().heldKeys).to.equal(16);
  });
  it('lets Escape cancel one captured gesture and rejects commands borrowed before that gesture', () => {
    f.register({ commands: [f.command('nuke')] }); const entry = f.dispatcher.list()[0], owner = {}, cancelled = [];
    getPointerGestureArbiter(f.document).acquire({ targetKey: 'knob', identity: owner, getIdentity: () => owner, onCancel: reason => cancelled.push(reason) });
    f.press(); expect(entry.run().status).to.equal('captured-gesture'); expect(entry.canRun()).to.equal(false);
    expect(f.press(undefined, { key: 'Escape', code: 'Escape' }).defaultPrevented).to.equal(true); expect(cancelled).to.deep.equal(['escape']); expect(f.calls).to.have.length(0);
    f.press(); expect(f.calls).to.deep.equal(['nuke']);
  });
  it('allows an explicit tool transition only after cancellation and preserves its captured source', () => {
    const order = [], owner = {}; f.register({ commands: [f.command('arm', { cancelGesture: true, execute: () => order.push('arm') })] });
    const arbiter = getPointerGestureArbiter(f.document);
    arbiter.acquire({ targetKey: 'draw', identity: owner, getIdentity: () => owner, onCancel: () => order.push('cancel') });
    f.press(); expect(order).to.deep.equal(['cancel', 'arm']);
    arbiter.acquire({ targetKey: 'draw', identity: owner, getIdentity: () => owner, onCancel: () => { order.push('replaced'); f.replace(); } });
    f.press(); expect(order).to.deep.equal(['cancel', 'arm', 'replaced']);
  });
  it('fences late catalog entries and retires the shared listener only with its last group', () => {
    const first = f.register({ commands: [f.command('world')] }), second = f.register({ commands: [f.command('other')] }), entry = f.dispatcher.list()[0];
    f.replace(); expect(entry.run().status).to.equal('stale'); expect(f.calls).to.have.length(0);
    first.dispose(); expect(f.removed).to.equal(0); expect(entry.run().status).to.equal('stale'); second.dispose();
    expect(f.removed).to.equal(1); expect(f.dispatcher.inspect()).to.include({ groups: 0, commands: 0, installed: false, heldKeys: 0 });
    f.register({ commands: [f.command('fresh')] }); expect(f.added).to.equal(2); f.press(); expect(f.calls).to.deep.equal(['fresh']);
  });
  it('does not retain a key after its command disposes the registration', () => {
    let registration; registration = f.register({ commands: [f.command('close', { execute: () => registration.dispose() })] }); f.press();
    expect(f.dispatcher.inspect()).to.include({ installed: false, heldKeys: 0 });
  });
  it('contains command failure after consuming one event and rejects oversized registrations', () => {
    const errors = []; f.register({ commands: [f.command('broken', { execute: () => { throw new Error('owned command failed'); } })], onError: error => errors.push(error.message) });
    expect(f.press().defaultPrevented).to.equal(true); expect(errors).to.deep.equal(['owned command failed']);
    expect(() => f.register({ commands: [f.command('same'), f.command('same')] })).to.throw(TypeError);
    expect(() => f.register({ commands: Array.from({ length: 65 }, (_, index) => f.command('too-many-' + index)) })).to.throw(TypeError);
  });
});

describe('source-bound desktop command search and shortcut reference', () => {
  let f; beforeEach(() => { f = fixture(); f.document.getElementById('opener').focus(); }); afterEach(() => f.dispose());
  it('renders a bounded list, retains disabled actions and executes a searched command once', () => {
    f.register({ commands: Array.from({ length: 60 }, (_, index) => f.command('Action ' + index, { shortcut: 'Ctrl+' + index, enabled: () => index !== 5 })) });
    const palette = f.palette(); expect(palette.open()).to.equal(true); const dialog = f.document.querySelector('dialog'); expect(dialog.querySelectorAll('[data-command-id]')).to.have.length(48);
    expect(dialog.querySelector('[data-command-id="Action 5"]').disabled).to.equal(true); expect(dialog.textContent).to.include('Showing 48 of 60');
    const input = dialog.querySelector('input'); f.press(input, { key: 'Enter', code: 'Enter' }); expect(f.calls).to.have.length(0);
    input.value = 'Action 12'; input.dispatchEvent(new f.window.Event('input')); const old = dialog.querySelector('[data-command-id="Action 12"]');
    f.press(input, { key: 'Enter', code: 'Enter' }); old.click(); expect(f.calls).to.deep.equal(['Action 12']); expect(f.document.querySelector('dialog')).to.equal(null);
    expect(f.document.activeElement.id).to.equal('opener');
  });
  it('rejects stale selected targets while preserving search and keeping the explicit next action', () => {
    f.register({ commands: [f.command('Apply source')] }); const palette = f.palette(); palette.open(); const dialog = f.document.querySelector('dialog'), input = dialog.querySelector('input');
    input.value = 'Apply'; input.dispatchEvent(new f.window.Event('input')); f.replace(); dialog.querySelector('[data-command-id]').click();
    expect(f.calls).to.have.length(0); expect(dialog.textContent).to.include('Close and reopen Commands'); expect(input.value).to.equal('Apply');
    palette.suspend(); expect(f.document.activeElement.id).to.equal('opener');
  });
  it('does not activate detached controls after close, reopen or disposal', () => {
    f.register({ commands: [f.command('Save')] }); const palette = f.palette(); palette.open(); const old = f.document.querySelector('[data-command-id]');
    f.document.querySelector('dialog').dispatchEvent(new f.window.Event('cancel', { cancelable: true })); palette.open(); old.click(); expect(f.calls).to.have.length(0);
    const current = f.document.querySelector('[data-command-id]'); palette.dispose(); current.click(); expect(f.calls).to.have.length(0); expect(palette.open()).to.equal(false);
  });
});
