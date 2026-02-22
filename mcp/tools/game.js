const GAME_SURFACE = 'game';
const GAME_NAMESPACES = Object.freeze(['session', 'time', 'state', 'lemming', 'skill']);

const buildGameToolSpecs = (schemas) => [
  {
    name: 'session.create',
    description: 'Launch a Playwright session and load the game with the E2E harness.',
    schema: schemas.SessionCreateSchema
  },
  {
    name: 'session.close',
    description: 'Close a Playwright session and clear resources/events.',
    schema: schemas.SessionCloseSchema
  },
  {
    name: 'time.pause',
    description: 'Pause the game timer via the E2E harness.',
    schema: schemas.TimeSchema
  },
  {
    name: 'time.resume',
    description: 'Resume the game timer via the E2E harness.',
    schema: schemas.TimeSchema
  },
  {
    name: 'time.step',
    description: 'Step the game timer forward or backward by a number of ticks.',
    schema: schemas.TimeStepSchema
  },
  {
    name: 'state.get',
    description: 'Fetch a structured state snapshot from the E2E harness.',
    schema: schemas.StateGetSchema
  },
  {
    name: 'state.delta',
    description: 'Return filtered history deltas between ticks (defaults to changes since the last state.get).',
    schema: schemas.StateDeltaSchema
  },
  {
    name: 'lemming.summary',
    description: 'Return aggregated lemming summary data.',
    schema: schemas.LemmingsSummarySchema
  },
  {
    name: 'lemming.select',
    description: 'Select a lemming by ID via the E2E harness.',
    schema: schemas.LemmingSelectSchema
  },
  {
    name: 'skill.apply',
    description: 'Apply a skill to a selected lemming using keybindings.',
    schema: schemas.SkillApplySchema
  }
];

const buildGameToolHandlers = (handlers) => new Map([
  ['session.create', handlers.createSession],
  ['session.close', handlers.closeSession],
  ['time.pause', handlers.pauseTime],
  ['time.resume', handlers.resumeTime],
  ['time.step', handlers.stepTime],
  ['state.get', handlers.getStateTool],
  ['state.delta', handlers.getStateDeltaTool],
  ['lemming.summary', handlers.getLemmingsSummaryTool],
  ['lemming.select', handlers.selectLemmingTool],
  ['skill.apply', handlers.applySkillTool]
]);

export {
  GAME_NAMESPACES,
  GAME_SURFACE,
  buildGameToolHandlers,
  buildGameToolSpecs
};
