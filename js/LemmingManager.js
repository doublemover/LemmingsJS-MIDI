import { Lemmings } from './LemmingsNamespace.js';

class LemmingManager {
        constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable) {
            this.level = level;
            this.triggerManager = triggerManager;
            this.gameVictoryCondition = gameVictoryCondition;
            this.lemmings = [];
            this.actions = [];
            this.skillActions = [];
            this.releaseTickIndex = 0;
            this.logging = new Lemmings.LogHandler("LemmingManager");
            this.miniMap = null;
            this._miniMapDots = []; 
            this.mmTickCounter = 0; 
            this.nextNukingLemmingsIndex = -1; // -1 = idle
            // --- action systems 
            this.actions[Lemmings.LemmingStateType.WALKING]    = new Lemmings.ActionWalkSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.FALLING]    = new Lemmings.ActionFallSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.JUMPING]    = new Lemmings.ActionJumpSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.DIGGING]    = new Lemmings.ActionDiggSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.EXITING]    = new Lemmings.ActionExitingSystem(lemmingsSprite, gameVictoryCondition);
            this.actions[Lemmings.LemmingStateType.FLOATING]   = new Lemmings.ActionFloatingSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.BLOCKING]   = new Lemmings.ActionBlockerSystem(lemmingsSprite, triggerManager);
            this.actions[Lemmings.LemmingStateType.MINING]     = new Lemmings.ActionMineSystem(lemmingsSprite, masks);
            this.actions[Lemmings.LemmingStateType.CLIMBING]   = new Lemmings.ActionClimbSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.HOISTING]   = new Lemmings.ActionHoistSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.BASHING]    = new Lemmings.ActionBashSystem(lemmingsSprite, masks);
            this.actions[Lemmings.LemmingStateType.BUILDING]   = new Lemmings.ActionBuildSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.SHRUG]      = new Lemmings.ActionShrugSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.EXPLODING]  = new Lemmings.ActionExplodingSystem(lemmingsSprite, masks, triggerManager, particleTable);
            this.actions[Lemmings.LemmingStateType.OHNO]       = new Lemmings.ActionOhNoSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.SPLATTING]  = new Lemmings.ActionSplatterSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.DROWNING]   = new Lemmings.ActionDrowningSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.FRYING]     = new Lemmings.ActionFryingSystem(lemmingsSprite);
            
            this.skillActions[Lemmings.SkillTypes.DIGGER]  = this.actions[Lemmings.LemmingStateType.DIGGING];
            this.skillActions[Lemmings.SkillTypes.FLOATER] = this.actions[Lemmings.LemmingStateType.FLOATING];
            this.skillActions[Lemmings.SkillTypes.BLOCKER] = this.actions[Lemmings.LemmingStateType.BLOCKING];
            this.skillActions[Lemmings.SkillTypes.MINER]   = this.actions[Lemmings.LemmingStateType.MINING];
            this.skillActions[Lemmings.SkillTypes.CLIMBER] = this.actions[Lemmings.LemmingStateType.CLIMBING];
            this.skillActions[Lemmings.SkillTypes.BASHER]  = this.actions[Lemmings.LemmingStateType.BASHING];
            this.skillActions[Lemmings.SkillTypes.BUILDER] = this.actions[Lemmings.LemmingStateType.BUILDING];
            this.skillActions[Lemmings.SkillTypes.BOMBER]  = new Lemmings.ActionCountdownSystem(masks);
            this.releaseTickIndex = this.gameVictoryCondition.getCurrentReleaseRate() - 30;
        }
        setMiniMap(miniMap) { 
            this.miniMap = miniMap; 
        }
        processNewAction(lem, newAction) {
            if (newAction == Lemmings.LemmingStateType.NO_STATE_TYPE) {
                return false;
            }
            this.setLemmingState(lem, newAction);
            return true;
        }

        /** process all Lemmings to the next time-step */
        tick() {
            this.addNewLemmings();
            const lems = this.lemmings;
            const count = lems.length;
            if (this.isNuking() && count) {
                this.doLemmingAction(lems[this.nextNukingLemmingsIndex], Lemmings.SkillTypes.BOMBER);
                if (this.nextNukingLemmingsIndex + 1 >= lems.length) {
                    this.nextNukingLemmingsIndex = -1;
                } else {
                    this.nextNukingLemmingsIndex++;
                }
            }
            for (let i = 0; i < count; i++) {
                const lem = lems[i];
                // Allow exploding animations to finish even if the lemming flagged itself removed early
                if (lem.removed && lem.action !== this.actions[Lemmings.LemmingStateType.EXPLODING]) {
                    continue;
                }
                const newAction = lem.process(this.level);
                this.processNewAction(lem, newAction);
                const triggerAction = this.runTrigger(lem);
                this.processNewAction(lem, triggerAction);
            }
            if (this.miniMap && ((++this.mmTickCounter % 10) === 0)) {
                const dots = this._miniMapDots;
                dots.length = 0;
                for (let i = 0; i < count; i++) {
                    const lem = lems[i];
                    const pos = { x: lem.x, y: lem.y };
                    if (!lem.removed && !lem.disabled && !dots.includes(pos)) {
                        dots.push(pos);
                    }
                }
                this.miniMap.setLiveDots(dots);
            }
        }
        /** Add a new Lemming to the manager */
        addLemming(x, y, extra = 0) {
            const lem = new Lemmings.Lemming(x, y, this.lemmings.length);
            this.setLemmingState(lem, Lemmings.LemmingStateType.FALLING);
            this.lemmings.push(lem);
            if (extra > 0) {
                for (let i = 0; i < 1*extra; i++) {
                    const lem2 = new Lemmings.Lemming(x, y, this.lemmings.length);
                    this.setLemmingState(lem2, Lemmings.LemmingStateType.FALLING);
                    this.lemmings.push(lem2);
                }
            }
        }
        /** let a new lemming arise from an entrance */
        addNewLemmings() {
            if (this.gameVictoryCondition.getLeftCount() <= 0) {
                return;
            }
            if (++this.releaseTickIndex >= (104 - this.gameVictoryCondition.getCurrentReleaseRate())) {
                this.releaseTickIndex = 0;
                const entrances = this.level.entrances;
                for (let i = 0, l = entrances.length; i < l; i++) {
                    const entrance = entrances[i];
                    this.addLemming(entrance.x + 24, entrance.y + 14);
                    this.gameVictoryCondition.releaseOne();
                }
            }
        }

        runTrigger(lem) {
            if (lem.isRemoved() || lem.isDisabled()) {
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
            const triggerType = this.triggerManager.trigger(lem.x, lem.y);
            switch (triggerType) {
            case Lemmings.TriggerTypes.NO_TRIGGER:
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            case Lemmings.TriggerTypes.DROWN:
                return Lemmings.LemmingStateType.DROWNING;
            case Lemmings.TriggerTypes.EXIT_LEVEL:
                return Lemmings.LemmingStateType.EXITING;
            case Lemmings.TriggerTypes.KILL:
                return Lemmings.LemmingStateType.SPLATTING;
            case Lemmings.TriggerTypes.FRYING:
                return Lemmings.LemmingStateType.FRYING;
            case Lemmings.TriggerTypes.TRAP:
                return Lemmings.LemmingStateType.SPLATTING;
            case Lemmings.TriggerTypes.BLOCKER_LEFT:
                if (lem.lookRight) lem.lookRight = false;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            case Lemmings.TriggerTypes.BLOCKER_RIGHT:
                if (!lem.lookRight) lem.lookRight = true;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            default:
                this.logging.log("unknown trigger type: " + triggerType);
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
        }


        render(gameDisplay) { for (const lem of this.lemmings) lem.render(gameDisplay);} 
        renderDebug(gameDisplay)  { for (const lem of this.lemmings) lem.renderDebug(gameDisplay);}

        getLemming(id) { return this.lemmings[id]; }
        getLemmings() { return this.lemmings; }

        getLemmingAt(x, y, radius = 6) {
          const halfW = radius;
          const halfH = radius * 2;
          for (const l of this.lemmings.toReversed()) {
    
            if (l.removed) continue;
            if (x >= l.x - halfW && x <= l.x + halfW && y >= l.y - halfH && y <= l.y + halfH) return l;
          }
          return null;
        }

        // returns all lemmings within a mask's offset bounds from x,y
        getLemmingsInMask(mask, x, y) {
            const out  = [];
            const lems = this.lemmings;
            const left   = x + mask.offsetX;
            const right  = left + mask.width;
            const top    = y + mask.offsetY;
            const bottom = top + mask.height;
            for (let i = 0, l = lems.length; i < l; ++i) {
                const val = lems[i];
                const lx = val.x;
                const ly = val.y;
                if (lx > left && lx < right && ly > top && ly < bottom) out.push(val);
            }
            return out;
        }
        
        setLemmingState(lem, stateType) {
            if (lem.countdown > 0) {
                const lethal =
                      stateType === Lemmings.LemmingStateType.DROWNING   ||  // water
                      stateType === Lemmings.LemmingStateType.SPLATTING  ||  // trap
                      stateType === Lemmings.LemmingStateType.FRYING;        // lava / fire
                if (lethal) {
                    lem.countdown        = 0;      // stop the timer
                    lem.countdownAction  = null;   // remove the overlay logic
                }
            }

            if (stateType == Lemmings.LemmingStateType.OUT_OF_LEVEL) {
                lem.remove();
                this.gameVictoryCondition.removeOne();
                return;
            }
            const actionSystem = this.actions[stateType];
            if (!actionSystem) {
                lem.remove();
                this.logging.log(lem.id + " Action: Error not an action: " + Lemmings.LemmingStateType[stateType]);
                return;
            } else {
                this.logging.debug(lem.id + " Action: " + actionSystem.getActionName());
            }
            lem.setAction(actionSystem);
        }

        doLemmingAction(lem, skillType) {
            if (!lem) return false;
            const actionSystem = this.skillActions[skillType];
            if (!actionSystem) {
                this.logging.log(lem.id + " Unknown Action: " + skillType);
                return false;
            }

            const canApplyWhileFalling = {
                [Lemmings.SkillTypes.FLOATER] : Lemmings.ActionFloatingSystem,
                [Lemmings.SkillTypes.CLIMBER] : Lemmings.ActionClimbSystem,
                [Lemmings.SkillTypes.BOMBER]  : this.skillActions[Lemmings.SkillTypes.BOMBER],
                [Lemmings.SkillTypes.BUILDER] : Lemmings.ActionBuildSystem
            };

            // if the lemming is falling
            if (lem.action == this.actions[Lemmings.LemmingStateType.FALLING]) {
                // only apply float/climb/build/bomb, prevents wasted actions
                if (!canApplyWhileFalling[skillType]) {
                    return false;
                }
            }

            const redundant = {
                [Lemmings.SkillTypes.BASHER]  : Lemmings.ActionBashSystem,
                [Lemmings.SkillTypes.BLOCKER] : Lemmings.ActionBlockerSystem,
                [Lemmings.SkillTypes.DIGGER]  : Lemmings.ActionDiggSystem,
                [Lemmings.SkillTypes.MINER]   : Lemmings.ActionMineSystem
            };

            const alreadyDoingIt =
                redundant[skillType] && (lem.action instanceof redundant[skillType]);

            if (alreadyDoingIt) {
                // Lemming is *already* performing this skill → no effect, no cost.
                return false;
            }

            const wasBlocking = (lem.action instanceof Lemmings.ActionBlockerSystem);

            // Fire the skill – returns true only if the switch really happens
            const ok = actionSystem.triggerLemAction(lem);

            // If it *was* a blocker and the player gave it a skill that should
            // cancel blocking immediately (everything except Bomber, Climber,
            // and Floater), delete the two “wall” triggers now.
            if (ok && wasBlocking) {
                const keepWall =
                    skillType === Lemmings.SkillTypes.BOMBER   ||   // keep until boom
                    skillType === Lemmings.SkillTypes.CLIMBER  ||   // flag-only skill
                    skillType === Lemmings.SkillTypes.FLOATER;      // flag-only skill

                if (!keepWall) {
                    this.triggerManager.removeByOwner(lem);
                }
            }
            return ok;
        }

        // nukes
        isNuking() { return this.nextNukingLemmingsIndex >= 0; }
        doNukeAllLemmings() { this.nextNukingLemmingsIndex = 0; }
    }
    Lemmings.LemmingManager = LemmingManager;

export { LemmingManager };
