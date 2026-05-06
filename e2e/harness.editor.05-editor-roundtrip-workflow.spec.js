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
    );
  });
};

const getEditorState = (page) => page.evaluate(() => window.__E2E__.getState());
const applyEditorOps = (page, ops, options = {}) => page.evaluate(
  ({ ops, options }) => window.__E2E__.editorApply(ops, options),
  { ops, options }
);

const sortByJson = (items) => [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const propNumber = (value) => {
  if (Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const propBoolean = (value) => (
  value === true || value === 1 || value === 'true' || value === '1'
);

const semanticSummary = (level) => ({
  header: {
    TITLE: level.header?.TITLE || '',
    STYLE: level.header?.STYLE || '',
    LEMMINGS: propNumber(level.header?.LEMMINGS),
    SAVE_REQUIREMENT: propNumber(level.header?.SAVE_REQUIREMENT),
    WIDTH: propNumber(level.header?.WIDTH),
    HEIGHT: propNumber(level.header?.HEIGHT)
  },
  terrains: sortByJson((level.terrains || []).map(entry => ({
    PIECE: propNumber(entry.props?.PIECE),
    X: propNumber(entry.props?.X),
    Y: propNumber(entry.props?.Y),
    ONE_WAY: propBoolean(entry.props?.ONE_WAY)
  }))),
  gadgets: sortByJson((level.gadgets || []).map(entry => ({
    PIECE: propNumber(entry.props?.PIECE),
    X: propNumber(entry.props?.X),
    Y: propNumber(entry.props?.Y),
    MIDI_FLAG: propBoolean(entry.props?.MIDI_FLAG),
    MIDI_FLAG_ID: propNumber(entry.props?.MIDI_FLAG_ID),
    MIDI_FLAG_COOLDOWN: propNumber(entry.props?.MIDI_FLAG_COOLDOWN)
  }))),
  steel: sortByJson((level.steel || []).map(entry => ({
    X: propNumber(entry.props?.X),
    Y: propNumber(entry.props?.Y),
    WIDTH: propNumber(entry.props?.WIDTH),
    HEIGHT: propNumber(entry.props?.HEIGHT)
  })))
});

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

test('Editor blank level round-trips semantic state through NXLV', async ({ page }) => {
  const initial = await getEditorState(page);
  const terrainId = initial.editor.assets.terrain[0]?.id;
  const triggerId = initial.editor.assets.triggers[0]?.id;
  const entranceId = initial.editor.assets.entranceId;
  const exitId = initial.editor.assets.exitId;
  expect(Number.isFinite(terrainId)).toBe(true);
  expect(Number.isFinite(triggerId)).toBe(true);
  expect(Number.isFinite(entranceId)).toBe(true);
  expect(Number.isFinite(exitId)).toBe(true);

  const created = await applyEditorOps(page, [
    {
      type: 'level.new',
      args: {
        header: {
          TITLE: 'E2E Round Trip',
          STYLE: 'dirt',
          WIDTH: 640,
          HEIGHT: 160,
          LEMMINGS: 10,
          SAVE_REQUIREMENT: 5
        },
        resetHistory: true
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });
  expect(created.ok).toBe(true);
  const baseGadgetCount = created.state.session.level.gadgets.length;

  const edited = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 64, Y: 96 } } },
    { type: 'entry.update', args: { ref: { kind: 'terrain', index: 0 }, set: { ONE_WAY: true } } },
    { type: 'entry.add', args: { kind: 'steel', props: { X: 80, Y: 120, WIDTH: 24, HEIGHT: 12 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: entranceId, X: 32, Y: 88 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: exitId, X: 560, Y: 88 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: triggerId, X: 192, Y: 96 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: triggerId, X: 256, Y: 96 } } },
    {
      type: 'entry.update',
      args: {
        ref: { kind: 'gadget', index: baseGadgetCount + 3 },
        set: { MIDI_FLAG: true, MIDI_FLAG_ID: 3, MIDI_FLAG_COOLDOWN: 7 }
      }
    },
    { type: 'level.export', args: { format: 'nxlv', filename: 'roundtrip.nxlv' } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(edited.ok).toBe(true);
  expect(edited.state.validation.hasErrors).toBe(false);
  const before = semanticSummary(edited.state.session.level);
  const exported = edited.resources.find(resource => resource.meta?.format === 'nxlv');
  expect(exported?.data).toContain('E2E Round Trip');
  expect(exported?.data).toContain('MIDI_FLAG true');

  const imported = await applyEditorOps(page, [
    {
      type: 'level.loadText',
      args: { text: exported.data, resetHistory: true, sourceLabel: 'Roundtrip Import' }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(imported.ok).toBe(true);
  expect(imported.state.validation.hasErrors).toBe(false);
  expect(semanticSummary(imported.state.session.level)).toEqual(before);
});
