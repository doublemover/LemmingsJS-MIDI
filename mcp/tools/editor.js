const EDITOR_SURFACE = 'editor';
const EDITOR_NAMESPACES = Object.freeze(['editor', 'objects']);

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

const buildEditorToolHandlers = (handlers) => new Map([
  ['editor.apply', handlers.editorApplyTool],
  ['objects.list', handlers.listObjectsTool],
  ['objects.place', handlers.placeObjectsTool],
  ['objects.update', handlers.updateObjectsTool],
  ['objects.delete', handlers.deleteObjectsTool]
]);

export {
  EDITOR_NAMESPACES,
  EDITOR_SURFACE,
  buildEditorToolHandlers,
  buildEditorToolSpecs
};
