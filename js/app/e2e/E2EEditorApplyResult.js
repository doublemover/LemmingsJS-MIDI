import {
  getBenchMetrics,
  getEnvironmentDiagnostics,
  getStageState
} from './E2EDiagnostics.js';
import { getEditorState } from './E2EEditorState.js';
import {
  getGameState,
  getViewState,
  isGameReady
} from './E2EStateSerialization.js';

const buildEditorApplyState = (view, editorUi, returnState) => {
  if (returnState === 'editor') {
    return getEditorState(view, editorUi);
  }
  if (returnState !== 'full') {
    return null;
  }
  return {
    version: 1,
    mode: editorUi ? 'editor' : (view?.editorMode ? 'editor' : 'game'),
    ready: isGameReady(view),
    view: getViewState(view),
    stage: getStageState(view?.stage),
    game: getGameState(view),
    editor: getEditorState(view, editorUi),
    bench: getBenchMetrics(view),
    diagnostics: getEnvironmentDiagnostics(view),
    midi: {
      enabled: !!view?.midiEnabled,
      hasRouter: !!view?.midiRouter,
      outputName: view?.midiOut?.name || null
    }
  };
};

const buildApplyError = (code, message, details, results) => ({
  ok: false,
  error: { code, message, details },
  results
});

export {
  buildApplyError,
  buildEditorApplyState
};
