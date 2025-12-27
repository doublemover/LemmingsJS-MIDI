import assert from 'assert';
import { NxlvParser } from '../../js/editor/NxlvParser.js';

describe('NxlvParser', function () {
  it('parses headers, sections, and groups', function () {
    const text = [
      '# comment',
      'TITLE Level One',
      'THEME',
      'STYLE dirt',
      'LEMMINGS 10',
      'SAVE_REQUIREMENT 5',
      'TIME_LIMIT INFINITE',
      'MAX_SPAWN_INTERVAL 99',
      'SPAWN_INTERVAL_LOCKED false',
      'WIDTH 1600',
      'HEIGHT 160',
      'START_X x10',
      'START_Y 0',
      'BACKGROUND sky',
      '',
      '$SKILLSET',
      '  SKILL CLIMBER 5',
      '  SKILL FLOATER INFINITE',
      '  SKILL UNKNOWN 3',
      '  EXTRA something',
      '$END',
      '',
      '$TERRAIN',
      '  STYLE dirt',
      '  PIECE terrain_1',
      '  X 10',
      '  Y 20',
      '  NO_OVERWRITE true',
      '  ERASE 0',
      '  ONE_WAY maybe',
      '$END',
      '',
      '$TERRAINGROUP',
      '  STEEL 1',
      '  $TERRAIN',
      '    STYLE dirt',
      '    PIECE terrain_2',
      '    X 30',
      '    Y 40',
      '  $END',
      '$END',
      '',
      '$STEEL',
      '  X 70',
      '  Y 80',
      '  WIDTH 16',
      '  HEIGHT 12',
      '$END',
      '',
      '$GADGET',
      '  STYLE dirt',
      '  PIECE object_1',
      '  X 50',
      '  Y 60',
      '  WIDTH',
      '  ROTATE ninety',
      '  FLIP_VERTICAL false',
      '$END',
      '',
      '$FOO',
      '  BAR baz',
      '$END'
    ].join('\n');

    const level = NxlvParser.parse(text);

    assert.strictEqual(level.getHeader('TITLE'), 'Level One');
    assert.strictEqual(level.getHeader('THEME'), '');
    assert.strictEqual(level.getHeader('START_X'), 16);
    assert.strictEqual(level.getHeader('SPAWN_INTERVAL_LOCKED'), false);
    assert.strictEqual(level.getHeader('TIME_LIMIT'), 'INFINITE');
    assert.strictEqual(level.getHeader('BACKGROUND'), 'sky');

    assert.strictEqual(level.skillset.get('CLIMBER'), 5);
    assert.strictEqual(level.skillset.get('FLOATER'), 'INFINITE');
    assert.strictEqual(level.skillset.get('UNKNOWN'), 3);

    assert.strictEqual(level.terrains.length, 1);
    assert.strictEqual(level.terrains[0].props.X, 10);
    assert.strictEqual(level.terrains[0].props.NO_OVERWRITE, true);
    assert.strictEqual(level.terrains[0].props.ERASE, false);
    assert.strictEqual(level.terrains[0].props.ONE_WAY, 'maybe');

    assert.strictEqual(level.terrainGroups.length, 1);
    assert.strictEqual(level.terrainGroups[0].props.STEEL, true);
    assert.strictEqual(level.terrainGroups[0].terrains.length, 1);
    assert.strictEqual(level.terrainGroups[0].terrains[0].props.X, 30);

    assert.strictEqual(level.steel.length, 1);
    assert.strictEqual(level.steel[0].props.WIDTH, 16);

    assert.strictEqual(level.gadgets.length, 1);
    assert.strictEqual(level.gadgets[0].props.FLIP_VERTICAL, false);
    assert.strictEqual(level.gadgets[0].props.ROTATE, 'ninety');
    assert.strictEqual(level.gadgets[0].props.WIDTH, '');

    assert.strictEqual(level.unknownSections.length, 1);
    assert.strictEqual(level.unknownSections[0].name, 'FOO');
    assert.ok(level.unknownLines.some(line => line.includes('# comment')));
    assert.ok(level.unknownLines.some(line => line.includes('EXTRA something')));
  });

  it('closes dangling sections at EOF', function () {
    const text = [
      '$TERRAIN',
      '  STYLE dirt',
      '  X 1'
    ].join('\n');

    const level = NxlvParser.parse(text);
    assert.strictEqual(level.terrains.length, 1);
    assert.strictEqual(level.terrains[0].props.X, 1);
  });

  it('handles empty input and stray end markers', function () {
    const emptyLevel = NxlvParser.parse();
    assert.strictEqual(emptyLevel.terrains.length, 0);
    assert.strictEqual(Object.keys(emptyLevel.header).length, 0);

    const level = NxlvParser.parse('$END\nTITLE Foo');
    assert.strictEqual(level.getHeader('TITLE'), 'Foo');
  });
});
