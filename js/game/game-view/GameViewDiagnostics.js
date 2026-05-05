import {
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
} from './GameViewShared.js';
const gameViewDiagnosticsMethods = {
  async benchStart(entrances) {
    this.bench = true;
    this._benchMeasureExtras = false;
    await this.loadLevel();
    const level = this.game.level;
    if (this.stage) {
      this.applyLevelViewport(level);
    }
    const cfg = this.configs?.find(c => c.gametype === this.gameType);
    const pack = cfg?.name || this.gameType;
    const savedEntries = this._getSavedLevelEntries();
    const group = this._getGroupNames(savedEntries)[this.levelGroupIndex];
    const lvlName = level.name ? level.name.trim() : '';
    console.log(`starting bench series for ${lvlName} in ${group} in ${pack}, adding ${entrances} entrances with ${this.extraLemmings} extra lemmings`);
  
    if (!this._benchBaseEntrances) {
      this._benchBaseEntrances = level.entrances.slice();
    }
    level.entrances.length = 0;
    const baseEntrances = this._benchBaseEntrances;
    const groundMask = level.getGroundMaskLayer();
    const triggerTypes = getTriggerTypes();
    const badTriggers = new Set([
      triggerTypes.DROWN,
      triggerTypes.FRYING,
      triggerTypes.KILL,
      triggerTypes.TRAP,
    ]);
  
    const increments = [100, 50, 25, 12, 6];
    const SEGMENT_DURATION = 60;
    const ENTRANCE_HEIGHT = 28;
    const SPAWN_OFFSET_Y = 14;
    const SAFE_ENTRANCE_DROP = getLemmingCtor().LEM_MAX_FALLING - SPAWN_OFFSET_Y;
  
    const clearHeight = (x, y) => {
      if (y < 0 || y + ENTRANCE_HEIGHT > level.height) return false;
      for (let i = 0; i < ENTRANCE_HEIGHT; i++) {
        if (groundMask.hasGroundAt(x, y + i)) return false;
      }
      return true;
    };
  
    const findOpenSegment = x => {
      let best = null;
      let y = 0;
      while (y < level.height) {
        while (y < level.height && groundMask.hasGroundAt(x, y)) y++;
        const start = y;
        while (y < level.height && !groundMask.hasGroundAt(x, y)) y++;
        const end = y;
        if (end >= level.height) break;
        const h = end - start;
        if (h >= ENTRANCE_HEIGHT + 15 && (!best || h > best.height)) {
          best = { top: start, bottom: end, height: h };
        }
        y++; // skip ground
      }
      return best;
    };
  
    const trySpawn = spawnX => {
      if (spawnX < 0 || spawnX >= level.width) return false;
      const seg = findOpenSegment(spawnX);
      if (!seg) return false;
      const drop = Math.min(seg.height - ENTRANCE_HEIGHT, SAFE_ENTRANCE_DROP);
      if (drop < 15) return false;
      const entY = seg.bottom - ENTRANCE_HEIGHT - drop;
      if (!clearHeight(spawnX, entY)) return false;
  
      for (const tr of level.triggers) {
        if (!badTriggers.has(tr.type)) continue;
        if (spawnX < tr.x1 || spawnX >= tr.x2) continue;
        // disallow if entrance intersects or is above a deadly trigger
        if (entY + ENTRANCE_HEIGHT > tr.y1 && entY < tr.y2) return false;
        if (entY + ENTRANCE_HEIGHT <= tr.y1 && seg.bottom >= tr.y1) return false;
      }
  
      const entX = spawnX - 24;
      if (entX < 0 || entX >= level.width || entY < 0 || entY >= level.height) return false;
  
      for (const ent of level.entrances) {
        if (ent.x === entX && ent.y === entY) return false;
      }
  
      level.entrances.push({ x: entX, y: entY });
      return true;
    };
  
    if (!this._benchEntrancePool) {
      level.entrances = baseEntrances.slice();
      const target = Math.max(...this._benchCounts);
      for (const step of increments) {
        let offset = 0;
        while (level.entrances.length < target && offset <= level.width) {
          for (const base of baseEntrances) {
            if (level.entrances.length >= target) break;
            const center = base.x + 24;
            if (offset === 0) {
              trySpawn(center);
              continue;
            }
            trySpawn(center + offset);
            if (level.entrances.length >= target) break;
            trySpawn(center - offset);
          }
          offset += step;
        }
        if (level.entrances.length >= target) break;
      }
      this._benchEntrancePool = level.entrances.slice();
    } else {
      level.entrances = this._benchEntrancePool.slice();
    }
    if (entrances > level.entrances.length) {
      entrances = level.entrances.length;
    }
    level.entrances.length = entrances;
    if (this.game.getLemmingManager) {
      const lm = this.game.getLemmingManager();
      if (lm) lm.spawnCount = entrances;
    }
    const timer = this.game.getGameTimer();
    timer.speedFactor = 6;
    timer.benchStartupFrames = 120;
    timer.benchStableFactor = 8;
    this._benchStartTime = timer.getGameTime();
    if (this.benchSequence) {
      if (this._benchMonitor) timer.eachGameSecond.off(this._benchMonitor);
      if (this._benchSpeedTrack) timer.eachGameSecond.off(this._benchSpeedTrack);
      this._benchMaxSpeed = timer.speedFactor;
      this._benchSpeedTrack = () => {
        if (timer.speedFactor > this._benchMaxSpeed) this._benchMaxSpeed = timer.speedFactor;
      };
      timer.eachGameSecond.on(this._benchSpeedTrack);
      this._benchMonitor = async () => {
        if (timer.speedFactor < 1 ||
                timer.getGameTime() - this._benchStartTime >= SEGMENT_DURATION) {
          timer.eachGameSecond.off(this._benchMonitor);
          timer.eachGameSecond.off(this._benchSpeedTrack);
          timer.suspend();
          const count = this.game.getLemmingManager().getLemmings().length;
          const tps = (this._benchMaxSpeed * (1000 / timer.TIME_PER_FRAME_MS)).toFixed(1);
          console.log(`series finished for ${entrances} entrances - ${count} lemmings - ${this._benchMaxSpeed.toFixed(1)} highest speed achieved (${tps} ticks per second)`);
          this._benchIndex++;
          if (this._benchIndex >= this._benchCounts.length) {
            this._benchIndex = 0;
            if (this._benchExtraList && ++this._benchExtraIndex < this._benchExtraList.length) {
              this.extraLemmings = this._benchExtraList[this._benchExtraIndex];
            } else if (this._benchExtraList) {
              return;
            }
          }
          await this.benchStart(this._benchCounts[this._benchIndex]);
        }
      };
      timer.eachGameSecond.on(this._benchMonitor);
    }
  },

  async benchMeasureExtras() {
    this.bench = true;
    this._benchMeasureExtras = true;
    await this.loadLevel();
    const lm = this.game.getLemmingManager();
    if (lm) lm.spawnCount = this.game.level.entrances.length;
    const vc = this.game.getVictoryCondition();
    if (vc) vc.releaseRate = vc.getMinReleaseRate();
    const timer = this.game.getGameTimer();
    timer.speedFactor = 10;
    timer.benchStartupFrames = 120;
    timer.benchStableFactor = 2;
    let extras = 0;
    let prev = lm.spawnTotal;
    let spawned = 0;
    return new Promise(resolve => {
      const monitor = () => {
        const delta = lm.spawnTotal - prev;
        prev = lm.spawnTotal;
        spawned += delta / (extras + 1);
        while (spawned >= 10) {
          spawned -= 1;
          extras += 1;
          this.extraLemmings = extras;
        }
        if (timer.speedFactor < 1 || timer.getGameTime() >= 120) {
          timer.eachGameSecond.off(monitor);
          timer.suspend();
          this._benchMeasureExtras = false;
          console.log(`extra lemmings threshold reached at ${extras}`);
          resolve(extras);
        }
      };
      timer.eachGameSecond.on(monitor);
    });
  },

  async benchSequenceStart() {
    this._benchCounts = [50, 25, 10, 1];
    this._benchIndex = 0;
    const extras = await this.benchMeasureExtras();
    this._benchExtraList = [extras, Math.floor(extras / 2), 0];
    this._benchExtraIndex = 0;
    this._benchBaseEntrances = null;
    this._benchEntrancePool = null;
    this.extraLemmings = this._benchExtraList[0];
    await this.benchStart(this._benchCounts[0]);
  }
};
export { gameViewDiagnosticsMethods };