import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult,
  normalizeActionScriptAction,
  normalizeSolverOptions
} from './SolverTypes.js';
import { GameStateTypes } from '../game/GameStateTypes.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { extractSolverState, stableHash } from './SolverState.js';

const SYNTHETIC_RUNNER_KIND = 'synthetic';

const SKILL_TYPE_BY_NAME = Object.freeze({
  climber: SkillTypes.CLIMBER,
  floater: SkillTypes.FLOATER,
  bomber: SkillTypes.BOMBER,
  blocker: SkillTypes.BLOCKER,
  builder: SkillTypes.BUILDER,
  basher: SkillTypes.BASHER,
  miner: SkillTypes.MINER,
  digger: SkillTypes.DIGGER
});

const cloneRectList = value => Array.isArray(value)
  ? value.map(rect => ({ ...rect }))
  : [];

const toInteger = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
};

const getSourceKind = source => {
  if (source?.kind === SYNTHETIC_RUNNER_KIND || source?.fixture?.kind === SYNTHETIC_RUNNER_KIND) {
    return SYNTHETIC_RUNNER_KIND;
  }
  const raw = String(source?.kind ?? source?.type ?? source?.sourceKind ?? '').trim().toLowerCase();
  if (raw === 'editor' || raw === 'editor-level') return 'editor';
  if (raw === 'procgen' || raw === 'procgen-chunk') return 'procgen';
  if (raw === 'builtin' || raw === 'built-in') return 'builtin';
  return raw || 'unknown';
};

const createUnsupportedRunnerResult = (sourceKind, detail = 'Solver runner source is not wired yet') => ({
  sourceKind,
  runner: null,
  result: createSolverResult({
    resultType: SOLVER_RESULT_TYPES.UNSUPPORTED,
    summary: `${sourceKind} solver runner is not supported yet`,
    explanations: [{
      code: SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC,
      detail
    }]
  })
});

const cloneMask = (mask, width, height) => {
  const size = Math.max(0, width * height);
  if (mask instanceof Uint8Array) return new Uint8Array(mask);
  if (Array.isArray(mask)) return Uint8Array.from(mask.slice(0, size));
  return new Uint8Array(size);
};

const cloneSkills = skills => {
  const out = {};
  if (skills == null || typeof skills !== 'object') return out;
  for (const [key, value] of Object.entries(skills)) {
    const count = Number(value);
    out[key] = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  }
  return out;
};

const cloneLemming = (lemming, index) => ({
  id: lemming?.id ?? index,
  x: toInteger(lemming?.x, 0),
  y: toInteger(lemming?.y, 0),
  lookRight: lemming?.lookRight !== false,
  action: String(lemming?.action || 'walking'),
  saved: Boolean(lemming?.saved),
  dead: Boolean(lemming?.dead),
  fallDistance: Math.max(0, toInteger(lemming?.fallDistance, 0)),
  lastSkill: lemming?.lastSkill == null ? null : String(lemming.lastSkill)
});

const hashSummary = value => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const withStateHash = summary => ({
  ...summary,
  stateHash: summary.stateHash ?? hashSummary(summary)
});

const hasRunnerAdapterShape = value => (
  value != null &&
  typeof value.step === 'function' &&
  typeof value.applyAction === 'function' &&
  typeof value.getFinalStateSummary === 'function'
);

const normalizeSkillTypeForRuntime = skillType => {
  if (Number.isInteger(skillType)) return skillType;
  const key = String(skillType || '').trim().toLowerCase();
  return SKILL_TYPE_BY_NAME[key] ?? SkillTypes.UNKNOWN;
};

const summaryCount = (summary, key, fallback = 0) => Math.max(0, toInteger(summary?.[key], fallback));

const activeFromSummary = summary => Array.isArray(summary?.lemmings)
  ? summary.lemmings.filter(lemming => !lemming.saved && !lemming.dead && !lemming.removed && !lemming.disabled)
  : [];

class SyntheticSolverRunner {
  constructor(fixture = {}, options = {}) {
    const width = Math.max(1, toInteger(fixture.width, 1));
    const height = Math.max(1, toInteger(fixture.height, 1));
    this.kind = SYNTHETIC_RUNNER_KIND;
    this.id = String(fixture.id || SYNTHETIC_RUNNER_KIND);
    this.width = width;
    this.height = height;
    this.groundMask = cloneMask(fixture.groundMask, width, height);
    this.steelMask = cloneMask(fixture.steelMask, width, height);
    this.oneWay = cloneRectList(fixture.oneWay);
    this.hazards = cloneRectList(fixture.hazards);
    this.entrances = cloneRectList(fixture.entrances);
    this.exits = cloneRectList(fixture.exits);
    this.skills = cloneSkills(fixture.skills);
    this.lemmings = Array.isArray(fixture.lemmings)
      ? fixture.lemmings.map(cloneLemming)
      : [];
    this.needCount = Math.max(0, toInteger(fixture.needCount, 1));
    this.releaseCount = Math.max(0, toInteger(fixture.releaseCount, this.lemmings.length));
    this.tick = Math.max(0, toInteger(fixture.timer?.tick, 0));
    this.options = normalizeSolverOptions(options);
    this.builderLength = Math.max(1, toInteger(options.builderLength, 12));
    this.maxSurvivableFall = Math.max(1, toInteger(options.maxSurvivableFall, 12));
  }

