import { expect } from 'chai';
import { EditorSession } from '../../js/editor/EditorSession.js';
import { EditorController } from '../../js/editor/EditorController.js';
import { EditorHistory } from '../../js/editor/EditorHistory.js';
import { EditorTools } from '../../js/editor/EditorTools.js';
import { applyEditorOps } from '../../js/app/e2e/E2EEditorApply.js';
import { validateLevel } from '../../js/editor/EditorValidator.js';

const fixture = () => {
  const session = new EditorSession(); session.createBlank();
  const history = new EditorHistory();
  const controller = new EditorController(session, { history });
  let refreshes = 0, headers = 0, enters = 0;
  const ui = { session, controller, history, assets: null,
    _refreshPreview: async () => { refreshes += 1; }, _refreshHeaderFields: () => { headers += 1; } };
  const view = { editorMode: true, editorSession: session,
    getEditorLevelText: () => session.toText(),
    loadEditorLevelFromText: text => session.loadFromText(text),
    enterEditorMode: () => { enters += 1; } };
  return { session, controller, history, ui, view, counts: () => ({ refreshes, headers, enters }) };
};

describe('editor apply read-only and property contracts', function() {
  it('does not mutate tool, selection, brush, palette, history, identifiers, storage or preview in dry-run', async function() {
    const f = fixture();
    f.session.level.terrains.push({ props: { PIECE: 0, X: 1, Y: 2 }, order: ['PIECE', 'X', 'Y'], unknownLines: [] });
    const before = f.session.toText();
    const tool = f.controller.tool, grid = f.controller.gridSize;
    const operations = [
      { type: 'editor.ensure', args: { enter: true } },
      { type: 'editor.setTool', args: { tool: EditorTools.ERASER } },
      { type: 'editor.setBrushSettings', args: { gridSize: 12, brushSize: 6, snapEnabled: false } },
      { type: 'editor.setPaletteSelection', args: { selectedTerrainId: 3 } },
      { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: 0 }] } },
      { type: 'selection.clear' }, { type: 'history.undo' }, { type: 'history.redo' },
      { type: 'level.save', args: { name: 'must-not-save' } },
      { type: 'level.patchHeader', args: { set: { TITLE: 'must-not-change' } } }
    ];
    const result = await applyEditorOps(f.view, f.ui, operations, { dryRun: true, validate: { autoFix: 'all' }, returnState: 'none' });
    expect(result.ok).to.equal(true);
    expect(result.results.slice(0, operations.length).every(result => result.value?.skipped)).to.equal(true);
    expect(f.session.toText()).to.equal(before);
    expect(f.session.level.terrains[0]).not.to.have.property('uid');
    expect(f.controller.tool).to.equal(tool); expect(f.controller.gridSize).to.equal(grid);
    expect(f.controller.selection).to.deep.equal([]);
    expect(f.counts()).to.deep.equal({ refreshes: 0, headers: 0, enters: 0 });
  });

  it('does not perform a rollback or refresh for an invalid atomic dry-run', async function() {
    const f = fixture(); let loads = 0;
    f.view.loadEditorLevelFromText = () => { loads += 1; };
    const result = await applyEditorOps(f.view, f.ui, [{ type: 'unknown' }], { atomic: true, dryRun: true });
    expect(result.ok).to.equal(false); expect(loads).to.equal(0); expect(f.counts().refreshes).to.equal(0);
  });

  it('retains every supplied terrain/gadget/steel property and normalizes keys', async function() {
    const f = fixture();
    const result = await applyEditorOps(f.view, f.ui, [
      { type: 'entry.add', args: { kind: 'terrain', x: 2, y: 3, piece: 0, props: { flip_horizontal: true, ROTATE: 90, ONE_WAY: true, WIDTH: 20, HEIGHT: 10, ERASE: false } } },
      { type: 'entry.add', args: { kind: 'gadget', piece: 1, props: { x: 4, y: 5, MIDI_FLAG: true, MIDI_FLAG_ID: 7, SKILL: 'CLIMBER', PAIRING: 9 } } },
      { type: 'entry.add', args: { kind: 'steel', props: { x: 8, y: 9, width: 16, height: 4 } } }
    ], { validate: { run: false }, preview: { refresh: false }, returnState: 'none' });
    expect(result.ok).to.equal(true);
    expect(f.session.level.terrains[0].props).to.include({ FLIP_HORIZONTAL: true, ROTATE: 90, ONE_WAY: true, WIDTH: 20, HEIGHT: 10, X: 2, Y: 3 });
    expect(f.session.level.terrains[0].props).not.to.have.property('ERASE');
    expect(f.session.level.gadgets[0].props).to.include({ X: 4, Y: 5, MIDI_FLAG: true, MIDI_FLAG_ID: 7, SKILL: 'CLIMBER', PAIRING: 9 });
    expect(f.session.level.steel[0].props).to.include({ X: 8, Y: 9, WIDTH: 16, HEIGHT: 4 });
    const reloaded = new EditorSession(); reloaded.loadFromText(f.session.toText());
    expect(reloaded.level.terrains[0].props).to.deep.equal(f.session.level.terrains[0].props);
  });

  it('refreshes visible metadata after console/API text load', async function() {
    const f = fixture(), next = new EditorSession(); next.createBlank({ title: 'Fresh title', width: 800 });
    const result = await applyEditorOps(f.view, f.ui, [{ type: 'level.loadText', args: { text: next.toText() } }], { validate: { run: false }, preview: { refresh: false }, returnState: 'none' });
    expect(result.ok).to.equal(true); expect(f.counts().headers).to.equal(1);
    expect(f.ui.session.getTitle()).to.equal('Fresh title');
  });

  it('warns about unsupported runtime transforms without stripping preserved NXLV data', function() {
    const f = fixture(); f.session.level.terrains.push({ props: { PIECE: 0, X: 0, Y: 0, FLIP_HORIZONTAL: true, ROTATE: 90, WIDTH: 5, HEIGHT: 4, ONE_WAY: true }, order: [], unknownLines: [] });
    const before = JSON.stringify(f.session.level.terrains);
    const issues = validateLevel(f.session.level, null, { solverAdvisory: false });
    const warning = issues.find(issue => issue.code === 'runtime_unsupported_transform');
    expect(warning.props).to.include.members(['FLIP_HORIZONTAL', 'ROTATE', 'WIDTH', 'HEIGHT', 'ONE_WAY']);
    expect(warning.fix).to.equal(null); expect(JSON.stringify(f.session.level.terrains)).to.equal(before);
  });
});
