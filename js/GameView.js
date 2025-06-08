import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';
import './KeyboardShortcuts.js';
import { createCrosshairFrame } from './CrosshairCursor.js';

class GameView extends Lemmings.BaseLogger {
  constructor() {
    super();
    this.gameType = null;
    this.levelIndex = 0;
    this.levelGroupIndex = 0;
    this.gameResources = null;
    this.game = null;
    this.gameFactory = new Lemmings.GameFactory('./');
    this.stage = null;
    this.gameSpeedFactor = 1;
    this.bench = false; // just keep spawning lems
    this.benchSequence = false;
    this._benchMeasureExtras = false;
    this.endless = false; // time doesn't run out, game doesn't end
    this.nukeAfter = 0; // nuke after x seconds
    this.scale = 0; // zoom 
    this.laggedOut = 0;
    this.extraLemmings = 0;
    this.perfMetrics = false;
    this.steps = 0;
    this._benchMonitor = null;
    this._benchSpeedTrack = null;
    this._benchMaxSpeed = 0;
    this._benchCounts = [];
    this._benchIndex = 0;
    this._benchExtraList = null;
    this._benchExtraIndex = 0;
    this._benchStartTime = 0;
    this._benchBaseEntrances = null;
    this._benchEntrancePool = null;
    this.cheatEnabled = false;
    this.applyQuery();
    this.elementGameState = null;
    this.autoMoveTimer = null;
    this.resumeTimer = null;
    this.elementSelectGameType = null;
    this.elementSelectLevelGroup = null;
    this.elementSelectLevel = null;
    this.configs = null;
    this.shortcuts = new Lemmings.KeyboardShortcuts(this);

    this.log.log('selected level: ' + Lemmings.GameTypes.toString(this.gameType) + ' : ' + this.levelIndex + ' / ' + this.levelGroupIndex);
  }

  set gameCanvas(el) {
    if (this.stage && this.stage.dispose) {
      window.removeEventListener('resize', this._stageResize);
      window.removeEventListener('orientationchange', this._stageResize);
      this.stage.dispose();
    }
    this.stage = new Lemmings.Stage(el);
    this._stageResize = () => this.stage.updateStageSize();
    window.addEventListener('resize', this._stageResize);
    window.addEventListener('orientationchange', this._stageResize);
    this._stageResize();
  }

