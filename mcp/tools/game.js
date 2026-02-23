const GAME_SURFACE = 'game';
const GAME_NAMESPACES = Object.freeze(['session', 'time', 'state', 'lemming', 'skill']);

const GAME_HANDLER_MAP = Object.freeze([
  ['session.create', 'createSession'],
  ['session.close', 'closeSession'],
  ['time.pause', 'pauseTime'],
  ['time.resume', 'resumeTime'],
  ['time.step', 'stepTime'],
  ['state.get', 'getStateTool'],
  ['state.delta', 'getStateDeltaTool'],
  ['lemming.summary', 'getLemmingsSummaryTool'],
  ['lemming.select', 'selectLemmingTool'],
  ['skill.apply', 'applySkillTool']
]);

/**
 * Build typed MCP tool specs for the game surface.
 *
 * @param {Record<string, any>} schemas
 * @returns {Array<{name:string,description:string,schema:any}>}
 */
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

/**
 * Build dispatch handlers for game tools.
 *
 * @param {Record<string, any>} handlers
 * @throws {Error} When a required handler is missing.
 * @returns {Map<string, (...args: any[]) => any>}
 */
const buildGameToolHandlers = (handlers = {}) => {
  const routes = [];
  for (const [toolName, handlerKey] of GAME_HANDLER_MAP) {
    const handler = handlers[handlerKey];
    if (typeof handler !== 'function') {
      throw new Error(`Missing game tool handler: ${handlerKey}`);
    }
    routes.push([toolName, handler]);
  }
  return new Map(routes);
};

export {
  GAME_NAMESPACES,
  GAME_SURFACE,
  buildGameToolHandlers,
  buildGameToolSpecs
};
