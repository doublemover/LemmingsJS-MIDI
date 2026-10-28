import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createParameterKnob } from '../js/app/controls/ParameterKnob.js';
import { createWorkstationChrome } from '../js/app/procgen/workstation/WorkstationChrome.js';

const descriptor = { id: 'lane-pan', name: 'Pan', quantity: 'stereo-position', unit: '', min: -127, max: 127, step: 1, defaultValue: 0 };
const setup = () => {
  const dom = new JSDOM('<body><main id="procgenPresentationRoot"><div id="controls"></div><button id="fallback">Selected lane</button></main></body>', { pretendToBeVisual: true }), { window } = dom, { document } = window, commits = []; let identity = {};
  const control = createParameterKnob({ document, window, descriptor, compact: true, value: 0, getIdentity: () => identity, commit: value => commits.push(value), focusFallback: () => document.getElementById('fallback') });
  document.getElementById('controls').append(control.element);
  const toggle = control.element.querySelector('.parameter-entry-toggle'), panel = document.getElementById(toggle.getAttribute('aria-controls')), input = panel.querySelector('input');
  const type = value => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const key = value => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  return { dom, window, document, control, commits, toggle, panel, input, type, key, replace: () => { identity = null; }, close() { control.dispose(); window.close(); } };
};

describe('compact instrument edit ownership', () => {
  it('keeps one original input through fallback portal, invalid draft and two-stage Escape', () => {
    const f = setup(); try {
      f.toggle.click(); expect(f.document.activeElement).to.equal(f.input); expect(f.panel.parentElement.id).to.equal('procgenPresentationRoot');
      f.type('-'); f.key('Enter'); expect(f.input.getAttribute('aria-invalid')).to.equal('true'); expect(f.commits).to.deep.equal([]);
      f.key('Escape'); expect(f.input.value).to.equal('0'); expect(f.panel.hidden).to.equal(false); f.key('Escape'); expect(f.panel.hidden).to.equal(true); expect(f.document.activeElement).to.equal(f.toggle);
      f.toggle.click(); expect(f.panel.querySelector('input')).to.equal(f.input); expect(f.document.querySelectorAll('input')).to.have.length(1);
    } finally { f.close(); }
  });
  it('retains a composing external-edit conflict and explicitly commits the buffered value once', () => {
    const f = setup(); try {
      f.toggle.click(); f.type('-32'); f.input.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true })); f.key('Enter'); expect(f.commits).to.deep.equal([]);
      f.control.setState({ value: 48 }); expect(f.input.value).to.equal('-32'); expect(f.input.dataset.editConflict).to.equal('true');
      f.input.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true })); f.key('Enter'); expect(f.commits).to.deep.equal([]);
      [...f.panel.querySelectorAll('button')].find(button => button.textContent === 'Keep my edit').click(); expect(f.commits).to.deep.equal([-32]); expect(f.control.inspect().authored).to.equal(-32);
    } finally { f.close(); }
  });
  it('never publishes buffered text from blur, change, outside pointer or resize', () => {
    const f = setup(); try {
      f.toggle.click(); f.type('64'); f.input.dispatchEvent(new f.window.Event('change', { bubbles: true })); expect(f.commits).to.deep.equal([]);
      f.document.getElementById('fallback').dispatchEvent(new f.window.MouseEvent('pointerdown', { bubbles: true })); expect(f.panel.hidden).to.equal(true);
      f.toggle.click(); expect(f.input.value).to.equal('64'); f.window.dispatchEvent(new f.window.Event('resize')); expect(f.panel.hidden).to.equal(true); expect(f.commits).to.deep.equal([]);
    } finally { f.close(); }
  });
  it('waits through the native body focus gap so a conflict choice can receive focus and click', async () => {
    const f = setup(); try {
      f.toggle.click(); f.type('-32'); f.control.setState({ value: 48 }); const keep = [...f.panel.querySelectorAll('button')].find(button => button.textContent === 'Keep my edit');
      f.input.blur(); await Promise.resolve(); expect(f.panel.hidden).to.equal(false); keep.focus(); keep.click(); expect(f.commits).to.deep.equal([-32]);
    } finally { f.close(); }
  });
  it('fences retired identity, disposes a focused portal and ignores its detached callbacks', () => {
    const f = setup(); try {
      f.toggle.click(); f.type('64'); f.replace(); f.key('Enter'); expect(f.commits).to.deep.equal([]);
      f.control.dispose(); expect(f.panel.isConnected).to.equal(false); expect(f.document.activeElement.id).to.equal('fallback'); f.key('Enter'); f.toggle.click(); expect(f.commits).to.deep.equal([]);
    } finally { f.close(); }
  });
  it('keeps numeric text nodes stable when actual authored observations change', () => {
    const f = setup(); try { const output = f.control.element.querySelector('output'), text = output.firstChild; f.control.setState({ value: 32 }); expect(output.firstChild).to.equal(text); expect(output.textContent).to.equal('32'); } finally { f.close(); }
  });
});