  getSavedCount() {
    return this.lemmings.filter(lemming => lemming.saved).length;
  }

  getDeadCount() {
    return this.lemmings.filter(lemming => lemming.dead).length;
  }

  getActiveLemmings() {
    return this.lemmings.filter(lemming => !lemming.saved && !lemming.dead);
  }

  getSkillCount(skillType) {
    return this.skills[String(skillType || '')] ?? 0;
  }

  selectLemming(target) {
    const active = this.getActiveLemmings();
    if (target == null) return active[0] ?? this.lemmings[0] ?? null;
    if (typeof target === 'number') return this.lemmings.find(lemming => lemming.id === target) ?? null;
    if (typeof target === 'string') {
      if (target === 'first' || target === 'lead') return active[0] ?? null;
      return this.lemmings.find(lemming => String(lemming.id) === target) ?? null;
    }
    if (typeof target === 'object') {
      if (target.id != null) {
        return this.lemmings.find(lemming => String(lemming.id) === String(target.id)) ?? null;
      }
      if (target.index != null) return this.lemmings[toInteger(target.index, -1)] ?? null;
    }
    return active[0] ?? null;
  }

  isTerminal() {
    return this.getActiveLemmings().length === 0;
  }

  step(count = 1) {
    const safeCount = Math.max(1, toInteger(count, 1));
    for (let i = 0; i < safeCount; i += 1) {
      this.#stepOneTick();
    }
    return this.getFinalStateSummary();
  }

  applyAction(action) {
    const normalized = normalizeActionScriptAction(action);
    const lemming = this.selectLemming(normalized.target);
    if (!lemming || lemming.saved || lemming.dead) {
      return {
        ok: false,
        detail: `No active target lemming for ${normalized.skillType || 'action'}`
      };
    }

    const skillType = String(normalized.skillType || 'wait').toLowerCase();
    if (skillType === 'wait' || skillType === 'noop') {
      lemming.lastSkill = skillType;
      return { ok: true, lemmingId: lemming.id, skillType };
    }
    if (this.getSkillCount(skillType) <= 0) {
      return {
        ok: false,
        detail: `No ${skillType} skill remains`
      };
    }

    if (skillType === 'builder') return this.#applyBuilder(lemming, skillType);
    if (skillType === 'basher') return this.#applyBasher(lemming, skillType);
    if (skillType === 'digger') return this.#applyDigger(lemming, skillType);
    if (skillType === 'miner') return this.#applyMiner(lemming, skillType);
    if (skillType === 'blocker') return this.#applyBlocker(lemming, skillType);

    return {
      ok: false,
      detail: `Synthetic runner does not support ${skillType}`
    };
  }

  getFinalStateSummary() {
    const lemmings = this.lemmings.map(lemming => ({
      id: lemming.id,
      x: lemming.x,
      y: lemming.y,
      lookRight: lemming.lookRight,
      action: lemming.action,
      saved: lemming.saved,
      dead: lemming.dead,
      fallDistance: lemming.fallDistance,
      lastSkill: lemming.lastSkill
    }));
    const summary = {
      sourceKind: this.kind,
      id: this.id,
      tick: this.tick,
      width: this.width,
      height: this.height,
      savedCount: this.getSavedCount(),
      deadCount: this.getDeadCount(),
      activeCount: this.getActiveLemmings().length,
      needCount: this.needCount,
      releaseCount: this.releaseCount,
      skills: { ...this.skills },
      lemmings
    };
    return { ...summary, stateHash: hashSummary(summary) };
  }

