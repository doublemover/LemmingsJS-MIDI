import { editorControllerPointerInputMethods } from './EditorControllerPointerInput.js';
import { editorControllerPointerSelectionMethods } from './EditorControllerPointerSelection.js';
import { editorControllerPointerToolMethods } from './EditorControllerPointerTools.js';

const editorControllerPointerMethods = {
  ...editorControllerPointerSelectionMethods,
  ...editorControllerPointerToolMethods,
  ...editorControllerPointerInputMethods
};

export { editorControllerPointerMethods };
