import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';

const waitForEditorHarness = async (page) => {
  await page.waitForFunction(() => {
    const api = window.__E2E__;
    if (!api?.getState) return false;
    const state = api.getState();
    return Boolean(
      state.editor?.session?.level?.header
      && state.editor?.assets?.terrain?.length
      && state.editor?.assets?.gadgets?.length
    );
  });
};

const getEditorState = (page) => page.evaluate(() => window.__E2E__.getState());
const applyEditorOps = (page, ops, options = {}) => page.evaluate(
  ({ ops, options }) => window.__E2E__.editorApply(ops, options),
  { ops, options }
);

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
    window.prompt = () => 'E2E Save';
    window.alert = () => {};
  });
  await page.goto(`/editor.html?e2e=1&cacheBust=${Date.now()}`);
  await waitForEditorHarness(page);
});

test('Edited level lowers into playtest runtime and returns to editing', async ({ page }) => {
  const initial = await getEditorState(page);
  const terrainId = initial.editor.assets.terrain[0]?.id;
  const gadgetId = initial.editor.assets.gadgets[0]?.id;
  const entranceId = initial.editor.assets.entranceId;
  const exitId = initial.editor.assets.exitId;
  expect(Number.isFinite(terrainId)).toBe(true);
  expect(Number.isFinite(gadgetId)).toBe(true);
  expect(Number.isFinite(entranceId)).toBe(true);
  expect(Number.isFinite(exitId)).toBe(true);

  const edited = await applyEditorOps(page, [
    {
      type: 'level.new',
      args: {
        header: {
          TITLE: 'Playtest Runtime Edit Slice',
          STYLE: 'dirt',
          WIDTH: 640,
          HEIGHT: 320,
          LEMMINGS: 10,
          SAVE_REQUIREMENT: 5,
          START_X: 0,
          START_Y: 0
        },
        resetHistory: true
      }
    },
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 80, Y: 180 } } },
    { type: 'entry.add', args: { kind: 'steel', props: { X: 96, Y: 192, WIDTH: 32, HEIGHT: 16 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: entranceId, X: 64, Y: 128 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: exitId, X: 480, Y: 128 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: gadgetId, X: 192, Y: 96 } } },
    {
      type: 'entry.update',
      args: {
        ref: { kind: 'gadget', index: 2 },
        set: {
          MIDI_FLAG: true,
          MIDI_FLAG_ID: 4,
          MIDI_FLAG_COOLDOWN: 2
        }
      }
    }
  ], {
    history: { record: false },
    preview: { refresh: true, preserveViewport: true },
    validate: { run: true },
    returnState: 'full'
  });
  expect(edited.ok).toBe(true);
  expect(edited.state.editor.validation.hasErrors).toBe(false);

  await page.evaluate(() => window.__E2E__.setEditorPlaytest(true));
  await page.waitForFunction(() => {
    const state = window.__E2E__.getState();
    return state.editor?.playtest === true
      && state.game?.timer?.running === true
      && state.game?.level?.name === 'Playtest Runtime Edit Slice';
  });
  await page.evaluate(() => window.__E2E__.pause());
  await page.waitForFunction(() => {
    const triggers = window.__E2E__.getState().game?.triggers?.entries || [];
    return triggers.some(trigger =>
      trigger.ownerKind === 'midi_flag'
      && trigger.ownerData?.midiFlagId === 4
    );
  });

  const runtime = await getEditorState(page);
  expect(runtime.game.level.entrances.length).toBeGreaterThan(0);
  expect(runtime.game.objects.entries.some(object => object.x === 192 && object.y === 96)).toBe(true);
  expect(runtime.game.steel.entries).toContainEqual({
    x: 96,
    y: 192,
    width: 32,
    height: 16
  });
  expect(runtime.game.triggers.entries.some(trigger =>
    trigger.ownerKind === 'midi_flag'
    && trigger.ownerData?.midiFlagId === 4
  )).toBe(true);

  await page.evaluate(() => window.__E2E__.setEditorPlaytest(false));
  await page.waitForFunction(() => {
    const state = window.__E2E__.getState();
    return state.editor?.playtest === false && state.game?.timer?.running === false;
  });

  const exported = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 128, Y: 184 } } },
    { type: 'level.export', args: { format: 'nxlv', filename: 'playtest-runtime-edit-slice.nxlv' } }
  ], {
    preview: { refresh: true, preserveViewport: true },
    returnState: 'full'
  });

  const resource = exported.resources.find(item => item.meta?.format === 'nxlv');
  expect(exported.ok).toBe(true);
  expect(exported.state.editor.playtest).toBe(false);
  expect(exported.state.editor.session.level.terrains.length).toBe(2);
  expect(resource?.data).toContain('Playtest Runtime Edit Slice');
});
