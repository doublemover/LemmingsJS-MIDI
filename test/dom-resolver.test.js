import assert from 'assert';
import { optionalElement, requireElement } from '../js/app/domResolver.js';

describe('domResolver', function () {
  it('returns optional elements when present', function () {
    const node = { id: 'gameCanvas' };
    const doc = {
      getElementById(id) {
        return id === 'gameCanvas' ? node : null;
      }
    };
    assert.strictEqual(optionalElement(doc, 'gameCanvas'), node);
    assert.strictEqual(optionalElement(doc, 'missing'), null);
  });

  it('throws for missing required elements', function () {
    const doc = {
      getElementById() {
        return null;
      }
    };
    assert.throws(
      () => requireElement(doc, 'gameCanvas'),
      /Missing required DOM element: #gameCanvas/
    );
  });

  it('returns required elements when available', function () {
    const node = { id: 'levelIndexSelect' };
    const doc = {
      getElementById() {
        return node;
      }
    };
    assert.strictEqual(requireElement(doc, 'levelIndexSelect'), node);
  });
});
