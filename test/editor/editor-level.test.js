import assert from 'assert';
import { EditorLevel } from '../../js/editor/EditorLevel.js';

describe('EditorLevel', function () {
  it('normalizes keys and manages headers', function () {
    const level = new EditorLevel();
    assert.strictEqual(EditorLevel.normalizeKey(null), '');

    level.setHeader('title', 'My Level');
    level.setHeader('   ', 'Ignored');
    assert.strictEqual(level.getHeader('TITLE'), 'My Level');
    assert.strictEqual(level.hasHeader('title'), true);
    assert.strictEqual(level.hasHeader('missing'), false);
    assert.strictEqual(level.hasHeader(null), false);
    assert.strictEqual(level.getHeader('missing', 'fallback'), 'fallback');
    assert.strictEqual(level.getHeader(null, 'fallback'), 'fallback');

    level.setHeader('TITLE', 'Updated');
    assert.strictEqual(level.headerOrder.length, 1);
    assert.strictEqual(level.getHeader('TITLE'), 'Updated');

    level.removeHeader('missing');
    level.removeHeader(null);
    level.removeHeader('TITLE');
    assert.strictEqual(level.hasHeader('TITLE'), false);
    assert.strictEqual(level.headerOrder.length, 0);
  });

  it('stores skills with normalized names', function () {
    const level = new EditorLevel();
    level.setSkill('climber', 5);
    level.setSkill(null, 9);
    level.setSkill('   ', 11);
    assert.strictEqual(level.getSkill('CLIMBER'), 5);
    assert.strictEqual(level.getSkill('floater', 0), 0);
    assert.strictEqual(level.getSkill(null, 'fallback'), 'fallback');
  });
});
