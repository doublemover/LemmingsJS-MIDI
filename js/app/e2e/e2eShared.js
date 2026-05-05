import { listSavedLevels, loadSavedLevel, saveLevel } from '../../editor/EditorStorage.js';
import {
  createTerrainEntry,
  createGadgetEntry,
  createSteelEntry,
  ensureEntryUid,
  ensureLevelEntryUids,
  setEntryProp,
  removeEntryAt
} from '../../editor/EditorEntryFactory.js';
import { createClassicLevelData } from '../../editor/EditorLevelLoader.js';
import { createEditorLevelFromClassic } from '../../editor/ClassicLevelConverter.js';
import { EditorTools } from '../../editor/EditorTools.js';
import { findEntryAt, getEntryBounds } from '../../editor/EditorHitTest.js';
import { BinaryReader } from '../../data/BinaryReader.js';
import { LevelReader } from '../../level/LevelReader.js';
import { LevelWriter } from '../../level/LevelWriter.js';
import { validateLevel } from '../../editor/EditorValidator.js';
import { getRuntimeDependency } from '../../core/dependencies.js';
const E2E_QUERY_KEY = 'e2e';
const BASE64_CHUNK = 0x8000;
const DTYPE_MAP = new Map([
  [Uint8Array, 'u8'],
  [Uint8ClampedArray, 'u8c'],
  [Uint16Array, 'u16'],
  [Uint32Array, 'u32'],
  [Int8Array, 'i8'],
  [Int16Array, 'i16'],
  [Int32Array, 'i32'],
  [Float32Array, 'f32'],
  [Float64Array, 'f64']
]);

export {
  BASE64_CHUNK,
  BinaryReader,
  DTYPE_MAP,
  E2E_QUERY_KEY,
  EditorTools,
  LevelReader,
  LevelWriter,
  createClassicLevelData,
  createEditorLevelFromClassic,
  createGadgetEntry,
  createSteelEntry,
  createTerrainEntry,
  ensureEntryUid,
  ensureLevelEntryUids,
  findEntryAt,
  getEntryBounds,
  getRuntimeDependency,
  listSavedLevels,
  loadSavedLevel,
  removeEntryAt,
  saveLevel,
  setEntryProp,
  validateLevel
};
