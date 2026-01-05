import { expect } from 'chai';
import {
  formatBindingSpec,
  formatKeyCode
} from '../../js/input/KeybindingFormatter.js';

describe('KeybindingFormatter', function() {
  it('formats key codes with prefixes and labels', function() {
    expect(formatKeyCode('')).to.equal('');
    expect(formatKeyCode(null)).to.equal('');
    expect(formatKeyCode('KeyA')).to.equal('A');
    expect(formatKeyCode('Digit7')).to.equal('7');
    expect(formatKeyCode('ArrowLeft')).to.equal('Left');
    expect(formatKeyCode('Backslash')).to.equal('\\');
    expect(formatKeyCode('F12')).to.equal('F12');
  });

  it('formats binding specs with modifiers and key codes', function() {
    expect(formatBindingSpec(null)).to.equal('');
    expect(formatBindingSpec({})).to.equal('');
    expect(formatBindingSpec({ ctrl: true, alt: true, code: 'KeyZ' }))
      .to.equal('Ctrl+Alt+Z');
    expect(formatBindingSpec({
      ctrl: true,
      alt: true,
      shift: true,
      meta: true,
      code: 'NumpadAdd'
    })).to.equal('Ctrl+Alt+Shift+Meta+Numpad+');
    expect(formatBindingSpec({ shift: true })).to.equal('Shift');
  });
});
