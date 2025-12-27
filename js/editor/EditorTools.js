const EditorTools = Object.freeze({
  SELECT: 'select',
  TERRAIN: 'terrain',
  GADGET: 'gadget',
  TRIGGER: 'trigger',
  ENTRANCE: 'entrance',
  EXIT: 'exit',
  STEEL: 'steel',
  BRUSH: 'brush',
  ERASER: 'eraser'
});

const EDITOR_TOOL_ORDER = Object.freeze([
  EditorTools.SELECT,
  EditorTools.TERRAIN,
  EditorTools.GADGET,
  EditorTools.TRIGGER,
  EditorTools.ENTRANCE,
  EditorTools.EXIT,
  EditorTools.STEEL,
  EditorTools.BRUSH,
  EditorTools.ERASER
]);

export { EditorTools, EDITOR_TOOL_ORDER };
