const INTERACT_SURFACE = 'interact';
const INTERACT_NAMESPACES = Object.freeze(['input', 'vision', 'watch', 'events']);

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

const buildInteractToolHandlers = (handlers) => new Map([
  ['input.action', handlers.inputActionTool],
  ['input.keys', handlers.inputKeysTool],
  ['vision.capture', handlers.visionCaptureTool],
  ['vision.captureSequence', handlers.visionSequenceTool],
  ['watch.create', handlers.watchCreateTool],
  ['watch.cancel', handlers.watchCancelTool],
  ['events.poll', handlers.eventsPollTool]
]);

export {
  INTERACT_NAMESPACES,
  INTERACT_SURFACE,
  buildInteractToolHandlers,
  buildInteractToolSpecs
};
