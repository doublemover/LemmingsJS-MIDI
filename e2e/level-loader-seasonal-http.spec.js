import { expect, test } from '@playwright/test';

test('seasonal terrain fallback uses the real HTTP 404 boundary', async ({ page }) => {
  await page.goto('/?e2e=1');
  const result = await page.evaluate(async () => {
    const absent = await fetch('/xmas92/GROUND0O.DAT');
    const [{ FileProvider }, { LevelLoader }, { GameTypes }] = await Promise.all([
      import('/js/data/FileProvider.js'), import('/js/level/LevelLoader.js'), import('/js/game/GameTypes.js')
    ]);
    const provider = new FileProvider('/', { indexedDB: null, localStorage: null });
    const loader = new LevelLoader(provider, { path: 'xmas92', gametype: GameTypes.XMAS92, mechanics: {},
      level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } });
    const level = await loader.getLevel(0, 0);
    const pinned = await new LevelLoader(provider, { path: 'xmas92', gametype: GameTypes.XMAS92, mechanics: {},
      resourcePins: { 'GROUND0O.DAT': { root: 'xmas91', sha256: 'cf20b1b41df38cb00fa013570dd58515391093920f362c8b6983c0d559d8bc90' } },
      level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } }).getLevel(0, 0);
    provider.dispose?.();
    return { status: absent.status, source: level.resourceSources.ground, pinnedSource: pinned.resourceSources.ground, width: level.width,
      groundPixels: level.groundMask.mask.reduce((sum, value) => sum + (value ? 1 : 0), 0),
      steelPixels: level.steelMask.mask.reduce((sum, value) => sum + (value ? 1 : 0), 0) };
  });
  expect(result.status).toBe(404);
  expect(result.source).toEqual({ root: 'xmas91', filename: 'GROUND0O.DAT' });
  expect(result.pinnedSource).toEqual({ root: 'xmas91', filename: 'GROUND0O.DAT',
    sha256: 'cf20b1b41df38cb00fa013570dd58515391093920f362c8b6983c0d559d8bc90' });
  expect(result.width).toBeGreaterThan(0);
  expect(result.groundPixels).toBe(2112);
  expect(result.steelPixels).toBe(0);
});
