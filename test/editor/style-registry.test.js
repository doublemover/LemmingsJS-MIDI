import assert from 'assert';
import {
  registerStyle,
  getStyle,
  getStyleByGroundSet,
  getStyleNames,
  getDefaultStyle,
  resolveTerrainId,
  resolveTerrainName,
  resolveGadgetId,
  resolveGadgetName,
  resetStyleRegistry,
  registerClassicStyles
} from '../../js/editor/StyleRegistry.js';

describe('StyleRegistry', function () {
  it('registers styles and resolves pieces', function () {
    resetStyleRegistry();
    assert.throws(() => registerStyle('', {}), /Style name is required/);
    assert.strictEqual(getStyle(null), null);
    assert.strictEqual(getDefaultStyle(), null);
    registerStyle('dirt', {
      groundSet: 0,
      terrainPieces: [
        { id: 1, name: 'Block' },
        { id: null, name: 'Bad' },
        { id: 'foo', name: 'Bad2' },
        { id: 3, name: '' }
      ],
      gadgetPieces: [
        { id: 2, name: 'Exit' },
        { id: null, name: 'Bad' }
      ]
    });

    assert.strictEqual(getStyle('DIRT').groundSet, 0);
    assert.strictEqual(getStyleByGroundSet(0).name, 'dirt');
    assert.strictEqual(getStyleByGroundSet(2), null);
    assert.strictEqual(getStyleByGroundSet('x'), null);
    assert.strictEqual(getDefaultStyle().name, 'dirt');
    assert.deepStrictEqual(getStyleNames(), ['dirt']);

    assert.strictEqual(resolveTerrainId('dirt', 'block'), 1);
    assert.strictEqual(resolveTerrainId('dirt', '1'), 1);
    assert.strictEqual(resolveTerrainId('dirt', 'missing'), null);
    assert.strictEqual(resolveTerrainId('missing', 'block'), null);
    assert.strictEqual(resolveTerrainId('dirt', null), null);

    assert.strictEqual(resolveTerrainName('dirt', 1), 'Block');
    assert.strictEqual(resolveTerrainName('dirt', '1'), 'Block');
    assert.strictEqual(resolveTerrainName('dirt', 99), null);
    assert.strictEqual(resolveTerrainName('dirt', 'oops'), null);
    assert.strictEqual(resolveTerrainName('missing', 1), null);

    assert.strictEqual(resolveGadgetId('dirt', 'exit'), 2);
    assert.strictEqual(resolveGadgetId('dirt', '2'), 2);
    assert.strictEqual(resolveGadgetId('dirt', 'missing'), null);
    assert.strictEqual(resolveGadgetId('dirt', ''), null);
    assert.strictEqual(resolveGadgetId('missing', 'exit'), null);
    assert.strictEqual(resolveGadgetName('dirt', 2), 'Exit');
    assert.strictEqual(resolveGadgetName('dirt', 99), null);
    assert.strictEqual(resolveGadgetName('dirt', 'nope'), null);
    assert.strictEqual(resolveGadgetName('missing', 2), null);
  });

  it('keeps style order stable and supports re-registration', function () {
    resetStyleRegistry();
    registerStyle('dirt', { groundSet: 0 });
    registerStyle('blank', {});
    registerStyle('dirt', { groundSet: 3 });
    assert.deepStrictEqual(getStyleNames(), ['dirt', 'blank']);
    assert.strictEqual(getStyle('dirt').groundSet, 3);
    assert.strictEqual(getStyle('blank').groundSet, 0);
  });

  it('registers classic styles', function () {
    resetStyleRegistry();
    registerClassicStyles();
    const names = getStyleNames();
    assert.ok(names.length >= 1);
    assert.strictEqual(getDefaultStyle().name, names[0]);
  });
});