describe('owned workstation command chrome', () => {
  const mount = () => {
    const dom = new JSDOM('<body><header id="top"><div id="field"><select><option>Source</option></select><input value="draft"></div><section id="health"><details class="studio-operational-details"><summary>Status details</summary><dl><dt>Output</dt><dd>Unknown</dd></dl></details></section></header><footer><button data-command-group="Project">Save As</button></footer><button id="outside">Outside</button></body>'), { window } = dom, { document } = window;
    const options = { document, window, topbar: document.querySelector('header'), footer: document.querySelector('footer'), health: document.querySelector('#health'), setupFields: [document.querySelector('#field')] };
    return { dom, window, document, options };
  };
  it('preserves exact native nodes and listeners through A to B replacement and stale disposal', () => {
    const f = mount(), field = f.document.querySelector('#field'), input = field.querySelector('input'), save = f.document.querySelector('footer button'); let clicks = 0; save.addEventListener('click', () => clicks++);
    const a = createWorkstationChrome(f.options), b = createWorkstationChrome(f.options); try {
      a.dispose(); b.reveal(input); expect(input.closest('details').open).to.equal(true); b.reveal(save); save.click(); expect(clicks).to.equal(1); expect(input.value).to.equal('draft');
      b.dispose(); b.dispose(); expect(field.parentElement).to.equal(f.options.topbar); expect(save.parentElement).to.equal(f.options.footer); expect(f.document.querySelectorAll('.studio-command-menu')).to.have.length(0); expect(f.document.querySelector('.studio-operational-details > dl')).not.to.equal(null);
    } finally { b.dispose(); f.window.close(); }
  });
  it('routes new View and Setup controls into their existing owner and restores original placement', () => {
    const f = mount(), view = f.document.createElement('details'), summary = f.document.createElement('summary'), control = f.document.createElement('input'), setup = f.document.createElement('button');
    summary.textContent = 'View'; view.append(summary); f.options.topbar.append(view); control.dataset.commandGroup = 'View'; setup.dataset.commandGroup = 'Setup'; f.options.footer.append(control, setup);
    const chrome = createWorkstationChrome({ ...f.options, viewMenu: view }); try {
      expect(f.document.querySelectorAll('[data-menu-name=View]')).to.have.length(1); expect(f.document.querySelectorAll('[data-menu-name=Setup]')).to.have.length(1);
      expect(control.closest('details')).to.equal(view); chrome.reveal(control); expect(view.open).to.equal(true); chrome.reveal(setup); expect(setup.closest('details').dataset.menuName).to.equal('Setup'); expect(view.open).to.equal(false);
      chrome.dispose(); expect(control.parentElement).to.equal(f.options.footer); expect(setup.parentElement).to.equal(f.options.footer); expect(view.children).to.have.length(1);
    } finally { chrome.dispose(); f.window.close(); }
  });
  it('lets native selects handle Escape while text entry closes the menu with explicit focus return', () => {
    const f = mount(), chrome = createWorkstationChrome(f.options); try {
      const field = f.document.querySelector('#field'), input = field.querySelector('input'), select = field.querySelector('select'); chrome.reveal(select);
      select.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(select.closest('details').open).to.equal(true);
      input.focus(); input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(input.closest('details').open).to.equal(false); expect(f.document.activeElement.tagName).to.equal('SUMMARY');
    } finally { chrome.dispose(); f.window.close(); }
  });
  it('closes an outside click without consuming the target action and keeps modal background controls reachable', () => {
    const f = mount(), chrome = createWorkstationChrome(f.options); try {
      const field = f.document.querySelector('#field'), outside = f.document.querySelector('#outside'); let clicks = 0; outside.addEventListener('click', () => clicks++); chrome.reveal(field); outside.click(); expect(clicks).to.equal(1); expect(field.closest('details').open).to.equal(false);
      const dialog = f.document.createElement('dialog'); dialog.setAttribute('open', ''); f.document.body.append(dialog); chrome.reveal(field); outside.click(); expect(field.closest('details').open).to.equal(true); expect(clicks).to.equal(2);
    } finally { chrome.dispose(); f.window.close(); }
  });
});
