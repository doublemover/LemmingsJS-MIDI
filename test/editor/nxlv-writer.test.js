import assert from 'assert';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { NxlvParser } from '../../js/editor/NxlvParser.js';
import { NxlvWriter } from '../../js/editor/NxlvWriter.js';

describe('NxlvWriter', function () {
  it('writes sections and round-trips', function () {
    const level = new EditorLevel();
    level.setHeader('TITLE', 'Test Level');
    level.setHeader('STYLE', 'dirt');
    level.setHeader('THEME', '');
    level.setHeader('BACKGROUND', null);
    level.setHeader('START_X', 0);
    level.setSkill('CLIMBER', 5);
    level.setSkill('CUSTOM', 7);
    level.setSkill('BOMBER', false);
    level.setSkill('FLOATER', null);
    level.setSkill('MINER', undefined);
    level.skillsetUnknownLines.push('# skill note');

    level.terrains.push({
      props: { STYLE: 'dirt', PIECE: 'terrain_1', X: 1, Y: 2 },
      order: ['STYLE', 'PIECE'],
      unknownLines: ['NOTE keep']
    });

    level.terrainGroups.push({
      props: { STEEL: true },
      order: [],
      unknownLines: ['GROUP_NOTE keep'],
      terrains: [{ props: { STYLE: 'dirt', PIECE: 'terrain_2', X: 3, Y: 4 }, order: [] }]
    });

    level.steel.push({
      props: { X: 7, Y: 8, WIDTH: 12, HEIGHT: 6 },
      order: []
    });

    level.gadgets.push({
      props: { STYLE: 'dirt', PIECE: 'object_1', X: 5, Y: 6, FLIP_VERTICAL: true },
      order: []
    });

    level.unknownSections.push({ name: 'EXTRA', lines: ['FOO bar'] });
    level.unknownLines.push('# trailing comment');

    const text = NxlvWriter.write(level);

    assert.ok(text.includes('TITLE Test Level'));
    assert.ok(text.includes('THEME'));
    assert.ok(text.includes('SKILL CUSTOM 7'));
    assert.ok(text.includes('$TERRAINGROUP'));
    assert.ok(text.includes('$STEEL'));
    assert.ok(text.includes('NOTE keep'));
    assert.ok(text.includes('GROUP_NOTE keep'));
    assert.ok(text.includes('# skill note'));

    const parsed = NxlvParser.parse(text);
    assert.strictEqual(parsed.getHeader('TITLE'), 'Test Level');
    assert.strictEqual(parsed.skillset.get('CUSTOM'), 7);
    assert.ok(parsed.skillsetUnknownLines.some(line => line.includes('# skill note')));
    assert.strictEqual(parsed.terrainGroups[0].props.STEEL, true);
    assert.strictEqual(parsed.steel[0].props.WIDTH, 12);
    assert.strictEqual(parsed.gadgets[0].props.FLIP_VERTICAL, true);
  });

  it('semantically round-trips comments and unknown sections', function () {
    const text = [
      '# top note',
      'TITLE Preserve Notes',
      'STYLE dirt',
      '$SKILLSET',
      '  # skill note',
      '  SKILL CLIMBER 1',
      '  TALISMAN legacy',
      '$END',
      '$TERRAIN',
      '  # terrain note',
      '  STYLE dirt',
      '  PIECE terrain_1',
      '  X 10',
      '  Y 20',
      '  CUSTOM_TERRAIN_FIELD keep-me',
      '$END',
      '$NEOLEMMIX_ONLY',
      '  # unknown section note',
      '  CUSTOM value',
      '$END',
      '# trailing note'
    ].join('\n');

    const parsed = NxlvParser.parse(text);
    const written = NxlvWriter.write(parsed);
    const reparsed = NxlvParser.parse(written);

    assert.strictEqual(reparsed.getHeader('TITLE'), 'Preserve Notes');
    assert.ok(reparsed.unknownLines.includes('# top note'));
    assert.ok(reparsed.unknownLines.includes('# trailing note'));
    assert.ok(reparsed.skillsetUnknownLines.some(line => line.includes('# skill note')));
    assert.ok(reparsed.skillsetUnknownLines.some(line => line.includes('TALISMAN legacy')));
    assert.ok(reparsed.terrains[0].unknownLines.some(line => line.includes('# terrain note')));
    assert.strictEqual(reparsed.terrains[0].props.CUSTOM_TERRAIN_FIELD, 'keep-me');
    assert.strictEqual(reparsed.unknownSections.length, 1);
    assert.strictEqual(reparsed.unknownSections[0].name, 'NEOLEMMIX_ONLY');
    assert.ok(reparsed.unknownSections[0].lines.some(line => line.includes('# unknown section note')));
    assert.ok(reparsed.unknownSections[0].lines.some(line => line.includes('CUSTOM value')));
  });

  it('handles missing skillset unknown lines', function () {
    const level = new EditorLevel();
    level.setHeader('TITLE', 'Skillset');
    level.setSkill('CLIMBER', 1);
    level.skillsetUnknownLines = null;
    const text = NxlvWriter.write(level);
    assert.ok(text.includes('$SKILLSET'));
  });

  it('uses default header order when headerOrder is empty', function () {
    const level = new EditorLevel();
    level.header = { STYLE: 'dirt', TITLE: 'Zed' };
    level.headerOrder = [];
    const text = NxlvWriter.write(level);
    const lines = text.split('\n');
    assert.strictEqual(lines[0].startsWith('TITLE'), true);
    assert.ok(lines.includes('STYLE dirt'));
  });

  it('writes header keys not listed in headerOrder', function () {
    const level = new EditorLevel();
    level.header = { TITLE: 'Zed', STYLE: 'dirt', EXTRA: 'value' };
    level.headerOrder = ['TITLE'];
    const text = NxlvWriter.write(level);
    assert.ok(text.includes('TITLE Zed'));
    assert.ok(text.includes('STYLE dirt'));
    assert.ok(text.includes('EXTRA value'));
  });

  it('handles empty group fields and unknown section defaults', function () {
    const level = new EditorLevel();
    level.terrainGroups.push({ props: null, order: null, terrains: null, unknownLines: null });
    level.terrains.push({});
    level.terrains.push(null);
    level.gadgets.push(null);
    level.unknownSections.push({});

    const text = NxlvWriter.write(level);
    assert.ok(text.includes('$TERRAINGROUP'));
    assert.ok(text.includes('$UNKNOWN'));
  });

  it('writes empty level data safely', function () {
    const text = NxlvWriter.write(null);
    assert.strictEqual(text, '');
  });

  it('falls back when header is missing', function () {
    const text = NxlvWriter.write({ header: null });
    assert.strictEqual(text, '');
  });
});
