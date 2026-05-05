import { EditorController } from '../../editor/EditorController.js';
import { EditorHistory } from '../../editor/EditorHistory.js';
import { EditorAssetCache } from '../../editor/EditorAssetCache.js';
import { BinaryReader } from '../../data/BinaryReader.js';
import { LevelReader } from '../../level/LevelReader.js';
import { LevelWriter } from '../../level/LevelWriter.js';
import { createEditorLevelFromClassic } from '../../editor/ClassicLevelConverter.js';
import { createClassicLevelData } from '../../editor/EditorLevelLoader.js';
import { validateLevel } from '../../editor/EditorValidator.js';
import { getEntryBounds } from '../../editor/EditorHitTest.js';
import { ensureLevelEntryUids } from '../../editor/EditorEntryFactory.js';
import { getStyle, getStyleNames } from '../../editor/StyleRegistry.js';
import { EditorPreviewCache } from '../editorPreviewCache.js';
import { EditorKeybindings } from '../../input/EditorKeybindings.js';
import { ShortcutOverlay } from '../shortcutOverlay.js';
import { getRuntimeDependency } from '../../core/dependencies.js';
import {
  formatRotation,
  formatValue,
  normalizeRotation,
  normalizeText,
  parseNumber,
  sanitizeFileName
} from './editorUiFormat.js';
import {
  downloadBinaryFile,
  downloadTextFile,
  readArrayBufferFile,
  readTextFile
} from './editorUiFiles.js';
import {
  listSavedLevels,
  loadSavedLevel,
  saveLevel
} from '../../editor/EditorStorage.js';

const MAX_HISTORY = 200;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const HISTORY_COALESCE_WINDOW_MS = 250;
const MAX_BRUSH_SIZE = 64;
const PALETTE_PREVIEW_BATCH_SIZE = 24;
const PALETTE_SEARCH_DEBOUNCE_MS = 30;
const EDITOR_SHORTCUT_SECTIONS = [
  {
    title: 'General',
    entries: [
      { action: 'editorToggleShortcutOverlay', label: 'Shortcut overlay' },
      { action: 'editorTogglePlaytest', label: 'Toggle playtest' }
    ]
  },
  {
    title: 'Tools',
    entries: [
      { action: 'editorToolSelect', label: 'Select' },
      { action: 'editorToolTerrain', label: 'Terrain' },
      { action: 'editorToolGadget', label: 'Object' },
      { action: 'editorToolTrigger', label: 'Trigger' },
      { action: 'editorToolMidiFlag', label: 'MIDI Flag' },
      { action: 'editorToolEntrance', label: 'Entrance' },
      { action: 'editorToolExit', label: 'Exit' },
      { action: 'editorToolSteel', label: 'Steel' },
      { action: 'editorToolBrush', label: 'Brush' },
      { action: 'editorToolEraser', label: 'Eraser' }
    ]
  },
  {
    title: 'Edit',
    entries: [
      { action: 'editorCopy', label: 'Copy' },
      { action: 'editorPaste', label: 'Paste' },
      { action: 'editorDuplicate', label: 'Duplicate' },
      { action: 'editorUndo', label: 'Undo' },
      { action: 'editorRedo', label: 'Redo' },
      { action: 'editorDelete', label: 'Delete selection' },
      { action: 'editorSnapSelection', label: 'Snap to grid' },
      { action: 'editorBringToFront', label: 'Bring to front' },
      { action: 'editorMoveForward', label: 'Move forward' },
      { action: 'editorMoveBackward', label: 'Move backward' },
      { action: 'editorSendToBack', label: 'Send to back' }
    ]
  },
  {
    title: 'Nudge',
    entries: [
      { action: 'editorNudgeLeft', label: 'Nudge left' },
      { action: 'editorNudgeRight', label: 'Nudge right' },
      { action: 'editorNudgeUp', label: 'Nudge up' },
      { action: 'editorNudgeDown', label: 'Nudge down' },
      { action: 'editorNudgeLeftFast', label: 'Nudge left (grid)' },
      { action: 'editorNudgeRightFast', label: 'Nudge right (grid)' },
      { action: 'editorNudgeUpFast', label: 'Nudge up (grid)' },
      { action: 'editorNudgeDownFast', label: 'Nudge down (grid)' }
    ]
  }
];

export {
  BinaryReader,
  EDITOR_SHORTCUT_SECTIONS,
  EditorAssetCache,
  EditorController,
  EditorHistory,
  EditorKeybindings,
  EditorPreviewCache,
  HISTORY_COALESCE_WINDOW_MS,
  LevelReader,
  LevelWriter,
  MAX_BRUSH_SIZE,
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
  PALETTE_PREVIEW_BATCH_SIZE,
  PALETTE_SEARCH_DEBOUNCE_MS,
  ShortcutOverlay,
  createClassicLevelData,
  createEditorLevelFromClassic,
  downloadBinaryFile,
  downloadTextFile,
  ensureLevelEntryUids,
  formatRotation,
  formatValue,
  getEntryBounds,
  getRuntimeDependency,
  getStyle,
  getStyleNames,
  listSavedLevels,
  loadSavedLevel,
  normalizeRotation,
  normalizeText,
  parseNumber,
  readArrayBufferFile,
  readTextFile,
  sanitizeFileName,
  saveLevel,
  validateLevel
};
