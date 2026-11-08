import { expect } from 'chai';
import { placeAnchoredControl } from '../js/app/controls/AnchoredControlPosition.js';
import { normalizeParameterDescriptor } from '../js/app/controls/ParameterDescriptor.js';


const popupFixture = ({ intrinsicHeight = 1400, scale = 1, contentBox = false } = {}) => {
  const style = { maxHeight: '', overflowY: 'visible' }, window = { innerWidth: 1920, innerHeight: 1080,
    getComputedStyle: () => ({ boxSizing: contentBox ? 'content-box' : 'border-box', paddingTop: '12px', paddingBottom: '12px', borderTopWidth: '1px', borderBottomWidth: '1px' }) };
  const extra = contentBox ? 26 : 0;
  const element = { style, offsetWidth: 360, get offsetHeight() { return Math.min(intrinsicHeight, style.maxHeight ? parseFloat(style.maxHeight) + extra : Infinity); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 360 * scale, height: this.offsetHeight * scale }; } };
  return { element, window };
};

describe('desktop anchored control geometry and functional roles', () => {
  it('keeps scaled exact entry inside the desktop viewport and translates back to CSS coordinates', () => {
    const element = { style: {}, offsetWidth: 320, offsetHeight: 180, getBoundingClientRect: () => ({ left: 20, top: 10, width: 640, height: 360 }) };
    const result = placeAnchoredControl({ element, anchor: { getBoundingClientRect: () => ({ left: 1800, top: 960, bottom: 1000 }) }, window: { innerWidth: 1920, innerHeight: 1080 } });
    expect(result).to.deep.equal({ left: 1268, top: 594, width: 640, height: 360, scaleX: 2, scaleY: 2 });
    expect(element.style).to.deep.equal({ left: '624px', top: '292px' });
  });
  it('opens a footer menu above its anchor without polling or changing its dimensions', () => {
    const element = { style: {}, offsetWidth: 360, offsetHeight: 400, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 400 }) };
    const result = placeAnchoredControl({ element, anchor: { getBoundingClientRect: () => ({ left: 32, top: 1030, bottom: 1062 }) }, window: { innerWidth: 1920, innerHeight: 1080 }, preferAbove: true });
    expect(result.top).to.equal(624); expect(result.left).to.equal(32); expect(element.offsetHeight).to.equal(400);
  });

  it('keeps tall header and footer menus clear of the same pointer trigger (#1287)', () => {
    for (const preferAbove of [false, true]) {
      const { element, window } = popupFixture(), anchor = { getBoundingClientRect: () => preferAbove ? { left: 64, top: 1030, bottom: 1062 } : { left: 64, top: 18, bottom: 50 } };
      const result = placeAnchoredControl({ element, anchor, window, preferAbove });
      expect(element.style.overflowY).to.equal('auto');
      if (preferAbove) { expect(result.top).to.equal(12); expect(result.top + result.height).to.equal(1024); }
      else { expect(result.top).to.equal(56); expect(result.top + result.height).to.equal(1068); }
    }
  });
  it('accounts for scaled content-box borders and restores intrinsic size on a larger desktop (#1287)', () => {
    const { element, window } = popupFixture({ intrinsicHeight: 650, scale: 2, contentBox: true }), anchor = { getBoundingClientRect: () => ({ left: 100, top: 20, bottom: 52 }) };
    const first = placeAnchoredControl({ element, anchor, window });
    expect(first.scaleY).to.equal(2); expect(first.top + first.height).to.equal(1068);
    expect(parseFloat(element.style.maxHeight)).to.equal((1068 - 58) / 2 - 26);
    window.innerHeight = 1440;
    const larger = placeAnchoredControl({ element, anchor, window });
    expect(larger.height).to.equal(1300); expect(element.style.maxHeight).to.equal(''); expect(element.style.overflowY).to.equal('visible');
  });
  it('honors a new authored height constraint after a capped opening (#1287)', () => {
    const { element, window } = popupFixture(), anchor = { getBoundingClientRect: () => ({ left: 40, top: 12, bottom: 44 }) };
    placeAnchoredControl({ element, anchor, window }); element.style.maxHeight = '400px';
    const next = placeAnchoredControl({ element, anchor, window });
    expect(next.height).to.equal(400); expect(element.style.maxHeight).to.equal('400px'); expect(element.style.overflowY).to.equal('visible');
  });
  it('uses declared quantities for functional accents and keeps arbitrary macros neutral', () => {
    const descriptor = { id: 'example', name: 'Example', quantity: 'macro', unit: '', min: 0, max: 127, step: 1, defaultValue: 0 };
    expect(normalizeParameterDescriptor({ ...descriptor, quantity: 'lane-gain' }).functionalRole).to.equal('level');
    expect(normalizeParameterDescriptor({ ...descriptor, quantity: 'stereo-position' }).functionalRole).to.equal('space');
    expect(normalizeParameterDescriptor({ ...descriptor, quantity: 'macro' }).functionalRole).to.equal('neutral');
    expect(() => normalizeParameterDescriptor({ ...descriptor, functionalRole: 'lane-purple' })).to.throw();
  });
});
