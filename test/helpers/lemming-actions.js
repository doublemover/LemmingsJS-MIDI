import { Lemmings } from './lemmings.js';

class DummyAction {
  constructor(name = 'dummy') { this.name = name; }
  getActionName() { return this.name; }
  triggerLemAction(lem) { lem.setAction(this); return true; }
  process() { return Lemmings.LemmingStateType.NO_STATE_TYPE; }
  draw() {}
}

const actionKeys = [
  'ActionWalkSystem', 'ActionFallSystem', 'ActionJumpSystem', 'ActionDiggSystem',
  'ActionExitingSystem', 'ActionFloatingSystem', 'ActionBlockerSystem',
  'ActionMineSystem', 'ActionClimbSystem', 'ActionHoistSystem', 'ActionBashSystem',
  'ActionBuildSystem', 'ActionShrugSystem', 'ActionExplodingSystem', 'ActionOhNoSystem',
  'ActionSplatterSystem', 'ActionDrowningSystem', 'ActionFryingSystem', 'ActionCountdownSystem'
];

const withActionStubs = (overrides = {}) => {
  const keys = new Set([...actionKeys, ...Object.keys(overrides)]);
  const originals = {};
  for (const key of keys) originals[key] = Lemmings[key];
  for (const key of actionKeys) Lemmings[key] = overrides[key] || DummyAction;
  for (const [key, value] of Object.entries(overrides)) {
    Lemmings[key] = value;
  }
  return () => {
    for (const key of keys) {
      Lemmings[key] = originals[key];
    }
  };
};

export { DummyAction, actionKeys, withActionStubs };