  #stepOneTick() {
    for (const lemming of this.lemmings) {
      if (lemming.saved || lemming.dead) continue;
      this.#maybeExit(lemming);
      if (lemming.saved) continue;
      if (this.#isInHazard(lemming.x, lemming.y)) {
        lemming.dead = true;
        lemming.action = 'dead';
        continue;
      }

      const supported = this.#hasSupport(lemming.x, lemming.y);
      if (!supported) {
        this.#fall(lemming);
        continue;
      }

      lemming.fallDistance = 0;
      const dx = lemming.lookRight ? 1 : -1;
      const nextX = lemming.x + dx;
      if (this.#isBlocked(nextX, lemming.y)) {
        lemming.action = 'stopped';
        continue;
      }
      lemming.x = nextX;
      lemming.action = 'walking';
      if (!this.#hasSupport(lemming.x, lemming.y)) this.#fall(lemming);
      this.#maybeExit(lemming);
    }
    this.tick += 1;
  }

  #fall(lemming) {
    lemming.y += 1;
    lemming.fallDistance += 1;
    lemming.action = 'falling';
    if (lemming.y >= this.height || lemming.fallDistance > this.maxSurvivableFall) {
      lemming.dead = true;
      lemming.action = 'dead';
    }
  }

  #applyBuilder(lemming, skillType) {
    this.#consumeSkill(skillType);
    const dx = lemming.lookRight ? 1 : -1;
    const y = lemming.y + 1;
    for (let step = 1; step <= this.builderLength; step += 1) {
      this.#setGround(lemming.x + (dx * step), y, true);
    }
    lemming.action = 'building';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyBasher(lemming, skillType) {
    this.#consumeSkill(skillType);
    const dx = lemming.lookRight ? 1 : -1;
    for (let step = 1; step <= 10; step += 1) {
      const x = lemming.x + (dx * step);
      for (let y = lemming.y - 8; y <= lemming.y + 1; y += 1) {
        if (!this.#isSteel(x, y)) this.#setGround(x, y, false);
      }
    }
    lemming.action = 'bashing';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyDigger(lemming, skillType) {
    this.#consumeSkill(skillType);
    for (let y = lemming.y + 1; y <= lemming.y + 12; y += 1) {
      for (let x = lemming.x - 2; x <= lemming.x + 2; x += 1) {
        if (!this.#isSteel(x, y)) this.#setGround(x, y, false);
      }
    }
    lemming.action = 'digging';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyMiner(lemming, skillType) {
    this.#consumeSkill(skillType);
    const dx = lemming.lookRight ? 1 : -1;
    for (let step = 1; step <= 12; step += 1) {
      const x = lemming.x + (dx * step);
      const y = lemming.y + Math.floor(step / 2);
      for (let dy = -1; dy <= 2; dy += 1) {
        if (!this.#isSteel(x, y + dy)) this.#setGround(x, y + dy, false);
      }
    }
    lemming.action = 'mining';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyBlocker(lemming, skillType) {
    this.#consumeSkill(skillType);
    lemming.lookRight = !lemming.lookRight;
    lemming.action = 'blocking';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #consumeSkill(skillType) {
    this.skills[skillType] = Math.max(0, this.getSkillCount(skillType) - 1);
  }

  #hasSupport(x, y) {
    return this.#isGround(x, y + 1);
  }

  #isBlocked(x, y) {
    return this.#isGround(x, y) || this.#isSteel(x, y);
  }

  #isGround(x, y) {
    return this.#maskValue(this.groundMask, x, y) > 0;
  }

  #isSteel(x, y) {
    return this.#maskValue(this.steelMask, x, y) > 0;
  }

  #setGround(x, y, value) {
    const index = this.#maskIndex(x, y);
    if (index < 0) return;
    this.groundMask[index] = value ? 1 : 0;
  }

  #maskValue(mask, x, y) {
    const index = this.#maskIndex(x, y);
    return index < 0 ? 0 : mask[index];
  }

  #maskIndex(x, y) {
    const ix = toInteger(x, -1);
    const iy = toInteger(y, -1);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return -1;
    return (iy * this.width) + ix;
  }

  #maybeExit(lemming) {
    for (const exit of this.exits) {
      const exitX = toInteger(exit.x, 0);
      const exitY = toInteger(exit.y, 0);
      const radius = Math.max(1, toInteger(exit.radius, 1));
      if (Math.abs(lemming.x - exitX) <= radius && Math.abs(lemming.y - exitY) <= 2) {
        lemming.saved = true;
        lemming.action = 'exiting';
        return;
      }
    }
  }

  #isInHazard(x, y) {
    return this.hazards.some(rect => (
      x >= toInteger(rect.x, 0) &&
      x < toInteger(rect.x, 0) + Math.max(0, toInteger(rect.width, 0)) &&
      y >= toInteger(rect.y, 0) &&
      y < toInteger(rect.y, 0) + Math.max(0, toInteger(rect.height, 0))
    ));
  }
}

