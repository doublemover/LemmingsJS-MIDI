const INTERACT_SURFACE = 'interact';
const INTERACT_NAMESPACES = Object.freeze(['input', 'vision', 'watch', 'events']);

const INTERACT_HANDLER_MAP = Object.freeze([
  ['input.action', 'inputActionTool'],
  ['input.keys', 'inputKeysTool'],
  ['vision.capture', 'visionCaptureTool'],
  ['vision.captureSequence', 'visionSequenceTool'],
  ['watch.create', 'watchCreateTool'],
  ['watch.cancel', 'watchCancelTool'],
  ['events.poll', 'eventsPollTool']
]);

/**
 * Build typed MCP tool specs for the interaction surface.
 *
 * @param {Record<string, any>} schemas
 * @returns {Array<{name:string,description:string,schema:any}>}
 */
const buildInteractToolSpecs = (schemas) => [
  {
    name: 'input.action',
    description: 'Execute a named action from keybindings.json.',
    schema: schemas.InputActionSchema
  },
  {
    name: 'input.keys',
    description: 'Inject low-level key events.',
    schema: schemas.InputKeysSchema
  },
  {
    name: 'vision.capture',
    description: 'Capture a screenshot of the page or canvas.',
    schema: schemas.VisionCaptureSchema
  },
  {
    name: 'vision.captureSequence',
    description: 'Capture multiple frames across time.',
    schema: schemas.VisionSequenceSchema
  },
  {
    name: 'watch.create',
    description: 'Create a watch that emits events based on ticks or state changes.',
    schema: schemas.WatchCreateSchema
  },
  {
    name: 'watch.cancel',
    description: 'Cancel a watch.',
    schema: schemas.WatchCancelSchema
  },
  {
    name: 'events.poll',
    description: 'Poll events since a cursor.',
    schema: schemas.EventsPollSchema
  }
];

/**
 * Build dispatch handlers for interaction tools.
 *
 * @param {Record<string, any>} handlers
 * @throws {Error} When a required handler is missing.
 * @returns {Map<string, (...args: any[]) => any>}
 */
const buildInteractToolHandlers = (handlers = {}) => {
  const routes = [];
  for (const [toolName, handlerKey] of INTERACT_HANDLER_MAP) {
    const handler = handlers[handlerKey];
    if (typeof handler !== 'function') {
      throw new Error(`Missing interact tool handler: ${handlerKey}`);
    }
    routes.push([toolName, handler]);
  }
  return new Map(routes);
};

export {
  INTERACT_NAMESPACES,
  INTERACT_SURFACE,
  buildInteractToolHandlers,
  buildInteractToolSpecs
};
