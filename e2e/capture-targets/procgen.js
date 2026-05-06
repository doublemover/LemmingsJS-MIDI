const waitForProcgenReady = async (page) => {
  await page.waitForFunction(() => window.__E2E__?.getState?.()?.ready === true);
};

const stepProcgen = async (page, count = 240) => {
  await page.evaluate((ticks) => {
    window.__E2E__?.pause?.();
    window.__E2E__?.step?.(ticks);
  }, count);
};

const centerOnProcgenFrontier = async (page) => {
  await page.evaluate(() => {
    const state = window.__E2E__?.getState?.();
    const frontier = state?.procgen?.frontier || null;
    if (!Number.isFinite(frontier?.x) || !Number.isFinite(frontier?.y)) return;
    window.__E2E__?.centerStageOn?.({
      x: frontier.x + 80,
      y: frontier.y - 24
    });
  });
};

const centerOnNewestGeneratedPiece = async (page) => {
  await page.evaluate(() => {
    const state = window.__E2E__?.getState?.();
    const pieces = state?.procgen?.recentPieces || [];
    const newest = pieces.length ? pieces[pieces.length - 1] : null;
    const generatedEndX = state?.procgen?.generatedEndX;
    const frontierY = state?.procgen?.frontier?.y;
    const x = Number.isFinite(newest?.x)
      ? newest.x
      : (Number.isFinite(generatedEndX) ? generatedEndX - 120 : null);
    const y = Number.isFinite(newest?.y)
      ? newest.y
      : (Number.isFinite(frontierY) ? frontierY - 24 : 120);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    window.__E2E__?.centerStageOn?.({ x, y });
  });
};

const gameTargets = [
  { name: 'procgen-game', type: 'runtimeRect', id: 'game' },
  { name: 'procgen-canvas-selector', type: 'selector', selector: '#gameCanvas' }
];

const config = {
  name: 'procgen',
  route: '/procgen.html?seed=visual-capture&aiDebug=1',
  async setup(page) {
    await waitForProcgenReady(page);
    await stepProcgen(page, 360);
  },
  states: [
    {
      name: 'overview',
      targets: [
        { name: 'procgen-viewport', type: 'viewport' },
        { name: 'procgen-runtime', type: 'runtimeRects', ids: ['canvas', 'game'] },
        {
          name: 'procgen-ground-band',
          type: 'worldRect',
          rect: { x: 0, y: 120, width: 360, height: 60 },
          padding: 8
        }
      ]
    },
    {
      name: 'frontier',
      async setup(page) {
        await centerOnProcgenFrontier(page);
      },
      targets: gameTargets
    },
    {
      name: 'newest-pieces',
      async setup(page) {
        await centerOnNewestGeneratedPiece(page);
      },
      targets: gameTargets
    }
  ],
  probes: [
    {
      name: 'procgen-canvas',
      selector: '#gameCanvas',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    }
  ]
};

export default config;