class DelegatingRuntimeSolverRunner {
  constructor(sourceKind, runner, source = {}) {
    this.kind = sourceKind;
    this.runner = runner;
    this.id = String(source.id ?? runner.id ?? sourceKind);
    this.isRuntimeAuthoritative = source.authoritative !== false &&
      runner.isRuntimeAuthoritative !== false;
  }

  get tick() {
    return toInteger(this.runner.tick ?? this.runner.getFinalStateSummary?.().tick, 0);
  }

  getSavedCount() {
    return summaryCount(this.getFinalStateSummary(), 'savedCount', 0);
  }

  getDeadCount() {
    return summaryCount(this.getFinalStateSummary(), 'deadCount', 0);
  }

  getActiveLemmings() {
    if (typeof this.runner.getActiveLemmings === 'function') return this.runner.getActiveLemmings();
    return activeFromSummary(this.getFinalStateSummary());
  }

  getSkillCount(skillType) {
    if (typeof this.runner.getSkillCount === 'function') return this.runner.getSkillCount(skillType);
    return summaryCount(this.getFinalStateSummary()?.skills, String(skillType || ''), 0);
  }

  selectLemming(target) {
    if (typeof this.runner.selectLemming === 'function') return this.runner.selectLemming(target);
    return selectLemmingFromList(this.getActiveLemmings(), target);
  }

  isTerminal() {
    if (typeof this.runner.isTerminal === 'function') return this.runner.isTerminal();
    const summary = this.getFinalStateSummary();
    return summary.activeCount <= 0 && summary.leftCount <= 0;
  }

  step(count = 1) {
    return this.runner.step(count);
  }

  applyAction(action) {
    return this.runner.applyAction(action);
  }

  getFinalStateSummary() {
    return withStateHash({
      sourceKind: this.kind,
      id: this.id,
      ...this.runner.getFinalStateSummary()
    });
  }
}

const selectLemmingFromList = (lemmings, target) => {
  const active = Array.isArray(lemmings) ? lemmings : [];
  if (target == null) return active[0] ?? null;
  if (typeof target === 'number') return active.find(lemming => lemming.id === target) ?? null;
  if (typeof target === 'string') {
    if (target === 'first' || target === 'lead' || target === 'frontier') return active[0] ?? null;
    return active.find(lemming => String(lemming.id) === target) ?? null;
  }
  if (typeof target === 'object') {
    if (target.id != null) {
      return active.find(lemming => String(lemming.id) === String(target.id)) ?? null;
    }
    if (target.index != null) return active[toInteger(target.index, -1)] ?? null;
    if (target.role === 'frontier') {
      return [...active].sort((a, b) => b.x - a.x || a.y - b.y || Number(a.id) - Number(b.id))[0] ?? null;
    }
    if (target.role === 'crowd' || target.role === 'lead') return active[0] ?? null;
  }
  return active[0] ?? null;
};

class RuntimeGameSolverRunner {
  constructor(sourceKind, source = {}, options = {}) {
    this.kind = sourceKind;
    this.source = source;
    this.runtime = source.game ?? source.runtime ?? source.adapter ?? source;
    this.id = String(source.id ?? this.runtime?.id ?? this.runtime?.level?.id ?? sourceKind);
    this.options = normalizeSolverOptions(options);
    this.isRuntimeAuthoritative = source.authoritative !== false &&
      this.runtime?.isRuntimeAuthoritative !== false;
  }

  get tick() {
    return toInteger(
      this.runtime?.tick ??
        this.runtime?.getTick?.() ??
        this.getTimer()?.tickIndex ??
        this.getTimer()?.getGameTicks?.(),
      0
    );
  }

  getTimer() {
    return this.runtime?.getGameTimer?.() ?? this.runtime?.gameTimer ?? this.source?.timer ?? null;
  }

  getManager() {
    return this.runtime?.getLemmingManager?.() ??
      this.runtime?.lemmingManager ??
      this.source?.lemmingManager ??
      null;
  }

  getSkills() {
    return this.runtime?.getGameSkills?.() ?? this.runtime?.skills ?? this.source?.skillsRuntime ?? null;
  }

  getVictory() {
    return this.runtime?.getVictoryCondition?.() ??
      this.runtime?.gameVictoryCondition ??
      this.source?.victory ??
      null;
  }

  getActiveLemmings() {
    const manager = this.getManager();
    if (typeof manager?.getLemmings === 'function') return manager.getLemmings();
    if (Array.isArray(manager?.activeLemmings)) return manager.activeLemmings;
    if (Array.isArray(this.runtime?.lemmings)) return this.runtime.lemmings;
    return [];
  }

  getSavedCount() {
    const victory = this.getVictory();
    return toInteger(victory?.getSurvivorsCount?.() ?? victory?.survivorCount, 0);
  }

