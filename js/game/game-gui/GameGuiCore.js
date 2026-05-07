import {
  CommandNuke,
  CommandReleaseRateDecrease,
  CommandReleaseRateIncrease,
  CommandSelectSkill,
  EventHandler,
  MiniMap,
  SKILL_COUNT,
  SKILL_KEYS,
  SKILL_LABELS,
  SkillTypes,
  SmoothScroller,
  canMeasurePerformance,
  formatSkillLabel,
  getApp,
  getAppContext,
  getDependency,
  recordPerformanceMeasure
} from './GameGuiShared.js';
import { gameGuiInputMethods } from './GameGuiInput.js';
import { gameGuiRenderMethods } from './GameGuiRender.js';
class GameGui {
  constructor(game, skillPanelSprites, skills, gameTimer, gameVictoryCondition) {
    /* external handles */
    this.game                 = game;
    this.skillPanelSprites    = skillPanelSprites;
    this.skills               = skills;
    this.gameTimer            = gameTimer;
    this.gameVictoryCondition = gameVictoryCondition;

    /* change-tracking flags (original names) */
    this.gameTimeChanged       = true;
    this.skillsCountChanged    = true;
    this.skillSelectionChanged = true;
    this.backgroundChanged     = true;
    this.releaseRateChanged    = true;

    this.nukePrepared          = false;
    this.lastGameSpeed      = 0;

    /* sprite caches */
    this._panelSprite    = skillPanelSprites.getPanelSprite();
    this._numLeftCache   = new Array(10);
    this._numRightCache  = new Array(10);
    this._numEmptySprite = skillPanelSprites.getNumberSpriteEmpty();
    this._letterCache    = new Map();

    /* runtime state */
    this.display          = null;
    this.miniMap          = null;
    this.deltaReleaseRate = 0;
    this._overlayHadContent = false;

    /* marching ants selection animation settings */
    this.selectionDashLen   = 4;   // length of dash segments (1px longer)
    this.selectionAnimDelay = 60;  // frames between offset increments (slower)
    this.selectionAnimStep  = 1;   // pixels per animation step
    this.selectionAnimIdleMultiplier = 2;
    this._selectionOffset   = 0;
    this._selectionCounter  = 0;
    this._lastAntPanel = Number.NaN;
    this._lastAntPaused = null;
    this._lastAntNukePrepared = null;
    this._lastAntHoverPanel = Number.NaN;
    this._lastAntOffset = Number.NaN;

    /* hover state */
    this._hoverPanelIdx   = -1;
    this._hoverSpeedUp    = false;
    this._hoverSpeedDown  = false;

    /* release rate lock state */
    this._rrLockMin = false;
    this._rrLockMax = false;

    this._guiBound = this._guiLoop.bind(this);
    this._guiRafId = 0;

    this.smoothScroller = new SmoothScroller();

    this._nukeAfterCountdown = 0;

    this._onEachGameSecond = () => {
      const app = getApp();
      this._applyReleaseRateAuto();
      if (app?.nukeAfter > 0) {
        this._nukeAfterCountdown++;
        if (this._nukeAfterCountdown >= app.nukeAfter) {
          this.game.queueCommand(new CommandNuke());
          this.nukePrepared = false;
          this._nukeAfterCountdown = 0;
        }
      }
      if ((Math.floor(this.gameTimer.getGameTime()) % 2) === 0) {
        this.backgroundChanged = true;
      }
      this.gameTimeChanged = true;

      this._requestGuiRender();
    };
    gameTimer.eachGameSecond.on(this._onEachGameSecond);

    this._onSkillCountChanged = () => {
      this.backgroundChanged = true;
    };
    skills.onCountChanged.on(this._onSkillCountChanged);

    this._onSkillSelectionChanged = () => {
      this.backgroundChanged = true;
      this._selectionOffset  = 0;
    };
    skills.onSelectionChanged.on(this._onSkillSelectionChanged);
  }
}
for (const methods of [
  gameGuiInputMethods,
  gameGuiRenderMethods
]) {
  Object.defineProperties(GameGui.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { GameGui };