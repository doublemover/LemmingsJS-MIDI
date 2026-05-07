import assert from 'assert';
import { NxlvParser, __test__ } from '../../js/editor/NxlvParser.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';

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
      '  # skill comment',
      '  SKILL CLIMBER 5',
      '  SKILL FLOATER INFINITE',
      '  SKILL UNKNOWN 3',
      '  EXTRA something',
      '$END',
      '',
      '$TERRAIN',
      '  # terrain comment',
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
    assert.ok(level.skillsetUnknownLines.some(line => line.includes('# skill comment')));

    assert.strictEqual(level.terrains.length, 1);
    assert.strictEqual(level.terrains[0].props.X, 10);
    assert.strictEqual(level.terrains[0].props.NO_OVERWRITE, true);
    assert.strictEqual(level.terrains[0].props.ERASE, false);
    assert.strictEqual(level.terrains[0].props.ONE_WAY, 'maybe');
    assert.ok(level.terrains[0].unknownLines.some(line => line.includes('# terrain comment')));

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
    assert.ok(level.skillsetUnknownLines.some(line => line.includes('EXTRA something')));
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

  it('parses MIDI flag gadget props with semantic types', function () {
    const text = [
      '$GADGET',
      '  STYLE dirt',
      '  PIECE 3',
      '  X 50',
      '  Y 60',
      '  MIDI_FLAG true',
      '  MIDI_FLAG_ID 7',
      '  MIDI_FLAG_COOLDOWN 12',
      '$END'
    ].join('\n');

    const level = NxlvParser.parse(text);
    assert.strictEqual(level.gadgets[0].props.MIDI_FLAG, true);
    assert.strictEqual(level.gadgets[0].props.MIDI_FLAG_ID, 7);
    assert.strictEqual(level.gadgets[0].props.MIDI_FLAG_COOLDOWN, 12);
  });

  it('initializes skillset unknown lines when missing', function () {
    const original = Object.getOwnPropertyDescriptor(EditorLevel.prototype, 'skillsetUnknownLines');
    let firstAssignment = true;
    Object.defineProperty(EditorLevel.prototype, 'skillsetUnknownLines', {
      configurable: true,
      get() { return this.__skillsetUnknownLines; },
      set(value) {
        if (firstAssignment) {
          this.__skillsetUnknownLines = null;
          firstAssignment = false;
          return;
        }
        this.__skillsetUnknownLines = value;
      }
    });
    try {
      const text = [
        '$SKILLSET',
        '  EXTRA note',
        '$END'
      ].join('\n');
      const level = NxlvParser.parse(text);
      assert.ok(Array.isArray(level.skillsetUnknownLines));
      assert.ok(level.skillsetUnknownLines.some(line => line.includes('EXTRA')));
    } finally {
      if (original) {
        Object.defineProperty(EditorLevel.prototype, 'skillsetUnknownLines', original);
      } else {
        delete EditorLevel.prototype.skillsetUnknownLines;
      }
      delete EditorLevel.prototype.__skillsetUnknownLines;
    }
  });

  it('captures unknown section comments and fallback lines', function () {
    const text = [
      '$UNKNOWN_SECTION',
      '# unknown comment',
      '$END'
    ].join('\n');
    const level = NxlvParser.parse(text);
    assert.strictEqual(level.unknownSections[0].lines[0], '# unknown comment');

    const fallbackLevel = { unknownLines: [] };
    __test__.pushUnknownLine(fallbackLevel, { type: 'TERRAIN', data: {} }, '# fallback');
    assert.ok(fallbackLevel.unknownLines.includes('# fallback'));
  });

  it('handles empty input and stray end markers', function () {
    const emptyLevel = NxlvParser.parse();
    assert.strictEqual(emptyLevel.terrains.length, 0);
    assert.strictEqual(Object.keys(emptyLevel.header).length, 0);

    const level = NxlvParser.parse('$END\nTITLE Foo');
    assert.strictEqual(level.getHeader('TITLE'), 'Foo');
  });
});