  getDeadCount() {
    const summary = this.getFinalStateSummary();
    return summary.deadCount;
  }

  getSkillCount(skillType) {
    const runtimeSkillType = normalizeSkillTypeForRuntime(skillType);
    const skills = this.getSkills();
    if (typeof skills?.getSkill === 'function') return toInteger(skills.getSkill(runtimeSkillType), 0);
    if (typeof skills?.canReuseSkill === 'function') return skills.canReuseSkill(runtimeSkillType) ? 1 : 0;
    const rawSkills = skills?.skills ?? this.runtime?.level?.skills ?? this.source?.skills ?? {};
    if (Array.isArray(rawSkills)) return toInteger(rawSkills[runtimeSkillType], 0);
    return toInteger(rawSkills?.[String(skillType || '').toLowerCase()], 0);
  }

  selectLemming(target) {
    const manager = this.getManager();
    if (target && typeof target === 'object' && target.id != null && typeof manager?.getLemming === 'function') {
      const byId = manager.getLemming(target.id);
      if (byId && !byId.removed && !byId.disabled) return byId;
    }
    if (typeof target === 'number' && typeof manager?.getLemming === 'function') {
      const byId = manager.getLemming(target);
      if (byId && !byId.removed && !byId.disabled) return byId;
    }
    return selectLemmingFromList(this.getActiveLemmings(), target);
  }

  isTerminal() {
    if (typeof this.runtime?.isTerminal === 'function') return this.runtime.isTerminal();
    const state = this.runtime?.getGameState?.();
    if (state != null && state !== GameStateTypes.RUNNING && state !== GameStateTypes.UNKNOWN) return true;
    const victory = this.getVictory();
    const left = toInteger(victory?.getLeftCount?.() ?? victory?.leftCount, 0);
    const out = toInteger(victory?.getOutCount?.() ?? victory?.outCount, this.getActiveLemmings().length);
    return left <= 0 && out <= 0;
  }

  step(count = 1) {
    const safeCount = Math.max(1, toInteger(count, 1));
    if (typeof this.runtime?.step === 'function' && this.runtime !== this) {
      return this.runtime.step(safeCount);
    }
    const timer = this.getTimer();
    if (typeof timer?.tick === 'function') {
      timer.tick(safeCount);
      return this.getFinalStateSummary();
    }
    if (typeof this.runtime?.runGameLogic === 'function') {
      for (let i = 0; i < safeCount; i += 1) {
        this.runtime.runGameLogic();
      }
      return this.getFinalStateSummary();
    }
    return this.getFinalStateSummary();
  }

  applyAction(action) {
    const normalized = normalizeActionScriptAction(action);
    if (typeof this.runtime?.applySolverAction === 'function') {
      return this.runtime.applySolverAction(normalized);
    }
    const lemming = this.selectLemming(normalized.target);
    if (!lemming) {
      return {
        ok: false,
        detail: `No runtime target lemming for ${normalized.skillType || 'action'}`
      };
    }
    const skillType = normalizeSkillTypeForRuntime(normalized.skillType);
    const skills = this.getSkills();
    const manager = this.getManager();
    if (!manager || !skills || skillType === SkillTypes.UNKNOWN) {
      return {
        ok: false,
        detail: `Runtime cannot apply ${normalized.skillType || 'action'}`
      };
    }
    if (typeof skills.canReuseSkill === 'function' && !skills.canReuseSkill(skillType)) {
      return {
        ok: false,
        detail: `No ${normalized.skillType} skill remains`
      };
    }
    if (!manager.doLemmingAction?.(lemming, skillType)) {
      return {
        ok: false,
        detail: `Runtime rejected ${normalized.skillType} for lemming ${lemming.id}`
      };
    }
    if (typeof skills.reuseSkill === 'function' && !skills.reuseSkill(skillType)) {
      return {
        ok: false,
        detail: `Runtime could not consume ${normalized.skillType}`
      };
    }
    return {
      ok: true,
      lemmingId: lemming.id,
      skillType: normalized.skillType
    };
  }

