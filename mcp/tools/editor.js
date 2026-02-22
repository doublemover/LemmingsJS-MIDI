const EDITOR_SURFACE = 'editor';
const EDITOR_NAMESPACES = Object.freeze(['editor']);

const buildEditorToolSpecs = (schemas) => [
  {
    name: 'editor.apply',
    description: 'Apply editor mutations through the E2E harness.',
    schema: schemas.EditorApplySchema
  }
];

const buildEditorToolHandlers = (handlers) => new Map([
  ['editor.apply', handlers.editorApplyTool]
]);

export {
  EDITOR_NAMESPACES,
  EDITOR_SURFACE,
  buildEditorToolHandlers,
  buildEditorToolSpecs
};
