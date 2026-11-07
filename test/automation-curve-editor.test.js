import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createAutomationCurveEditor } from '../js/app/controls/AutomationCurveEditor.js';

describe('transactional graphical automation editor', () => {
  const curve = () => ({ id: 'cc-1', length: 4, axis: 'beat', mode: 'linear', points: [{ beat: 0, value: 32 }, { beat: 2, value: 100 }, { beat: 4, value: 32 }] });
  it('preserves invalid text and exact DOM identity through external updates, then publishes only an explicitly resolved valid draft', () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document, token = {}, commits = []; let identity = token;
    const editor = createAutomationCurveEditor({ document, window: dom.window, curve: curve(), getIdentity: () => identity, commit: points => { commits.push(points); return true; } }); document.body.append(editor.element); editor.update(curve());
    const exact = editor.element.querySelector('[aria-label="Points"]'), apply = [...editor.element.querySelectorAll('button')].find(button => button.textContent === 'Apply curve'), change = text => { exact.value = text; exact.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
    try { exact.focus(); change('0:32, 2:'); const latest = { ...curve(), points: [{ beat: 0, value: 50 }, { beat: 4, value: 50 }] }; editor.update(latest);
      expect(editor.element.querySelector('[aria-label="Points"]')).to.equal(exact); expect(exact.value).to.equal('0:32, 2:'); expect(apply.disabled).to.equal(true); expect(editor.inspect().conflict).to.equal(true); expect(commits).to.have.length(0);
      [...editor.element.querySelectorAll('button')].find(button => button.textContent === 'Keep my curve draft').click(); expect(exact.value).to.equal('0:32, 2:'); change('0:32, 4:64'); apply.click(); expect(commits).to.have.length(1); expect(commits[0]).to.deep.equal([{ beat: 0, value: 32 }, { beat: 4, value: 64 }]);
      change('0:1, 4:2'); identity = {}; apply.click(); expect(commits).to.have.length(1);
    } finally { editor.dispose(); dom.window.close(); }
  });
  it('keeps partial numeric point text through rerenders and distinguishes draft Escape from a parent close action', () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document, token = {}, commits = [];
    const editor = createAutomationCurveEditor({ document, window: dom.window, curve: curve(), getIdentity: () => token, commit: points => commits.push(points) }); document.body.append(editor.element); editor.update(curve()); let parentEscapes = 0; document.body.addEventListener('keydown', event => { if (event.key === 'Escape') parentEscapes++; });
    try { const position = editor.element.querySelector('[aria-label="Point position"]'); position.focus(); position.value = '-'; position.dispatchEvent(new dom.window.Event('input', { bubbles: true })); position.dispatchEvent(new dom.window.Event('change', { bubbles: true })); editor.update(curve()); expect(position.value).to.equal('-'); expect(editor.inspect().dirty).to.equal(true);
      position.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(parentEscapes).to.equal(0); expect(editor.inspect().dirty).to.equal(false); position.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(parentEscapes).to.equal(1); expect(commits).to.have.length(0);
    } finally { editor.dispose(); dom.window.close(); }
  });
  it('retains an in-progress IME buffer through unrelated updates and detachment without publishing or treating it as an evictable clean editor', () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document, token = {}, commits = [];
    const editor = createAutomationCurveEditor({ document, window: dom.window, curve: curve(), getIdentity: () => token, commit: points => commits.push(points) }); document.body.append(editor.element); editor.update(curve()); const exact = editor.element.querySelector('[aria-label="Points"]');
    try { exact.focus(); exact.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })); exact.value = '0:32, 2:'; exact.dispatchEvent(new dom.window.Event('input', { bubbles: true })); editor.update(curve()); expect(exact.value).to.equal('0:32, 2:'); expect(editor.inspect().dirty).to.equal(true);
      editor.element.remove(); editor.update(curve()); document.body.append(editor.element); editor.update(curve()); expect(exact.value).to.equal('0:32, 2:'); expect(editor.inspect().draftText).to.equal('0:32, 2:'); expect(commits).to.have.length(0);
    } finally { editor.dispose(); dom.window.close(); }
  });
});