  getFinalStateSummary() {
    if (typeof this.runtime?.getSolverSummary === 'function') {
      return withStateHash({
        sourceKind: this.kind,
        id: this.id,
        ...this.runtime.getSolverSummary()
      });
    }
    let snapshot = null;
    try {
      snapshot = extractSolverState(this.runtime, {
        sourceKind: this.kind,
        id: this.id
      });
    } catch {
      snapshot = null;
    }
    const victory = this.getVictory();
    const active = this.getActiveLemmings();
    const savedCount = toInteger(victory?.getSurvivorsCount?.() ?? victory?.survivorCount, 0);
    const releaseCount = toInteger(victory?.getReleaseCount?.() ?? victory?.releaseCount ?? snapshot?.victory.releaseCount, active.length);
    const leftCount = toInteger(victory?.getLeftCount?.() ?? victory?.leftCount ?? snapshot?.victory.leftCount, 0);
    const activeCount = toInteger(victory?.getOutCount?.() ?? victory?.outCount, active.length);
    const lemmings = snapshot?.lemmings ?? active.map((lemming, index) => ({
      id: lemming?.id ?? index,
      x: toInteger(lemming?.x, 0),
      y: toInteger(lemming?.y, 0),
      lookRight: lemming?.lookRight !== false,
      action: String(lemming?.action?.getActionName?.() ?? lemming?.action ?? ''),
      saved: false,
      dead: !!lemming?.removed,
      removed: !!lemming?.removed,
      disabled: !!lemming?.disabled
    }));
    const summary = {
      sourceKind: this.kind,
      id: this.id,
      tick: this.tick,
      width: snapshot?.width ?? this.runtime?.level?.width ?? this.source?.width ?? 0,
      height: snapshot?.height ?? this.runtime?.level?.height ?? this.source?.height ?? 0,
      savedCount,
      deadCount: Math.max(0, releaseCount - leftCount - activeCount - savedCount),
      activeCount,
      needCount: toInteger(victory?.getNeedCount?.() ?? victory?.needCount ?? snapshot?.victory.needCount, 1),
      releaseCount,
      leftCount,
      skills: snapshot?.skills?.counts ?? {},
      lemmings,
      hashes: snapshot?.hashes ?? null,
      snapshotHash: snapshot?.snapshotHash ?? null
    };
    return withStateHash(summary);
  }
}

const createSyntheticRunner = (fixture, options = {}) => {
  const source = fixture?.fixture?.kind === SYNTHETIC_RUNNER_KIND ? fixture.fixture : fixture;
  return new SyntheticSolverRunner(source, options);
};

const createRunnerFromSyntheticFixture = (fixture, options = {}) => ({
  sourceKind: SYNTHETIC_RUNNER_KIND,
  runner: createSyntheticRunner(fixture, options),
  result: null
});

const createRuntimeSourceRunner = (sourceKind, source, options = {}, missingDetail) => {
  const facade = source?.runner ?? source?.runtime ?? source?.game ?? source?.adapter ?? null;
  if (hasRunnerAdapterShape(facade)) {
    return {
      sourceKind,
      runner: new DelegatingRuntimeSolverRunner(sourceKind, facade, source),
      result: null
    };
  }
  if (facade || source?.getGameTimer || source?.getLemmingManager) {
    return {
      sourceKind,
      runner: new RuntimeGameSolverRunner(sourceKind, source, options),
      result: null
    };
  }
  return createUnsupportedRunnerResult(sourceKind, missingDetail);
};

const createEditorLevelRunner = (source, options = {}) => createRuntimeSourceRunner(
  'editor',
  source,
  options,
  'Editor level sources require an initialized editor playtest runtime or runner adapter'
);

const createProcgenChunkRunner = (source, options = {}) => createRuntimeSourceRunner(
  'procgen',
  source,
  options,
  'Procgen chunks require an initialized procgen runtime or runner adapter'
);

const createBuiltInLevelRunner = (source, options = {}) => createRuntimeSourceRunner(
  'builtin',
  source,
  options,
  'Built-in level descriptors require an initialized game runtime or runner adapter'
);

const createRunnerFromSource = (source, options = {}) => {
  const kind = getSourceKind(source);
  if (kind === SYNTHETIC_RUNNER_KIND) {
    return createRunnerFromSyntheticFixture(source?.fixture ?? source, options);
  }
  if (kind === 'editor') return createEditorLevelRunner(source, options);
  if (kind === 'procgen') return createProcgenChunkRunner(source, options);
  if (kind === 'builtin') return createBuiltInLevelRunner(source, options);
  return createUnsupportedRunnerResult('unknown', 'Unknown solver runner source');
};

const isRunnerAdapter = value => hasRunnerAdapterShape(value);

const resolveRunner = (runnerOrSource, options) => {
  if (isRunnerAdapter(runnerOrSource)) {
    return { sourceKind: runnerOrSource.kind || 'adapter', runner: runnerOrSource, result: null };
  }
  if (runnerOrSource?.result) return runnerOrSource;
  if (runnerOrSource?.runner && typeof runnerOrSource.sourceKind === 'string') return runnerOrSource;
  return createRunnerFromSource(runnerOrSource, options);
};

