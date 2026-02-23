const EDITOR_SURFACE = 'editor';
const EDITOR_NAMESPACES = Object.freeze(['editor', 'objects']);
const EDITOR_HANDLER_MAP = Object.freeze([
  ['editor.apply', 'editorApplyTool'],
  ['objects.list', 'listObjectsTool'],
  ['objects.place', 'placeObjectsTool'],
  ['objects.update', 'updateObjectsTool'],
  ['objects.delete', 'deleteObjectsTool']
]);

const buildEditorToolSpecs = (schemas) => [
  {
    name: 'editor.apply',
    description: 'Apply editor mutations through the E2E harness.',
    schema: schemas.EditorApplySchema
  },
  {
    name: 'objects.list',
    description: 'List editor objects with optional bbox/paging filters and revision deltas.',
    schema: schemas.ObjectsListSchema
  },
  {
    name: 'objects.place',
    description: 'Place one or more editor objects via typed mutation calls.',
    schema: schemas.ObjectsPlaceSchema
  },
  {
    name: 'objects.update',
    description: 'Update one or more editor objects via typed mutation calls.',
    schema: schemas.ObjectsUpdateSchema
  },
  {
    name: 'objects.delete',
    description: 'Delete one or more editor objects via typed mutation calls.',
    schema: schemas.ObjectsDeleteSchema
  }
];

/**
 * Build dispatch handlers for editor tools.
 *
 * @param {Record<string, any>} handlers
 * @throws {Error} When a required handler is missing.
 * @returns {Map<string, (...args: any[]) => any>}
 */
const buildEditorToolHandlers = (handlers = {}) => {
  const routes = [];
  for (const [toolName, handlerKey] of EDITOR_HANDLER_MAP) {
    const handler = handlers[handlerKey];
    if (typeof handler !== 'function') {
      throw new Error(`Missing editor tool handler: ${handlerKey}`);
    }
    routes.push([toolName, handler]);
  }
  return new Map(routes);
};

export {
  EDITOR_NAMESPACES,
  EDITOR_SURFACE,
  buildEditorToolHandlers,
  buildEditorToolSpecs
};
