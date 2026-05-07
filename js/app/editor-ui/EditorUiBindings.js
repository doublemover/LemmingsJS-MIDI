import { editorUiBindingControlMethods } from './EditorUiBindingControls.js';
import { editorUiBindingLifecycleMethods } from './EditorUiBindingLifecycle.js';
import { editorUiBindingToolMethods } from './EditorUiBindingTools.js';

const editorUiBindingsMethods = {
  ...editorUiBindingLifecycleMethods,
  ...editorUiBindingToolMethods,
  ...editorUiBindingControlMethods
};

export { editorUiBindingsMethods };
