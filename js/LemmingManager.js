import { Lemmings } from './LemmingsNamespace.js';

class LemmingManager {
        constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable) {
            this.level = level;
            this.triggerManager = triggerManager;
            this.gameVictoryCondition = gameVictoryCondition;
            /** list of all Lemming in the game */
            this.lemmings = [];
            /** list of all Actions a Lemming can do */
            this.actions = [];
            this.skillActions = [];
            this.releaseTickIndex = 0;
            this.logging = new Lemmings.LogHandler("LemmingManager");
            this.miniMap = null; 
            this.mmTickCounter = 0; 
            /** next lemming index need to explode */
            this.nextNukingLemmingsIndex = -1;
            this.actions[Lemmings.LemmingStateType.WALKING] = new Lemmings.ActionWalkSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.FALLING] = new Lemmings.ActionFallSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.JUMPING] = new Lemmings.ActionJumpSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.DIGGING] = new Lemmings.ActionDiggSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.EXITING] = new Lemmings.ActionExitingSystem(lemmingsSprite, gameVictoryCondition);
            this.actions[Lemmings.LemmingStateType.FLOATING] = new Lemmings.ActionFloatingSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.BLOCKING] = new Lemmings.ActionBlockerSystem(lemmingsSprite, triggerManager);
            this.actions[Lemmings.LemmingStateType.MINING] = new Lemmings.ActionMineSystem(lemmingsSprite, masks);
            this.actions[Lemmings.LemmingStateType.CLIMBING] = new Lemmings.ActionClimbSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.HOISTING] = new Lemmings.ActionHoistSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.BASHING] = new Lemmings.ActionBashSystem(lemmingsSprite, masks);
            this.actions[Lemmings.LemmingStateType.BUILDING] = new Lemmings.ActionBuildSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.SHRUG] = new Lemmings.ActionShrugSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.EXPLODING] = new Lemmings.ActionExplodingSystem(lemmingsSprite, masks, triggerManager, particleTable);
            this.actions[Lemmings.LemmingStateType.OHNO] = new Lemmings.ActionOhNoSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.SPLATTING] = new Lemmings.ActionSplatterSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.DROWNING] = new Lemmings.ActionDrowningSystem(lemmingsSprite);
            this.skillActions[Lemmings.SkillTypes.DIGGER] = this.actions[Lemmings.LemmingStateType.DIGGING];
            this.skillActions[Lemmings.SkillTypes.FLOATER] = this.actions[Lemmings.LemmingStateType.FLOATING];
            this.skillActions[Lemmings.SkillTypes.BLOCKER] = this.actions[Lemmings.LemmingStateType.BLOCKING];
            this.skillActions[Lemmings.SkillTypes.MINER] = this.actions[Lemmings.LemmingStateType.MINING];
            this.skillActions[Lemmings.SkillTypes.CLIMBER] = this.actions[Lemmings.LemmingStateType.CLIMBING];
            this.skillActions[Lemmings.SkillTypes.BASHER] = this.actions[Lemmings.LemmingStateType.BASHING];
            this.skillActions[Lemmings.SkillTypes.BUILDER] = this.actions[Lemmings.LemmingStateType.BUILDING];
            this.skillActions[Lemmings.SkillTypes.BOMBER] = new Lemmings.ActionCountdownSystem(masks);
            /// wait before first lemming is spawn
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
            let lems = this.lemmings;
            if (this.isNuking()) {
                this.doLemmingAction(lems[this.nextNukingLemmingsIndex], Lemmings.SkillTypes.BOMBER);
                // check that we don't increment past the number of lemmings
                //  this can freeze the game on really long nukes
                if (this.nextNukingLemmingsIndex + 1 >= lems.length) {
                    this.nextNukingLemmingsIndex = -1;
                } else {
                    this.nextNukingLemmingsIndex++;
                }
            }
            for (let i = 0; i < lems.length; i++) {
                let lem = lems[i];
                if (lem.removed)
                    continue;
                let newAction = lem.process(this.level);
                this.processNewAction(lem, newAction);
                let triggerAction = this.runTrigger(lem);
                this.processNewAction(lem, triggerAction);
            }
            if (this.miniMap && ((++this.mmTickCounter % 10) === 0)) {
                const dots = this.lemmings.filter(l => !l.removed && !l.disabled).map(l => ({ x: l.x, y: l.y }));
                this.miniMap.setLiveDots(dots);
            }
        }
        /** Add a new Lemming to the manager */
        addLemming(x, y) {
            let lem = new Lemmings.Lemming(x, y, this.lemmings.length);
            this.setLemmingState(lem, Lemmings.LemmingStateType.FALLING);
            this.lemmings.push(lem);
        }
        /** let a new lemming arise from an entrance */
        addNewLemmings() {
            if (this.gameVictoryCondition.getLeftCount() <= 0) {
                return;
            }
            this.releaseTickIndex++;
            if (this.releaseTickIndex >= (104 - this.gameVictoryCondition.getCurrentReleaseRate())) {
                this.releaseTickIndex = 0;
                for (let i = 0; i < this.level.entrances.length; i++) {
                    let entrance = this.level.entrances[i];
                    this.addLemming(entrance.x + 24, entrance.y + 14);
                    this.gameVictoryCondition.releaseOne();
                }
            }
        }
        runTrigger(lem) {
            if (lem.isRemoved() || (lem.isDisabled())) {
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
            let triggerType = this.triggerManager.trigger(lem.x, lem.y);
            switch (triggerType) {
            case Lemmings.TriggerTypes.NO_TRIGGER:
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            case Lemmings.TriggerTypes.DROWN:
                return Lemmings.LemmingStateType.DROWNING;
            case Lemmings.TriggerTypes.EXIT_LEVEL:
                return Lemmings.LemmingStateType.EXITING;
            case Lemmings.TriggerTypes.KILL:
                return Lemmings.LemmingStateType.SPLATTING;
            case Lemmings.TriggerTypes.TRAP:
                return Lemmings.LemmingStateType.SPLATTING;
            case Lemmings.TriggerTypes.BLOCKER_LEFT:
                if (lem.lookRight)
                    lem.lookRight = false;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            case Lemmings.TriggerTypes.BLOCKER_RIGHT:
                if (!lem.lookRight)
                    lem.lookRight = true;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            default:
                this.logging.log("unknown trigger type: " + triggerType);
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
        }
        /** render all Lemmings to the GameDisplay */
        render(gameDisplay) {
            let lems = this.lemmings;
            for (let i = 0; i < lems.length; i++) {
                lems[i].render(gameDisplay);
            }
        }
        /** render all Lemmings to the GameDisplay */
        renderDebug(gameDisplay) {
            let lems = this.lemmings;
            for (let i = 0; i < lems.length; i++) {
                lems[i].renderDebug(gameDisplay);
            }
        }
        /** return the lemming with a given id */
        getLemming(id) {
            return this.lemmings[id];
        }
        /** return a lemming a a given position */
        getLemmingAt(x, y) {
            let lems = this.lemmings;
            let minDistance = 99999;
            let minDistanceLem = null;
            for (let i = 0; i < lems.length; i++) {
                let lem = lems[i];
                if (lem.removed || lem.isDisabled()) {
                    continue;
                }
                let distance = lem.getClickDistance(x, y);
                //console.log("--> "+ distance);
                if ((distance < 0) || (distance >= minDistance)) {
                    continue;
                }
                minDistance = distance;
                minDistanceLem = lem;
            }
            //console.log("====> "+ (minDistanceLem? minDistanceLem.id : "null"));
            return minDistanceLem;
        }
        /** change the action a Lemming is doing */
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
            let actionSystem = this.actions[stateType];
            if (actionSystem == null) {
                lem.remove();
                this.logging.log(lem.id + " Action: Error not an action: " + Lemmings.LemmingStateType[stateType]);
                return;
            } else {
                this.logging.debug(lem.id + " Action: " + actionSystem.getActionName());
            }
            lem.setAction(actionSystem);
        }
        /** change the action a Lemming is doing */
        doLemmingAction(lem, skillType) {
            if (lem == null) {
                return false;
            }
            const actionSystem = this.skillActions[skillType];
            if (!actionSystem) {
                this.logging.log(lem.id + " Unknown Action: " + skillType);
                return false;
            }

            const redundant = {
                [Lemmings.SkillTypes.BLOCKER] : Lemmings.ActionBlockerSystem,
                [Lemmings.SkillTypes.DIGGER]  : Lemmings.ActionDiggSystem,
                [Lemmings.SkillTypes.MINER]   : Lemmings.ActionMineSystem
            };

            const AlreadyDoingIt =
                redundant[skillType] && (lem.action instanceof redundant[skillType]);

            if (AlreadyDoingIt) {
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
        /** return if the game is in nuke state */
        isNuking() {
            return this.nextNukingLemmingsIndex >= 0;
        }
        /** start the nuking of all lemmings */
        doNukeAllLemmings() {
            this.nextNukingLemmingsIndex = 0;
        }
    }
    Lemmings.LemmingManager = LemmingManager;

export { LemmingManager };
