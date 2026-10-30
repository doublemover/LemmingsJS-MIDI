import { expect } from 'chai';
import { parseAutomationCurvePoints, moveAutomationCurvePoint } from '../js/app/controls/AutomationCurveDraft.js';

describe('strict automation curve drafts', () => {
  it('rejects incomplete, duplicate, unordered, out-of-range and oversized text without coercing empty fields to zero', () => {
    for (const text of ['', '0:', ':64', '0:32, 2:', '0:32, 0:64', '2:32, 1:64', '0:128', '0:2.5', '5:64', '-1:64', '0:NaN', '0:Infinity', '0x1:64', '0:0x10', 'x'.repeat(16385), Array.from({ length: 129 }, (_, index) => `${index / 32}:64`).join(',')]) expect(parseAutomationCurvePoints(text, 4), text.slice(0, 32)).to.include({ valid: false });
  });
  it('retains exact finite positions and integer values and prevents a point from crossing its neighbor', () => {
    const parsed = parseAutomationCurvePoints('0:0, 1.23456789:64, 4:127', 4); expect(parsed.valid).to.equal(true); expect(parsed.points[1]).to.deep.equal({ beat: 1.23456789, value: 64 }); expect(Object.isFrozen(parsed.points[1])).to.equal(true);
    expect(moveAutomationCurvePoint(parsed.points, 1, { beat: 0, value: 70 }, 4)).to.equal(null); expect(moveAutomationCurvePoint(parsed.points, 1, { beat: 1.3, value: 70 }, 4, 0.25)[1]).to.deep.equal({ beat: 1.25, value: 70 }); expect(parsed.points[1].value).to.equal(64);
  });
});
