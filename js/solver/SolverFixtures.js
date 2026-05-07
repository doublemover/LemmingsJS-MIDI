const createMask = (width, height) => new Uint8Array(Math.max(0, width * height));

const fillRect = (mask, width, height, rect, value = 1) => {
  if (!mask || !rect) return;
  const x0 = Math.max(0, Math.floor(rect.x ?? 0));
  const y0 = Math.max(0, Math.floor(rect.y ?? 0));
  const x1 = Math.min(width, Math.ceil(x0 + (rect.width ?? 0)));
  const y1 = Math.min(height, Math.ceil(y0 + (rect.height ?? 0)));
  for (let y = y0; y < y1; y += 1) {
    const row = y * width;
    for (let x = x0; x < x1; x += 1) {
      mask[row + x] = value ? 1 : 0;
    }
  }
};

const cloneRects = rects => Array.isArray(rects)
  ? rects.map(rect => ({ ...rect }))
  : [];

const createSyntheticSolverFixture = ({
  id = 'synthetic',
  width = 160,
  height = 80,
  ground = [],
  steel = [],
  oneWay = [],
  hazards = [],
  entrances = [{ x: 8, y: 48 }],
  exits = [{ x: width - 16, y: 48 }],
  lemmings = [{ id: 0, x: 8, y: 48, lookRight: true, action: 'walking' }],
  skills = {},
  timer = { tick: 0, timeLimit: 0 },
  needCount = 1,
  releaseCount = lemmings.length || 1
} = {}) => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const groundMask = createMask(safeWidth, safeHeight);
  const steelMask = createMask(safeWidth, safeHeight);
  for (const rect of ground) fillRect(groundMask, safeWidth, safeHeight, rect, 1);
  for (const rect of steel) fillRect(steelMask, safeWidth, safeHeight, rect, 1);
  return {
    kind: 'synthetic',
    id,
    width: safeWidth,
    height: safeHeight,
    groundMask,
    steelMask,
    oneWay: cloneRects(oneWay),
    hazards: cloneRects(hazards),
    entrances: cloneRects(entrances),
    exits: cloneRects(exits),
    lemmings: Array.isArray(lemmings) ? lemmings.map(lem => ({ ...lem })) : [],
    skills: { ...skills },
    timer: { ...timer },
    needCount: Math.max(0, Math.floor(needCount)),
    releaseCount: Math.max(0, Math.floor(releaseCount))
  };
};

const createFlatWalkFixture = (overrides = {}) => createSyntheticSolverFixture({
  id: 'flat-walk',
  width: 120,
  height: 64,
  ground: [{ x: 0, y: 52, width: 120, height: 4 }],
  entrances: [{ x: 8, y: 51 }],
  exits: [{ x: 104, y: 51 }],
  lemmings: [{ id: 0, x: 8, y: 51, lookRight: true, action: 'walking' }],
  skills: {},
  ...overrides
});

const createSmallGapFixture = (overrides = {}) => createSyntheticSolverFixture({
  id: 'small-gap',
  width: 140,
  height: 72,
  ground: [
    { x: 0, y: 58, width: 48, height: 4 },
    { x: 58, y: 58, width: 82, height: 4 }
  ],
  entrances: [{ x: 12, y: 57 }],
  exits: [{ x: 120, y: 57 }],
  lemmings: [{ id: 0, x: 20, y: 57, lookRight: true, action: 'walking' }],
  skills: { builder: 2 },
  ...overrides
});

const createBarrierFixture = (overrides = {}) => createSyntheticSolverFixture({
  id: 'small-barrier',
  width: 140,
  height: 72,
  ground: [
    { x: 0, y: 58, width: 140, height: 4 },
    { x: 62, y: 48, width: 8, height: 10 }
  ],
  entrances: [{ x: 12, y: 57 }],
  exits: [{ x: 120, y: 57 }],
  lemmings: [{ id: 0, x: 20, y: 57, lookRight: true, action: 'walking' }],
  skills: { basher: 1, digger: 1, miner: 1 },
  ...overrides
});

export {
  createBarrierFixture,
  createFlatWalkFixture,
  createMask,
  createSmallGapFixture,
  createSyntheticSolverFixture,
  fillRect
};
