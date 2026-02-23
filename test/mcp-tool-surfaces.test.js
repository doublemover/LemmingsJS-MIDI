import { expect } from 'chai';
import {
  buildEditorToolHandlers,
  buildEditorToolSpecs
} from '../mcp/tools/editor.js';
import { buildGameToolHandlers } from '../mcp/tools/game.js';
import { buildInteractToolHandlers } from '../mcp/tools/interact.js';
import {
  ALL_TOOL_SURFACES,
  buildSurfaceRegistry,
  parseEnabledSurfaces
} from '../mcp/tools/surfaces.js';

const makeSchemas = () => ({
  SessionCreateSchema: {},
  SessionCloseSchema: {},
  TimeSchema: {},
  TimeStepSchema: {},
  StateGetSchema: {},
  StateDeltaSchema: {},
  EditorApplySchema: {},
  ObjectsListSchema: {},
  ObjectsPlaceSchema: {},
  ObjectsUpdateSchema: {},
  ObjectsDeleteSchema: {},
  LemmingsSummarySchema: {},
  LemmingSelectSchema: {},
  SkillApplySchema: {},
  InputActionSchema: {},
  InputKeysSchema: {},
  VisionCaptureSchema: {},
  VisionSequenceSchema: {},
  WatchCreateSchema: {},
  WatchCancelSchema: {},
  EventsPollSchema: {}
});

const makeHandlers = () => ({
  createSession: () => {},
  closeSession: () => {},
  pauseTime: () => {},
  resumeTime: () => {},
  stepTime: () => {},
  getStateTool: () => {},
  getStateDeltaTool: () => {},
  editorApplyTool: () => {},
  listObjectsTool: () => {},
  placeObjectsTool: () => {},
  updateObjectsTool: () => {},
  deleteObjectsTool: () => {},
  getLemmingsSummaryTool: () => {},
  selectLemmingTool: () => {},
  applySkillTool: () => {},
  inputActionTool: () => {},
  inputKeysTool: () => {},
  visionCaptureTool: () => {},
  visionSequenceTool: () => {},
  watchCreateTool: () => {},
  watchCancelTool: () => {},
  eventsPollTool: () => {}
});

describe('mcp tool surfaces', function () {
  it('builds editor specs with typed object verbs and compatibility editor.apply', function () {
    const names = buildEditorToolSpecs(makeSchemas()).map((spec) => spec.name);
    expect(names).to.deep.equal([
      'editor.apply',
      'objects.list',
      'objects.place',
      'objects.update',
      'objects.delete'
    ]);
  });

  it('maps editor handlers for all typed object verbs', function () {
    const handlers = makeHandlers();
    const editorHandlers = buildEditorToolHandlers(handlers);
    expect(editorHandlers.get('editor.apply')).to.equal(handlers.editorApplyTool);
    expect(editorHandlers.get('objects.list')).to.equal(handlers.listObjectsTool);
    expect(editorHandlers.get('objects.place')).to.equal(handlers.placeObjectsTool);
    expect(editorHandlers.get('objects.update')).to.equal(handlers.updateObjectsTool);
    expect(editorHandlers.get('objects.delete')).to.equal(handlers.deleteObjectsTool);
  });

  it('throws when required game handlers are missing', function () {
    expect(() => buildGameToolHandlers({})).to.throw('Missing game tool handler');
  });

  it('throws when required interact handlers are missing', function () {
    expect(() => buildInteractToolHandlers({})).to.throw('Missing interact tool handler');
  });

  it('routes typed editor object verbs to the editor surface', function () {
    const registry = buildSurfaceRegistry(makeSchemas(), makeHandlers(), new Set(ALL_TOOL_SURFACES));
    expect(registry.toolSurfaceByName.get('objects.list')).to.equal('editor');
    expect(registry.toolSurfaceByName.get('objects.place')).to.equal('editor');
    expect(registry.toolSurfaceByName.get('objects.update')).to.equal('editor');
    expect(registry.toolSurfaceByName.get('objects.delete')).to.equal('editor');
  });

  it('supports explicit surface parsing and rejects unknown values', function () {
    expect(Array.from(parseEnabledSurfaces('game,editor')).sort()).to.deep.equal(['editor', 'game']);
    expect(() => parseEnabledSurfaces('unknown')).to.throw('Unknown MCP surface');
  });

  it('enforces semantic-first tool exposure by enabled surfaces', function () {
    const schemas = makeSchemas();
    const handlers = makeHandlers();

    const editorOnly = buildSurfaceRegistry(schemas, handlers, new Set(['editor']));
    const editorToolNames = editorOnly.specs.map((spec) => spec.name);
    expect(editorToolNames).to.include('objects.list');
    expect(editorToolNames).to.not.include('input.action');

    const gameOnly = buildSurfaceRegistry(schemas, handlers, new Set(['game']));
    const gameToolNames = gameOnly.specs.map((spec) => spec.name);
    expect(gameToolNames).to.include('state.get');
    expect(gameToolNames).to.not.include('input.keys');

    const interactOnly = buildSurfaceRegistry(schemas, handlers, new Set(['interact']));
    const interactToolNames = interactOnly.specs.map((spec) => spec.name);
    expect(interactToolNames).to.include('input.action');
    expect(interactToolNames).to.not.include('objects.place');
  });
});
