import { createCrosshairFrame } from '../../input/CrosshairCursor.js';
import { GameFactory } from '../GameFactory.js';
import { GameStateTypes } from '../GameStateTypes.js';
import { GameTypes } from '../GameTypes.js';
import { KeyboardShortcuts } from '../../input/KeyboardShortcuts.js';
import { Lemming } from '../../lemmings/Lemming.js';
import { BaseLogger } from '../../util/LogHandler.js';
import { MidiEventRouter } from '../../midi/MidiEventRouter.js';
import { MidiMapping } from '../../midi/MidiMapping.js';
import { Stage } from '../../render/Stage.js';
import { Trigger } from '../../level/Trigger.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { SoundEffectIds, SoundEventTypes } from '../SoundEvents.js';
import { FileContainer } from '../../data/FileContainer.js';
import { LevelIndexResolve } from '../../level/LevelIndexResolve.js';
import { LevelReader } from '../../level/LevelReader.js';
import { EditorSession } from '../../editor/EditorSession.js';
import { createEditorLevelFromClassic } from '../../editor/ClassicLevelConverter.js';
import { loadEditorLevel } from '../../editor/EditorLevelLoader.js';
import { listSavedLevels, loadSavedLevel } from '../../editor/EditorStorage.js';
import {
  getDependency,
  setAppContext,
  clearAppContext,
  getRuntimeDependency
} from '../../core/dependencies.js';
import { clampMidiFlagId, toMidiFlagTriggerType } from '../../midi/MidiFlagTriggers.js';
import { parseBoundedNumber, parseInt10 } from '../../core/numberParsing.js';
import {
  DEFAULT_RUNTIME_PROFILE,
  getProfileHistoryRetention,
  getRuntimeProfileIds,
  getRuntimeProfilePreset,
  getSpecialHistoryRetention,
  normalizeRuntimeProfile
} from '../../core/runtimeProfiles.js';
import { detectRuntimeCapabilities } from '../../core/capabilityMatrix.js';
import {
  DEFAULT_RUNTIME_ROLLOUT_FLAGS,
  resolveRuntimeRolloutFlags
} from '../../core/rolloutFlags.js';

const getGameTypes = () => getDependency('GameTypes', GameTypes);
const getGameStateTypes = () => getDependency('GameStateTypes', GameStateTypes);
const getTriggerTypes = () => getDependency('TriggerTypes', TriggerTypes);
const getLemmingCtor = () => getDependency('Lemming', Lemming);
const STARTUP_PROFILES = new Set(getRuntimeProfileIds());
const MIDI_FLAG_REGISTRATION_KEY = Symbol('midi-flag-registration');
const PASSIVE_RESIZE_LISTENER = Object.freeze({ passive: true });
const cloneConfig = (config) => JSON.parse(JSON.stringify(config || {}));
const hashString = (input) => {
  let hash = 2166136261;
  const str = String(input ?? '');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export {
  BaseLogger,
  DEFAULT_RUNTIME_PROFILE,
  DEFAULT_RUNTIME_ROLLOUT_FLAGS,
  EditorSession,
  FileContainer,
  GameFactory,
  GameStateTypes,
  GameTypes,
  KeyboardShortcuts,
  Lemming,
  LevelIndexResolve,
  LevelReader,
  MIDI_FLAG_REGISTRATION_KEY,
  MidiEventRouter,
  MidiMapping,
  PASSIVE_RESIZE_LISTENER,
  STARTUP_PROFILES,
  SoundEffectIds,
  SoundEventTypes,
  Stage,
  Trigger,
  TriggerTypes,
  clampMidiFlagId,
  clearAppContext,
  cloneConfig,
  createCrosshairFrame,
  createEditorLevelFromClassic,
  detectRuntimeCapabilities,
  getDependency,
  getGameStateTypes,
  getGameTypes,
  getLemmingCtor,
  getProfileHistoryRetention,
  getRuntimeDependency,
  getRuntimeProfileIds,
  getRuntimeProfilePreset,
  getSpecialHistoryRetention,
  getTriggerTypes,
  hashString,
  listSavedLevels,
  loadEditorLevel,
  loadSavedLevel,
  normalizeRuntimeProfile,
  parseBoundedNumber,
  parseInt10,
  resolveRuntimeRolloutFlags,
  setAppContext,
  toMidiFlagTriggerType
};