  /** start or continue the game */
  async start(replayString) {
    if (!this.gameFactory) return;
    if (this.game != null) {
      this.continue();
      return;
    }
    try {
      const game = await this.gameFactory.getGame(this.gameType, this.gameResources);
      await game.loadLevel(this.levelGroupIndex, this.levelIndex);
      if (replayString != null) {
        game.getCommandManager().loadReplay(replayString);
      }
      game.setGameDisplay(this.stage.getGameDisplay());
      game.setGuiDisplay(this.stage.getGuiDisplay());
      game.getGameTimer().speedFactor = this.gameSpeedFactor;
      // Display a custom crosshair cursor sized relative to a lemming
      this.stage.setCursorSprite(createCrosshairFrame(24));
      game.start();
      this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes.toString(Lemmings.GameStateTypes.RUNNING));
      game.onGameEnd.on(state => this.onGameEnd(state));
      this.game = game;
      if (this.cheatEnabled) this.game.cheat();
      if (this.debug) this.game.showDebug = true;
    } catch (e) {
      this.log.log('Error starting game:', e);
    }
  }

  onGameEnd(gameResult) {
    this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes.toString(gameResult.state));
    this.stage.startFadeOut();
    console.dir(gameResult);
    this.autoMoveTimer = window.setTimeout(() => {
      if (gameResult.state == Lemmings.GameStateTypes.SUCCEEDED) {
        /// move to next level
        this.moveToLevel(1);
      } else {
        /// redo this level
        this.moveToLevel(0);
      }
      this.autoMoveTimer = null;
    }, 2500);
  }

  async loadReplay(replayString) {
    await this.start(replayString);
  }

  cheat() {
    if (this.game == null) {
      return;
    }
    this.game.cheat();
  }

  suspend() {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().suspend();
  }

  suspendWithColor(color) {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().suspend();
    if (this.stage?.startOverlayFade) {
      let rect = null;
      if (this.bench) {
        const gui = this.stage.guiImgProps;
        const scale = gui.viewPoint.scale;
        rect = {
          x: gui.x + 160 * scale,
          y: gui.y + 32 * scale,
          width: 16 * scale,
          height: 10 * scale
        };
      }
      this.stage.startOverlayFade(color, rect);
    }
    if (this.resumeTimer) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.resumeTimer = window.setTimeout(() => {
      if (this.game) this.game.getGameTimer().continue();
      this.resumeTimer = null;
    }, 2000);
  }

  continue () {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().continue();
  }

  nextFrame() {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().tick(1);
    this.game.render();
  }

  prevFrame() {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().tick(-1);
    this.game.render();
  }

  selectSpeedFactor(newSpeed) {
    if (this.game == null) {
      return;
    }
    this.gameSpeedFactor = newSpeed;
    this.game.getGameTimer().speedFactor = newSpeed;
  }

  playMusic(moveInterval) {

  }

  stopMusic() {

  }

  stopSound() {

  }

  playSound(moveInterval) {

  }

  enableDebug() {
    if (this.game == null) {
      return;
    }
    this.game.setDebugMode(true);
  }

  /** add/subtract one to the current levelIndex */
  async moveToLevel(moveInterval = 0) {
    if (this.levelIndex + moveInterval < 0 && this.levelGroupIndex == 0) return;
    if (this.inMoveToLevel) return;
    this.inMoveToLevel = true;
    this.levelIndex = (this.levelIndex + moveInterval) | 0;
    const oldGameType = this.gameType;
    try {
      const config = await this.gameFactory.getConfig(this.gameType);
      const groupLength = config.level.getGroupLength(this.levelGroupIndex);

      if (this.levelIndex >= groupLength) {
        this.levelGroupIndex++;
        this.levelIndex = 0;
      } else if (this.levelGroupIndex > 0 && this.levelIndex < 0) {
        this.levelGroupIndex--;
        this.levelIndex = groupLength - 1;
      } else if (this.levelGroupIndex == 0 && this.levelIndex < 0 && this.gameType > 1) {
        this.gameType--;
        this.levelGroupIndex = 0;
        this.levelIndex = 0;
      }
      if (this.levelGroupIndex >= config.level.order.length) {
        this.gameType++;
        this.levelGroupIndex = 0;
        this.levelIndex = 0;
      }
      if ((this.levelIndex < 0) && (this.levelGroupIndex > 0)) {
        this.levelGroupIndex--;
        this.levelIndex = groupLength - 1;
      }
      if (!Lemmings.GameTypes[Object.keys(Lemmings.GameTypes)[this.gameType]]) {
        this.gameType = 1;
        this.levelGroupIndex = 0;
        this.levelIndex = 0;
      }
      if (oldGameType !== this.gameType) {
        this.gameResources = await this.gameFactory.getGameResources(this.gameType);
      }
      await this.loadLevel();
    } finally {
      this.inMoveToLevel = false;
    }
  }
  /** helper to parse a numeric query value */
  parseNumber(query, names, def, min, max, multiplier = 1) {
    for (const name of names) {
      const raw = query.get(name);
      if (raw !== null) {
        const val = parseFloat(raw);
        if (!isNaN(val) && val >= min && val <= max) {
          return val * multiplier;
        }
      }
    }
    return def;
  }

  /** helper to parse a boolean query value */
  parseBool(query, names, def = false) {
    for (const name of names) {
      if (query.has(name)) {
        return query.get(name) === 'true';
      }
    }
    return def;
  }

  /** convert a string to a number or return 0 if NaN */
  strToNum(value) {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }

  /** read parameters from the current URL */
  applyQuery() {
    this.gameType = 1;
    const query = typeof window === 'undefined'
      ? new URLSearchParams('')
      : new URLSearchParams(window.location.search);
    this.gameType = this.parseNumber(query, ['version', 'v'], 1, 1, 6);
    this.levelGroupIndex = this.parseNumber(query, ['difficulty', 'd'], 1, 1, 5) - 1;
    this.levelIndex = this.parseNumber(query, ['level', 'l'], 1, 1, 30) - 1;
    this.gameSpeedFactor = this.parseNumber(query, ['speed', 's'], 1, 0, 100);
    // values above normal correspond to discrete steps
    if (this.gameSpeedFactor > 1) {
      this.gameSpeedFactor = Math.round(this.gameSpeedFactor);
    }
    this.cheatEnabled = this.parseBool(query, ['cheat', 'c']);
    this.debug = this.parseBool(query, ['debug', 'dbg']);
    this.bench = this.parseBool(query, ['bench', 'b']);
    this.benchSequence = this.parseBool(query, ['benchSequence', 'bs']);
    this.endless = this.parseBool(query, ['endless', 'e']);
    this.nukeAfter = this.parseNumber(query, ['nukeAfter', 'na'], 0, 1, 60, 10);
    this.extraLemmings = this.parseNumber(query, ['extra', 'ex'], 0, 1, 1000);
    this.scale = this.parseNumber(query, ['scale', 'sc'], 0, 0.0125, 8);
    this.laggedOut = 0;
        
    this.shortcut = false;
    if (query.get('shortcut') || query.get('_')) {
      this.shortcut = (query.get('shortcut') || query.get('_')) === 'true';
    }
    this.perfMetrics = false;
    if (query.get('perfMetrics') || query.get('pm')) {
      this.perfMetrics = (query.get('perfMetrics') || query.get('pm')) === 'true';
    }
  }
  updateQuery() {
    const params = typeof window === 'undefined'
      ? new URLSearchParams('')
      : new URLSearchParams(window.location.search);
    const setParam = (longName, shortName, value, def, always) => {
      params.delete(longName);
      params.delete(shortName);
      if (always || (value !== undefined && value !== def)) {
        params.set(this.shortcut ? shortName : longName, value);
      }
    };

    // main game state should always remain visible
    setParam('version', 'v', this.gameType, undefined, true);
    setParam('difficulty', 'd', this.levelGroupIndex + 1, undefined, true);
    setParam('level', 'l', this.levelIndex + 1, undefined, true);
    setParam('speed', 's', this.gameSpeedFactor, undefined, true);
    setParam('cheat', 'c', this.cheatEnabled, undefined, true);

    // optional flags only appear when non-default
    setParam('debug', 'dbg', this.debug, false);
    setParam('bench', 'b', this.bench, false);
    setParam('benchSequence', 'bs', this.benchSequence, false);
    setParam('endless', 'e', this.endless, false);
    setParam('nukeAfter', 'na', this.nukeAfter ? this.nukeAfter / 10 : undefined);
    setParam('extra', 'ex', this.extraLemmings, 0);
    setParam('scale', 'sc', this.scale, 0);

    if (this.shortcut) {
      params.set('_', true);
    } else {
      params.delete('_');
    }

    this.setHistoryState(params);
  }
  setHistoryState(params) {
    const query = params instanceof URLSearchParams ? params : new URLSearchParams(params);
    history.replaceState(null, null, '?' + query.toString());
  }
  /** change the the text of a html element */
  changeHtmlText(htmlElement, value) {
    if (htmlElement == null) {
      return;
    }
    htmlElement.innerText = value;
  }
  /** prefix items with an increasing index */
  prefixNumbers(list) {
    return list.map((item, idx) => `${idx + 1} - ${item}`);
  }

  /** convert select values to integers */
  strToNum(str) {
    const n = parseInt(str, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  /** remove items of a <select> */
  clearHtmlList(htmlList) {
    while (htmlList.options.length) {
      htmlList.remove(0);
    }
  }
  /** add array elements to a <select> */
  arrayToSelect(htmlList, list) {
    if (htmlList == null) {
      return;
    }
    this.clearHtmlList(htmlList);
    for (let i = 0; i < list.length; i++) {
      const opt = list[i];
      const el = document.createElement('option');
      el.textContent = opt;
      el.value = i.toString();
      htmlList.appendChild(el);
    }
  }
  /** fill the level select with the names for the current group */
  async populateLevelSelect() {
    if (!this.elementSelectLevel || !this.gameResources) return;
    const config = await this.gameFactory.getConfig(this.gameType);
    const groupLength = config.level.getGroupLength(this.levelGroupIndex);
    const list = [];
    for (let i = 0; i < groupLength; i++) {
      const lvl = await this.gameResources.getLevel(this.levelGroupIndex, i);
      if (!lvl) continue;
      list.push((i + 1) + ': ' + lvl.name);
    }
    this.arrayToSelect(this.elementSelectLevel, list);
    this.elementSelectLevel.selectedIndex = this.levelIndex;
  }
  /** switch the selected level group */
  async selectLevelGroup(newLevelGroupIndex) {
    if (!this.gameResources) return;
    const groups = this.gameResources.getLevelGroups();
    const max = groups.length - 1;
    if (newLevelGroupIndex < 0) newLevelGroupIndex = 0;
    else if (newLevelGroupIndex > max) newLevelGroupIndex = max;
    this.levelGroupIndex = newLevelGroupIndex;
    this.levelIndex = 0;
    await this.populateLevelSelect();
    this.loadLevel();
  }
  /** switch the selected game type */
  async selectGameType(newGameType) {
    // dropdown values correspond to config array indices
    if (this.configs && this.configs[newGameType]) {
      newGameType = this.configs[newGameType].gametype;
    }
    this.gameType = newGameType;
    this.levelGroupIndex = 0;
    this.levelIndex = 0;
    const newGameResources = await this.gameFactory.getGameResources(this.gameType);
    this.gameResources = newGameResources;
    this.arrayToSelect(this.elementSelectLevelGroup, this.prefixNumbers(this.gameResources.getLevelGroups()));
    this.elementSelectLevelGroup.selectedIndex = this.levelGroupIndex;
    await this.populateLevelSelect();
    this.loadLevel();
  }
  /** select a specific level */
  selectLevel(newLevelIndex) {
    this.levelIndex = newLevelIndex;
    this.loadLevel();
  }
  /** select a game type */
  async setup() {
    this.applyQuery();
    this.configs = await this.gameFactory.configReader.configs;
    this.arrayToSelect(this.elementSelectGameType, this.configs.map(c => c.name));
    const typeIndex = this.configs.findIndex(c => c.gametype === this.gameType);
    if (typeIndex >= 0 && this.elementSelectGameType)
      this.elementSelectGameType.selectedIndex = typeIndex;
    const newGameResources = await this.gameFactory.getGameResources(this.gameType);
    this.gameResources = newGameResources;
    this.arrayToSelect(this.elementSelectLevelGroup, this.prefixNumbers(this.gameResources.getLevelGroups()));
    this.elementSelectLevelGroup.selectedIndex = this.levelGroupIndex;
    await this.populateLevelSelect();
    await this.loadLevel();
    if (this.benchSequence) {
      await this.benchSequenceStart();
    }
  }
  /** load a level and render it to the display */
  async loadLevel() {
    if (this.autoMoveTimer !== null) {
      window.clearTimeout(this.autoMoveTimer);
      this.autoMoveTimer = null;
    }
    if (!this.gameResources) return;
    if (this.game) {
      this.game.stop();
      this.game = null;
    }
    this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes[Lemmings.GameStateTypes.UNKNOWN]);
    const level = await this.gameResources.getLevel(this.levelGroupIndex, this.levelIndex);
    if (!level) return;
    if (this.elementSelectGameType && this.configs) {
      const idx = this.configs.findIndex(c => c.gametype === this.gameType);
      if (idx >= 0) this.elementSelectGameType.selectedIndex = idx;
    }
    if (this.elementSelectLevelGroup) this.elementSelectLevelGroup.selectedIndex = this.levelGroupIndex;
    if (this.elementSelectLevel) this.elementSelectLevel.selectedIndex = this.levelIndex;
    if (this.stage) {
      const gameDisplay = this.stage.getGameDisplay();
      gameDisplay.clear();
      this.stage.resetFade();
      level.render(gameDisplay);
      gameDisplay.setScreenPosition(level.screenPositionX, 0);
      this.stage.updateStageSize();
      gameDisplay.redraw();
    }
    this.updateQuery();
    this.log.debug(level);
    return this.start();
  }

  async benchStart(entrances) {
    this.bench = true;
    this._benchMeasureExtras = false;
    await this.loadLevel();
    const level = this.game.level;
    const cfg = this.configs?.find(c => c.gametype === this.gameType);
    const pack = cfg?.name || this.gameType;
    const group = this.gameResources.getLevelGroups()[this.levelGroupIndex];
    const lvlName = level.name ? level.name.trim() : '';
    console.log(`starting bench series for ${lvlName} in ${group} in ${pack}, adding ${entrances} entrances with ${this.extraLemmings} extra lemmings`);

    if (!this._benchBaseEntrances) {
      this._benchBaseEntrances = level.entrances.slice();
    }
    level.entrances.length = 0;
    const baseEntrances = this._benchBaseEntrances;
    const groundMask = level.getGroundMaskLayer();
    const badTriggers = new Set([
      Lemmings.TriggerTypes.DROWN,
      Lemmings.TriggerTypes.FRYING,
      Lemmings.TriggerTypes.KILL,
      Lemmings.TriggerTypes.TRAP,
    ]);

    const increments = [100, 50, 25, 12, 6];
    const SEGMENT_DURATION = 2;
    const ENTRANCE_HEIGHT = 28;
    const SPAWN_OFFSET_Y = 14;
    const SAFE_ENTRANCE_DROP = Lemmings.Lemming.LEM_MAX_FALLING - SPAWN_OFFSET_Y;

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
        if (spawnX < tr.x1 || spawnX > tr.x2) continue;
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
        if (timer.speedFactor < 1) {
          timer.eachGameSecond.off(this._benchMonitor);
          timer.eachGameSecond.off(this._benchSpeedTrack);
          timer.suspend();
          const count = this.game.getLemmingManager().getLemmings().length;
          const tps = (this._benchMaxSpeed * (1000 / timer.TIME_PER_FRAME_MS)).toFixed(1);
          console.log(`series finished for ${entrances} entrances - ${count} lemmings - ${this._benchMaxSpeed.toFixed(1)} highest speed achieved (${tps} ticks per second)`);
          return;
        }
        if (timer.getGameTime() - this._benchStartTime >= SEGMENT_DURATION) {
          timer.eachGameSecond.off(this._benchMonitor);
          timer.eachGameSecond.off(this._benchSpeedTrack);
          timer.suspend();
          const next = entrances + 1;
          await this.benchStart(next);
        }
      };
      timer.eachGameSecond.on(this._benchMonitor);
    }
  }

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
          lemmings.extraLemmings = extras;
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
  }

  async benchSequenceStart() {
    this._benchCounts = [1];
    this._benchIndex = 0;
    const extras = await this.benchMeasureExtras();
    this._benchExtraList = [extras, Math.floor(extras / 2), 0];
    this._benchExtraIndex = 0;
    this._benchBaseEntrances = null;
    this._benchEntrancePool = null;
    this.extraLemmings = this._benchExtraList[0];
    lemmings.extraLemmings = this.extraLemmings;
    await this.benchStart(this._benchCounts[0]);
  }

  /** cleanup keyboard and stage handlers */
  dispose() {
    if (this.shortcuts) {
      this.shortcuts.dispose();
      this.shortcuts = null;
    }
    if (this.stage && this.stage.dispose) {
      window.removeEventListener('resize', this._stageResize);
      window.removeEventListener('orientationchange', this._stageResize);
      this.stage.dispose();
      this.stage = null;
    }
  }
}
Lemmings.GameView = GameView;

export { GameView };
