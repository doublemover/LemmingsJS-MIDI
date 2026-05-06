import { expect } from 'chai';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { validateLevel } from '../../js/editor/EditorValidator.js';

const createLevel = () => {
  const level = new EditorLevel();
  level.setHeader('TITLE', '');
  level.setHeader('STYLE', 'dirt');
  level.setHeader('WIDTH', 1600);
  level.setHeader('HEIGHT', 160);
  level.setHeader('LEMMINGS', 10);
  level.setHeader('SAVE_REQUIREMENT', 12);
  level.setHeader('TIME_LIMIT', 'INFINITE');
  level.setHeader('MAX_SPAWN_INTERVAL', 50);
  level.setHeader('START_X', 0);
  level.setHeader('START_Y', 0);
  level.terrains = [];
  level.gadgets = [];
  return level;
};

describe('EditorValidator', () => {
  it('returns empty list for null input', () => {
    expect(validateLevel(null)).to.deep.equal([]);
  });

  it('reports header issues and clamps values', () => {
    const level = createLevel();
    level.setHeader('WIDTH', -1);
    level.setHeader('HEIGHT', 0);
    level.setHeader('LEMMINGS', -5);
    level.setHeader('SAVE_REQUIREMENT', -2);
    level.setHeader('TIME_LIMIT', 'bad');
    level.setHeader('MAX_SPAWN_INTERVAL', 'fast');
    level.setHeader('START_X', -10);
    level.setHeader('START_Y', 999);

    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Title'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Width'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Height'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Lemmings'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Save requirement'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Time limit'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Spawn interval'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Start X'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Start Y'))).to.equal(true);

    for (const issue of issues) {
      if (issue.fix) issue.fix();
    }
    expect(level.getHeader('TITLE')).to.equal('Untitled');
    expect(level.getHeader('WIDTH')).to.equal(1600);
    expect(level.getHeader('HEIGHT')).to.equal(160);
    expect(level.getHeader('LEMMINGS')).to.equal(0);
    expect(level.getHeader('SAVE_REQUIREMENT')).to.equal(0);
    expect(level.getHeader('TIME_LIMIT')).to.equal('INFINITE');
    expect(level.getHeader('MAX_SPAWN_INTERVAL')).to.equal(50);
    expect(level.getHeader('START_X')).to.equal(0);
  });

  it('uses fallback numbers when headers are missing', () => {
    const level = createLevel();
    level.removeHeader('WIDTH');
    level.removeHeader('HEIGHT');
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Width'))).to.equal(false);
    expect(issues.some(issue => issue.message.includes('Height'))).to.equal(false);
  });

  it('treats whitespace-only titles as empty', () => {
    const level = createLevel();
    level.setHeader('TITLE', '   ');
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Title'))).to.equal(true);
  });

  it('does not warn when the title is present', () => {
    const level = createLevel();
    level.setHeader('TITLE', 'Valid');
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Title'))).to.equal(false);
  });

  it('detects entrance/exit issues and applies fixes', () => {
    const level = createLevel();
    const assets = { entranceId: 1, exitId: 2 };
    const issues = validateLevel(level, assets);
    const entranceIssue = issues.find(issue => issue.message.includes('entrance') && issue.fix);
    const exitIssue = issues.find(issue => issue.message.includes('exit') && issue.fix);
    expect(entranceIssue).to.exist;
    expect(exitIssue).to.exist;

    entranceIssue.fix();
    exitIssue.fix();
    expect(level.gadgets.some(entry => entry.props.PIECE === 1)).to.equal(true);
    expect(level.gadgets.some(entry => entry.props.PIECE === 2)).to.equal(true);

    for (let i = 0; i < 5; i++) {
      level.gadgets.push({ props: { PIECE: 1 } });
      level.gadgets.push({ props: { PIECE: 2 } });
    }
    const dupIssues = validateLevel(level, assets);
    const fixDupEntrance = dupIssues.find(issue => issue.message.includes('Too many entrances'));
    const fixDupExit = dupIssues.find(issue => issue.message.includes('Too many exits'));
    expect(fixDupEntrance).to.exist;
    expect(fixDupExit).to.exist;
    fixDupEntrance.fix();
    fixDupExit.fix();
    const entranceCount = level.gadgets.filter(entry => entry.props.PIECE === 1).length;
    const exitCount = level.gadgets.filter(entry => entry.props.PIECE === 2).length;
    expect(entranceCount).to.equal(4);
    expect(exitCount).to.equal(4);
  });

  it('warns about unknown entrance/exit ids', () => {
    const level = createLevel();
    level.terrains.push({ props: { X: -5, Y: 200 } });
    level.terrains.push({});
    level.gadgets.push({ props: { X: 9999, Y: -10 } });
    level.gadgets.push({});

    const issues = validateLevel(level, { entranceId: null, exitId: null });
    expect(issues.some(issue => issue.message.includes('Entrance piece'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Exit piece'))).to.equal(true);

    const clampIssue = issues.find(issue => issue.message.includes('Out-of-bounds'));
    expect(clampIssue).to.equal(undefined);
  });

  it('handles out-of-bounds checks when width or height is missing', () => {
    const level = createLevel();
    level.setHeader('WIDTH', -1);
    level.setHeader('HEIGHT', -1);
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Width'))).to.equal(true);
  });

  it('validates steel rectangles', () => {
    const level = createLevel();
    level.steel = [
      { props: { X: -5, Y: 10, WIDTH: 0, HEIGHT: 6 } },
      { props: { X: 1590, Y: 0, WIDTH: 20, HEIGHT: 10 } }
    ];
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    const sizeIssue = issues.find(issue => issue.message.includes('Steel rectangles'));
    const clampIssue = issues.find(issue => issue.message.includes('Steel is out of bounds'));
    expect(sizeIssue).to.exist;
    expect(clampIssue).to.exist;
    sizeIssue.fix();
    clampIssue.fix();
    expect(level.steel[0].props.WIDTH).to.be.at.least(1);
    expect(level.steel[0].props.X).to.equal(0);
  });

  it('skips steel fixes when props are missing', () => {
    const level = createLevel();
    level.steel = [
      {},
      { props: { X: -1, Y: 0, WIDTH: 0, HEIGHT: 0 } },
      { props: { X: 1599, Y: 0, WIDTH: 5, HEIGHT: 5 } }
    ];
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    const sizeIssue = issues.find(issue => issue.message.includes('Steel rectangles'));
    const clampIssue = issues.find(issue => issue.message.includes('Steel is out of bounds'));
    expect(sizeIssue).to.exist;
    expect(clampIssue).to.exist;
    sizeIssue.fix();
    clampIssue.fix();
    expect(level.steel[1].props.WIDTH).to.be.at.least(1);
  });

  it('skips oversized steel fixes when props are removed', () => {
    const level = createLevel();
    const entry = { props: { X: 0, Y: 0, WIDTH: 9999, HEIGHT: 9999 } };
    level.steel = [entry];
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    const oversizeIssue = issues.find(issue => issue.message.includes('Steel sizes exceed the level bounds'));
    expect(oversizeIssue).to.exist;
    delete entry.props;
    oversizeIssue.fix();
    expect(entry.props).to.equal(undefined);
  });

  it('covers steel out-of-bounds branches', () => {
    const scenarios = [
      { X: -1, Y: 0, WIDTH: 1, HEIGHT: 1 },
      { X: 0, Y: -1, WIDTH: 1, HEIGHT: 1 },
      { X: 1599, Y: 0, WIDTH: 2, HEIGHT: 1 },
      { X: 0, Y: 159, WIDTH: 1, HEIGHT: 2 }
    ];

    for (const props of scenarios) {
      const level = createLevel();
      level.steel = [{ props }];
      const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
      const clampIssue = issues.find(issue => issue.message.includes('Steel is out of bounds'));
      expect(clampIssue).to.exist;
    }
  });

  it('flags non-finite height values', () => {
    const level = createLevel();
    level.setHeader('HEIGHT', Number.NaN);
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Height'))).to.equal(true);
  });

  it('snaps invalid rotations and clears non-numeric values', () => {
    const level = createLevel();
    level.terrains.push({ props: { ROTATE: 45 } });
    level.gadgets.push({ props: { ROTATE: 'bad' } });
    level.gadgets.push({ props: { ROTATE: -90 } });
    level.gadgets.push({ props: { ROTATE: 90 } });

    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    const clearIssue = issues.find(issue => issue.message.includes('Rotation values'));
    const snapIssue = issues.find(issue => issue.message.includes('Rotation must be'));
    expect(clearIssue).to.exist;
    expect(snapIssue).to.exist;
    clearIssue.fix();
    snapIssue.fix();

    expect(level.terrains[0].props.ROTATE).to.equal(90);
    expect(level.gadgets[0].props).to.not.have.property('ROTATE');
    expect(level.gadgets[1].props.ROTATE).to.equal(270);
  });

  it('handles null entry lists', () => {
    const level = createLevel();
    level.terrains = null;
    level.gadgets = null;
    level.steel = null;
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Missing entrance'))).to.equal(true);
  });

  it('handles missing terrain group arrays', () => {
    const level = createLevel();
    level.terrainGroups = null;
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(Array.isArray(issues)).to.equal(true);
  });

  it('warns when terrain groups are present', () => {
    const level = createLevel();
    level.terrainGroups = [{ name: 'group-1' }];
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Terrain groups'))).to.equal(true);
  });

  it('strips gadget-only props in terrain groups safely', () => {
    const level = createLevel();
    const entry = { props: { SKILL: 1 } };
    level.terrainGroups = [{ terrains: [entry] }];
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    const gadgetPropsIssue = issues.find(issue => issue.message.includes('Gadget-only properties'));
    expect(gadgetPropsIssue).to.exist;
    delete entry.props;
    gadgetPropsIssue.fix();
    expect(entry.props).to.equal(undefined);
  });

  it('warns about classic caps and unsupported props', () => {
    const level = createLevel();
    level.setHeader('WIDTH', 2000);
    level.setHeader('HEIGHT', 300);
    level.setHeader('LEMMINGS', 1500);
    level.setHeader('SAVE_REQUIREMENT', 2000);
    level.setHeader('MAX_SPAWN_INTERVAL', 0);
    level.setHeader('TIME_LIMIT', 99999);
    level.terrains.push({
      props: { X: 0, Y: 0, ROTATE: 45, FLIP_HORIZONTAL: true, ONE_WAY: true, WIDTH: 4, HEIGHT: 4, SKILL: 1 }
    });
    level.gadgets.push({
      props: { X: 0, Y: 0, ROTATE: 45, FLIP_HORIZONTAL: true, WIDTH: 4, HEIGHT: 4 }
    });
    level.steel = [
      { props: { X: 0, Y: 0, WIDTH: 9999, HEIGHT: 9999, LEMMINGS: 5, PIECE: 1 } }
    ];

    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    expect(issues.some(issue => issue.message.includes('Width exceeds classic preview max'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Height exceeds classic preview max'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Lemmings count exceeds safe max'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Save requirement exceeds safe max'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Spawn interval is out of range'))).to.equal(true);
    expect(issues.some(issue => issue.message.includes('Time limit exceeds classic max'))).to.equal(true);
    const gadgetPropsIssue = issues.find(issue => issue.message.includes('Gadget-only properties'));
    const terrainUnsupportedIssue = issues.find(issue => issue.code === 'classic_unsupported_terrain_props');
    const gadgetUnsupportedIssue = issues.find(issue => issue.code === 'classic_unsupported_gadget_props');
    const steelUnsupportedIssue = issues.find(issue => issue.code === 'classic_unsupported_steel_props');
    const oversizeIssue = issues.find(issue => issue.message.includes('Steel sizes exceed the level bounds'));
    const widthIssue = issues.find(issue => issue.message.includes('Width exceeds classic preview max'));
    const heightIssue = issues.find(issue => issue.message.includes('Height exceeds classic preview max'));
    const lemmingsIssue = issues.find(issue => issue.message.includes('Lemmings count exceeds safe max'));
    const saveReqIssue = issues.find(issue => issue.message.includes('Save requirement exceeds safe max'));
    const spawnIssue = issues.find(issue => issue.message.includes('Spawn interval is out of range'));
    const timeLimitIssue = issues.find(issue => issue.message.includes('Time limit exceeds classic max'));
    expect(gadgetPropsIssue).to.exist;
    expect(terrainUnsupportedIssue).to.exist;
    expect(gadgetUnsupportedIssue).to.exist;
    expect(steelUnsupportedIssue).to.exist;
    expect(terrainUnsupportedIssue.destructive).to.equal(true);
    expect(terrainUnsupportedIssue.props).to.include.members(['FLIP_HORIZONTAL', 'HEIGHT', 'ONE_WAY', 'ROTATE', 'SKILL', 'WIDTH']);
    expect(gadgetUnsupportedIssue.props).to.include.members(['FLIP_HORIZONTAL', 'HEIGHT', 'ROTATE', 'WIDTH']);
    expect(steelUnsupportedIssue.props).to.include('PIECE');
    expect(oversizeIssue).to.exist;
    expect(widthIssue).to.exist;
    expect(heightIssue).to.exist;
    expect(lemmingsIssue).to.exist;
    expect(saveReqIssue).to.exist;
    expect(spawnIssue).to.exist;
    expect(timeLimitIssue).to.exist;

    gadgetPropsIssue.fix();
    terrainUnsupportedIssue.fix();
    gadgetUnsupportedIssue.fix();
    steelUnsupportedIssue.fix();
    oversizeIssue.fix();
    widthIssue.fix();
    heightIssue.fix();
    lemmingsIssue.fix();
    saveReqIssue.fix();
    spawnIssue.fix();
    timeLimitIssue.fix();
    expect(level.terrains[0].props).to.not.have.property('SKILL');
    expect(level.terrains[0].props).to.not.have.property('ROTATE');
    expect(level.terrains[0].props).to.not.have.property('ONE_WAY');
    expect(level.gadgets[0].props).to.not.have.property('ROTATE');
    expect(level.steel[0].props).to.not.have.property('LEMMINGS');
    expect(level.steel[0].props).to.not.have.property('PIECE');
  });

  it('warns and fixes destructive classic export caps', () => {
    const level = createLevel();
    level.setHeader('TITLE', 'This title is definitely longer than thirty two characters');
    level.gadgets = Array.from({ length: 33 }, (_, index) => ({ props: { PIECE: index, X: index, Y: 0 } }));
    level.terrains = Array.from({ length: 401 }, (_, index) => ({ props: { PIECE: index, X: index, Y: 0 } }));
    level.steel = Array.from({ length: 33 }, (_, index) => ({
      props: { X: index, Y: 0, WIDTH: 4, HEIGHT: 4 }
    }));

    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    const titleIssue = issues.find(issue => issue.code === 'classic_title_length');
    const objectIssue = issues.find(issue => issue.code === 'classic_object_count');
    const terrainIssue = issues.find(issue => issue.code === 'classic_terrain_count');
    const steelIssue = issues.find(issue => issue.code === 'classic_steel_count');

    expect(titleIssue).to.include({ destructive: true, target: 'header.TITLE', max: 32 });
    expect(objectIssue).to.include({ destructive: true, target: 'gadgets', max: 32 });
    expect(terrainIssue).to.include({ destructive: true, target: 'terrains', max: 400 });
    expect(steelIssue).to.include({ destructive: true, target: 'steel', max: 32 });

    titleIssue.fix();
    objectIssue.fix();
    terrainIssue.fix();
    steelIssue.fix();

    expect(level.getHeader('TITLE')).to.have.length(32);
    expect(level.gadgets).to.have.length(32);
    expect(level.terrains).to.have.length(400);
    expect(level.steel).to.have.length(32);
  });

  it('clamps negative time limits and invalid start positions', () => {
    const level = createLevel();
    level.setHeader('TIME_LIMIT', -5);
    level.setHeader('START_X', Number.NaN);
    level.setHeader('START_Y', 'bad');
    const issues = validateLevel(level, { entranceId: 1, exitId: 2 });
    const timeIssue = issues.find(issue => issue.message.includes('Time limit cannot be negative'));
    const startXIssue = issues.find(issue => issue.message.includes('Start X is invalid'));
    const startYIssue = issues.find(issue => issue.message.includes('Start Y is invalid'));
    expect(timeIssue).to.exist;
    expect(startXIssue).to.exist;
    expect(startYIssue).to.exist;

    timeIssue.fix();
    startXIssue.fix();
    startYIssue.fix();
    expect(level.getHeader('TIME_LIMIT')).to.equal(0);
    expect(level.getHeader('START_X')).to.equal(0);
    expect(level.getHeader('START_Y')).to.equal(0);
  });
});