const getActionBounds = action => {
  if (action.tick != null) return { start: action.tick, end: action.tick, exact: true };
  if (action.window) {
    return {
      start: Math.min(action.window.start, action.window.end),
      end: Math.max(action.window.start, action.window.end),
      exact: false
    };
  }
  return { start: 0, end: 0, exact: true };
};

const prepareActionQueue = actions => actions
  .map((action, index) => {
    const normalized = normalizeActionScriptAction(action);
    return {
      action: normalized,
      index,
      ...getActionBounds(normalized)
    };
  })
  .sort((left, right) => left.start - right.start || left.index - right.index);

const toConditionCount = (condition, fallback) => Math.max(0, toInteger(
  condition.count ?? condition.value ?? condition.min,
  fallback
));

const conditionDetail = condition => {
  if (typeof condition === 'string') return condition;
  return JSON.stringify(condition);
};

const checkCondition = (condition, runner, action = null) => {
  const summary = runner.getFinalStateSummary();
  if (typeof condition === 'string') {
    if (condition === 'target-active') {
      const target = runner.selectLemming(action?.target);
      return {
        ok: Boolean(target && !target.saved && !target.dead),
        detail: condition
      };
    }
    if (condition === 'saved') {
      return { ok: summary.savedCount > 0, detail: condition };
    }
    return { ok: false, detail: `Unknown replay condition: ${condition}` };
  }
  if (condition == null || typeof condition !== 'object') {
    return { ok: false, detail: 'Invalid replay condition' };
  }

  const type = String(condition.type ?? condition.kind ?? condition.code ?? '').trim();
  const lemming = condition.id == null
    ? runner.selectLemming(action?.target)
    : summary.lemmings.find(item => String(item.id) === String(condition.id));

  if (type === 'savedCountAtLeast') {
    return {
      ok: summary.savedCount >= toConditionCount(condition, 1),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'deadCountAtMost') {
    return {
      ok: summary.deadCount <= toConditionCount(condition, 0),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'activeCountAtLeast') {
    return {
      ok: summary.activeCount >= toConditionCount(condition, 1),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingSaved') {
    return {
      ok: Boolean(lemming?.saved),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingAlive') {
    return {
      ok: Boolean(lemming && !lemming.dead),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingXAtLeast') {
    return {
      ok: Boolean(lemming && lemming.x >= toInteger(condition.x, 0)),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingXAtMost') {
    return {
      ok: Boolean(lemming && lemming.x <= toInteger(condition.x, 0)),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'skillAvailable' || type === 'skillRemainingAtLeast') {
    const skillType = String(condition.skillType ?? condition.skill ?? '').trim();
    return {
      ok: runner.getSkillCount(skillType) >= toConditionCount(condition, 1),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'tickAtLeast') {
    return {
      ok: summary.tick >= toConditionCount(condition, 0),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'tickAtMost') {
    return {
      ok: summary.tick <= toConditionCount(condition, 0),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'stateHash') {
    return {
      ok: summary.stateHash === String(condition.value ?? ''),
      detail: conditionDetail(condition)
    };
  }
  return { ok: false, detail: `Unknown replay condition: ${conditionDetail(condition)}` };
};

const firstFailedCondition = (conditions, runner, action = null) => {
  for (const condition of conditions) {
    const checked = checkCondition(condition, runner, action);
    if (!checked.ok) return checked;
  }
  return null;
};

const createReplayResult = ({
  resultType,
  summary,
  actions,
  explanations = [],
  budgetUsage,
  runner,
  appliedActions
}) => {
  const replaySummary = {
    ...runner.getFinalStateSummary(),
    appliedActions: appliedActions.map(item => ({ ...item }))
  };
  return createSolverResult({
    resultType,
    summary,
    actions,
    explanations,
    budgetUsage,
    replaySummary
  });
};

const createReplayFailure = ({
  summary,
  detail,
  actions,
  budgetUsage,
  runner,
  appliedActions,
  code = SOLVER_EXPLANATION_CODES.REPLAY_DIVERGED
}) => createReplayResult({
  resultType: SOLVER_RESULT_TYPES.FAILED,
  summary,
  actions,
  explanations: [{ code, detail }],
  budgetUsage,
  runner,
  appliedActions
});

const verifyActionReplay = (runnerOrSource, actions = [], options = {}) => {
  const normalizedOptions = normalizeSolverOptions(options);
  const created = resolveRunner(runnerOrSource, normalizedOptions);
  if (created.result) return created.result;

  const runner = created.runner;
  const actionQueue = prepareActionQueue(actions);
  const appliedActions = [];
  const budgetUsage = {
    ticks: 0,
    nodes: 0,
    actions: 0,
    wallTimeMs: 0
  };
  const targetSaveCount = Math.max(0, toInteger(options.targetSaveCount, runner.needCount || 1));
  let nextActionIndex = 0;

  const timeout = () => createReplayResult({
    resultType: SOLVER_RESULT_TYPES.TIMEOUT,
    summary: `Replay budget exhausted at tick ${budgetUsage.ticks}`,
    actions,
    explanations: [SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED],
    budgetUsage,
    runner,
    appliedActions
  });

  const checkFinalPostconditions = () => {
    for (const item of actionQueue) {
      const failed = firstFailedCondition(item.action.expectedPostconditions, runner, item.action);
      if (failed) {
        return createReplayFailure({
          summary: `Replay diverged after ${budgetUsage.ticks} ticks`,
          detail: failed.detail,
          actions,
          budgetUsage,
          runner,
          appliedActions
        });
      }
    }
    return null;
  };

  while (true) {
    while (nextActionIndex < actionQueue.length) {
      const item = actionQueue[nextActionIndex];
      if (runner.tick < item.start) break;
      if (runner.tick > item.end) {
        return createReplayFailure({
          summary: `Replay missed action ${item.index} at tick ${runner.tick}`,
          detail: `Action window ${item.start}-${item.end} expired`,
          actions,
          budgetUsage,
          runner,
          appliedActions,
          code: SOLVER_EXPLANATION_CODES.TIMING_WINDOW_TOO_NARROW
        });
      }

      const failedPrecondition = firstFailedCondition(
        item.action.preconditions,
        runner,
        item.action
      );
      if (failedPrecondition) {
        if (!item.exact && runner.tick < item.end) break;
        return createReplayFailure({
          summary: `Replay precondition failed at tick ${runner.tick}`,
          detail: failedPrecondition.detail,
          actions,
          budgetUsage,
          runner,
          appliedActions
        });
      }

      budgetUsage.actions += 1;
      if (budgetUsage.actions > normalizedOptions.maxActions) return timeout();
      const applied = runner.applyAction(item.action);
      if (!applied.ok) {
        return createReplayFailure({
          summary: `Replay action failed at tick ${runner.tick}`,
          detail: applied.detail,
          actions,
          budgetUsage,
          runner,
          appliedActions
        });
      }
      appliedActions.push({
        index: item.index,
        tick: runner.tick,
        skillType: item.action.skillType,
        target: item.action.target,
        lemmingId: applied.lemmingId
      });
      nextActionIndex += 1;
    }

    if (runner.getSavedCount() >= targetSaveCount) {
      const postconditionFailure = checkFinalPostconditions();
      if (postconditionFailure) return postconditionFailure;
      if (created.sourceKind !== SYNTHETIC_RUNNER_KIND && runner.isRuntimeAuthoritative === false) {
        return createReplayResult({
          resultType: SOLVER_RESULT_TYPES.UNKNOWN,
          summary: `${created.sourceKind} replay reached the save target without an authoritative runtime adapter`,
          actions,
          explanations: [{
            code: SOLVER_EXPLANATION_CODES.MISSING_RUNTIME_ADAPTER,
            detail: 'Non-synthetic solved results require authoritative runtime replay.'
          }],
          budgetUsage,
          runner,
          appliedActions
        });
      }
      return createReplayResult({
        resultType: SOLVER_RESULT_TYPES.SOLVED,
        summary: `Replay solved ${runner.kind || 'runner'} ${runner.id || ''} in ${budgetUsage.ticks} ticks`.trim(),
        actions,
        budgetUsage,
        runner,
        appliedActions
      });
    }

    if (runner.isTerminal()) {
      return createReplayFailure({
        summary: `Replay failed to save ${targetSaveCount} lemming(s)`,
        detail: `Saved ${runner.getSavedCount()} of ${targetSaveCount}`,
        actions,
        budgetUsage,
        runner,
        appliedActions,
        code: SOLVER_EXPLANATION_CODES.SAVE_COUNT_UNREACHABLE
      });
    }

    if (
      budgetUsage.ticks >= normalizedOptions.maxTicks ||
      budgetUsage.nodes >= normalizedOptions.maxNodes
    ) {
      return timeout();
    }

    runner.step();
    budgetUsage.ticks += 1;
    budgetUsage.nodes += 1;
  }
};

export {
  DelegatingRuntimeSolverRunner,
  RuntimeGameSolverRunner,
  SyntheticSolverRunner,
  createBuiltInLevelRunner,
  createEditorLevelRunner,
  createProcgenChunkRunner,
  createRunnerFromSource,
  createRunnerFromSyntheticFixture,
  createSyntheticRunner,
  verifyActionReplay
};
