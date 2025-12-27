import { expect } from 'chai';
import { EditorSession } from '../../js/editor/EditorSession.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { getDefaultStyle, resetStyleRegistry, registerClassicStyles } from '../../js/editor/StyleRegistry.js';

const SAMPLE_TEXT = [
  'TITLE Sample',
  'STYLE dirt',
  '$SKILLSET',
  '  SKILL CLIMBER 1',
  '$END'
].join('\n');

describe('EditorSession', () => {
  it('creates a blank level with defaults', () => {
    const session = new EditorSession();
    const level = session.createBlank({
      styleName: 'brick',
      width: 1200,
      height: 180,
      title: 'Blank',
      lemmings: 20,
      saveRequirement: 15,
      timeLimit: 60,
      maxSpawnInterval: 30,
      spawnIntervalLocked: true,
      startX: 12,
      startY: 4
    });
    expect(level).to.be.instanceOf(EditorLevel);
    expect(level.getHeader('STYLE')).to.equal('brick');
    expect(level.getHeader('WIDTH')).to.equal(1200);
    expect(level.getHeader('HEIGHT')).to.equal(180);
    expect(level.getHeader('TITLE')).to.equal('Blank');
    expect(level.getHeader('LEMMINGS')).to.equal(20);
    expect(level.getHeader('SAVE_REQUIREMENT')).to.equal(15);
    expect(level.getHeader('TIME_LIMIT')).to.equal(60);
    expect(level.getHeader('MAX_SPAWN_INTERVAL')).to.equal(30);
    expect(level.getHeader('SPAWN_INTERVAL_LOCKED')).to.equal(true);
    expect(level.getHeader('START_X')).to.equal(12);
    expect(level.getHeader('START_Y')).to.equal(4);
    expect(level.skillset.get('CLIMBER')).to.equal(0);
  });

  it('falls back to default blank settings', () => {
    const session = new EditorSession();
    const level = session.createBlank();
    const defaultStyle = getDefaultStyle()?.name || 'dirt';
    expect(level.getHeader('STYLE')).to.equal(defaultStyle);
    expect(level.getHeader('WIDTH')).to.equal(1600);
    expect(level.getHeader('HEIGHT')).to.equal(160);
    expect(level.getHeader('TIME_LIMIT')).to.equal('INFINITE');
    expect(level.getHeader('SPAWN_INTERVAL_LOCKED')).to.equal(false);
  });

  it('falls back to dirt when no styles are registered', () => {
    resetStyleRegistry();
    const session = new EditorSession();
    const level = session.createBlank();
    expect(level.getHeader('STYLE')).to.equal('dirt');
    registerClassicStyles();
  });

  it('parses text and serializes back', () => {
    const session = new EditorSession();
    session.loadFromText(SAMPLE_TEXT);
    expect(session.getTitle()).to.equal('Sample');
    const text = session.toText();
    expect(text).to.include('TITLE Sample');
    expect(text).to.include('STYLE dirt');
  });

  it('returns a default title when no level exists', () => {
    const session = new EditorSession();
    expect(session.getTitle()).to.equal('Untitled');
  });

  it('ensures a level exists for title updates', () => {
    const session = new EditorSession();
    session.setTitle('Hello');
    expect(session.getTitle()).to.equal('Hello');
  });

  it('uses a default title when setTitle receives a blank value', () => {
    const session = new EditorSession();
    session.setTitle('');
    expect(session.getTitle()).to.equal('Untitled');
  });

  it('serializes an empty session safely', () => {
    const session = new EditorSession();
    const text = session.toText();
    expect(text).to.equal('');
  });
});
