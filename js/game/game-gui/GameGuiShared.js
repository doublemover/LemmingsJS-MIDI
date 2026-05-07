import { CommandNuke } from '../../commands/CommandNuke.js';
import { CommandReleaseRateIncrease } from '../../commands/CommandReleaseRateIncrease.js';
import { CommandReleaseRateDecrease } from '../../commands/CommandReleaseRateDecrease.js';
import { CommandSelectSkill } from '../../commands/CommandSelectSkill.js';
import { EventHandler } from '../../util/EventHandler.js';
import { MiniMap } from '../../render/MiniMap.js';
import { SkillTypes } from '../SkillTypes.js';
import { getDependency, getAppContext } from '../../core/dependencies.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../../util/performanceInstrumentation.js';

const getApp = () => {
  const app = getAppContext();
  if (app) return app;
  return null;
};
const formatSkillLabel = (key) => (
  key ? (key.charAt(0) + key.slice(1).toLowerCase()) : ''
);
const SKILL_KEYS = Object.freeze(Object.keys(SkillTypes));
const SKILL_COUNT = SKILL_KEYS.length;
const SKILL_LABELS = Object.freeze(SKILL_KEYS.map(formatSkillLabel));
class SmoothScroller {
  static minZoom = 0.25;
  static maxZoom = 8;

  constructor() {
    this.velocity = 0;     // pixels/frame (or units/frame)
    this.friction = 0.99;
    this.minVelocity = 0.7;       //0.0175;
    this._lastVelocity = 0;

    this.onHasVelocity = new EventHandler();
  }

  hasVelocity() {
    if (this.velocity < this.minVelocity || this.velocity === 0) {
      return false;
    }
    return true;
  }

  // call this whenever a wheel event fires:
  addImpulse(delta) {
    if (delta === 0) {
      console.log('error: trying to add 0 impulse');
      return;
    }
    if (delta > 50) {
      delta = 50;
    }
    if (delta < -50) {
      delta = -50;
    }

    if (this.velocity + delta > 500) {
      this.velocity = 500;
      return;
    }

    if (this.velocity + delta < -500) {
      this.velocity = -500;
      return;
    }

    this.velocity += delta;
  }

  update() {
    // decay the velocity:
    this.velocity = this.velocity * this.friction;


    // stop if below threshold:
    if (Math.abs(this.velocity) < this.minVelocity) {
      this.velocity = 0;
      if (this._lastVelocity !== 0) {
        this._lastVelocity = 0;
        this.onHasVelocity.trigger(this.velocity);
      }
      return;
    }
    this._lastVelocity = this.velocity;
    this.onHasVelocity.trigger(this.velocity);
  }
}

export {
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
};
