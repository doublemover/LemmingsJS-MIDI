import { expect } from 'chai';
import { placeAnchoredControl } from '../js/app/controls/AnchoredControlPosition.js';
import { normalizeParameterDescriptor } from '../js/app/controls/ParameterDescriptor.js';

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
  it('uses declared quantities for functional accents and keeps arbitrary macros neutral', () => {
    const descriptor = { id: 'example', name: 'Example', quantity: 'macro', unit: '', min: 0, max: 127, step: 1, defaultValue: 0 };
    expect(normalizeParameterDescriptor({ ...descriptor, quantity: 'lane-gain' }).functionalRole).to.equal('level');
    expect(normalizeParameterDescriptor({ ...descriptor, quantity: 'stereo-position' }).functionalRole).to.equal('space');
    expect(normalizeParameterDescriptor({ ...descriptor, quantity: 'macro' }).functionalRole).to.equal('neutral');
    expect(() => normalizeParameterDescriptor({ ...descriptor, functionalRole: 'lane-purple' })).to.throw();
  });
});
