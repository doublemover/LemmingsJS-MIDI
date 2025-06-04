import { Lemmings } from './LemmingsNamespace.js';

class LemmingManager {
    constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable) {
        // const start = performance.now();
        this.lemmings = [];
        this.minimapDots = new Uint8Array(0);
        if (!LemmingManager.log) {
            LemmingManager.log = new Lemmings.LogHandler("LemmingManager");
        }
        this.level = level;
        this.triggerManager = triggerManager;
        this.gameVictoryCondition = gameVictoryCondition;
        this.actions = [];
        this.skillActions = [];
        this.releaseTickIndex = 0;
        this.logging = LemmingManager.log;
        this.miniMap = null;
        this.mmTickCounter = 0;
        this.nextNukingLemmingsIndex = -1;

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
        // performance.measure("LemmingManager constructor", { start, detail: { devtools: { track: "LemmingManager", trackGroup: "Game State", color: "primary", tooltipText: `LemmingManager constructor` } } });
    }

    setMiniMap(miniMap) {
        this.miniMap = miniMap;
    }

    processNewAction(lem, newAction) {
        if (newAction == Lemmings.LemmingStateType.NO_STATE_TYPE) return false;
        this.setLemmingState(lem, newAction);
        return true;
    }

    tick() {
        // const start = performance.now();
        this.addNewLemmings();
        const lems = this.lemmings;
        const count = lems.length;
        if (this.isNuking() && count) {
            this.doLemmingAction(lems[this.nextNukingLemmingsIndex], Lemmings.SkillTypes.BOMBER);
            if (this.nextNukingLemmingsIndex + 1 >= count) {
                this.nextNukingLemmingsIndex = -1;
            } else {
                this.nextNukingLemmingsIndex++;
            }
        }
        for (const lem of lems) {
            if (lem.removed && lem.action !== this.actions[Lemmings.LemmingStateType.EXPLODING]) continue;
            const newAction = lem.process(this.level);
            this.processNewAction(lem, newAction);
            const triggerAction = this.runTrigger(lem);
            this.processNewAction(lem, triggerAction);
        }
        if (lemmings.bench) {
            lemmings.laggedOut = count;
        }
        if (this.miniMap && ((++this.mmTickCounter % 10) === 0)) {
            const lemsCount = lems.length;
            const dots = new Uint8Array(lemsCount * 2);
            const visited = new Set();
            const scaleX = this.miniMap.scaleX;
            const scaleY = this.miniMap.scaleY;
            let idx = 0;
            for (const lem of lems) {
                if (lem.removed || lem.disabled) continue;
                const x = (lem.x * scaleX) | 0;
                const y = (lem.y * scaleY) | 0;
                const key = (y << 8) | x;
                if (visited.has(key)) continue;
                visited.add(key);
                dots[idx++] = x;
                dots[idx++] = y;
            }
            this.minimapDots = dots.subarray(0, idx);
            this.miniMap.setLiveDots(this.minimapDots);
        }
        // const tick = this.mmTickCounter;
        // performance.measure(`tick ${tick}`, { start, detail: { devtools: 
        //     { track: "LemmingManager", trackGroup: "Game State", color: "tertiary-dark", 
        //         properties: [["Lems", `${this.lemmings.length}`], ["Tick", `${tick}`]], 
        //         tooltipText: `tick ${tick} (${this.lemmings.length} lems)` } } });
    }

    addLemming(x, y) {
        // const start = performance.now();
        const startingLemLength = this.lemmings.length;
        const lem = new Lemmings.Lemming(x, y, startingLemLength);
        this.setLemmingState(lem, Lemmings.LemmingStateType.FALLING);
        this.lemmings.push(lem);
        if (lemmings.extraLemmings > 0) {
            for (let i = 0; i < 1 * lemmings.extraLemmings; i++) {
                const extraLem = new Lemmings.Lemming(x, y, startingLemLength+1+i);
                this.setLemmingState(extraLem, Lemmings.LemmingStateType.FALLING);
                this.lemmings.push(extraLem);
            }
        }
        // performance.measure(`addLemming ${this.lemmings.length}`, { start, detail: { devtools: { track: "LemmingManager", trackGroup: "Game State", color: "primary-light", properties: ["Position", `${x},${y}`], tooltipText: `addLemming ${this.lemmings.length}` } } });
    }

    addNewLemmings() {
        if (lemmings.bench == true) { // if bench is enabled just keep spawning lems by skipping gameVictoryCondition check
            
        } else {
            if (this.gameVictoryCondition.getLeftCount() <= 0) return;
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
            // this.lemmings.splice(this.lemmings.indexOf(lem), 1);
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
                if (this.miniMap) this.miniMap.addDeath(lem.x, lem.y);
                return Lemmings.LemmingStateType.OUT_OF_LEVEL;
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

    render(gameDisplay) {
        // const start = performance.now();
        for (const lem of this.lemmings) {
            lem.render(gameDisplay);
        }
        // performance.measure("render", { start, detail: { devtools: { track: "LemmingManager", trackGroup: "Render", color: "tertiary-dark", tooltipText: `render` } } });
    }

    renderDebug(gameDisplay) {
        for (const lem of this.lemmings) {
            lem.renderDebug(gameDisplay);
        }
    }

    getLemming(id) {
        return this.lemmings[id] ?? null;
    }

    getLemmings() {
        return this.lemmings;
    }

    getLemmingAt(x, y, radius = 6) {
        const halfW = radius;
        const halfH = radius * 2;
        for (const lem of this.lemmings) {
            if (lem.removed) continue;
            if (x >= lem.x - halfW && x <= lem.x + halfW && y >= lem.y - halfH && y <= lem.y + halfH) return lem;
        }
        return null;
    }

    getLemmingsInMask(mask, x, y) {
        const out = [];
        const lems = this.lemmings;
        const left = x + mask.offsetX;
        const right = left + mask.width;
        const top = y + mask.offsetY;
        const bottom = top + mask.height;
        for (const val of lems) {
            const lx = val.x;
            const ly = val.y;
            if (lx > left && lx < right && ly > top && ly < bottom) out.push(val);
        }
        return out;
    }

    setLemmingState(lem, stateType) {
        // const start = performance.now();
        if (lem.countdown > 0) {
            const lethal =
                stateType === Lemmings.LemmingStateType.DROWNING   ||
                stateType === Lemmings.LemmingStateType.SPLATTING  ||
                stateType === Lemmings.LemmingStateType.FRYING;
            if (lethal) {
                lem.countdown = 0;
                lem.countdownAction = null;
            }
        }
        if (stateType == Lemmings.LemmingStateType.OUT_OF_LEVEL) {
            lem.remove();
            this.gameVictoryCondition.removeOne();
            // performance.measure("removeOne", { start, detail: { devtools: { track: "LemmingManager", trackGroup: "Game State", color: "secondary-dark", tooltipText: `removeOne ${lem.id}` } } });
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
        // performance.measure(`${actionSystem.getActionName()}`, { start, detail: { devtools: { track: "LemmingManager", trackGroup: "Game State", color: "secondary-light", tooltipText: `setAction ${lem.id} ${actionSystem.getActionName()}` } } });
        lem.setAction(actionSystem);
    }

    doLemmingAction(lem, skillType) {
        // const start = performance.now();
        if (!lem) {
            return false;
        }
        const actionSystem = this.skillActions[skillType];
        if (!actionSystem) {
            this.logging.log(lem.id + " Unknown Action: " + skillType);
            return false;
        }
        const canApplyWhileFalling = {
            [Lemmings.SkillTypes.FLOATER]: Lemmings.ActionFloatingSystem,
            [Lemmings.SkillTypes.CLIMBER]: Lemmings.ActionClimbSystem,
            [Lemmings.SkillTypes.BOMBER]: this.skillActions[Lemmings.SkillTypes.BOMBER],
            [Lemmings.SkillTypes.BUILDER]: Lemmings.ActionBuildSystem
        };
        if (lem.action == this.actions[Lemmings.LemmingStateType.FALLING]) {
            if (!canApplyWhileFalling[skillType]) {
                return false;
            }
        }
        const redundant = {
            [Lemmings.SkillTypes.BASHER]: Lemmings.ActionBashSystem,
            [Lemmings.SkillTypes.BLOCKER]: Lemmings.ActionBlockerSystem,
            [Lemmings.SkillTypes.DIGGER]: Lemmings.ActionDiggSystem,
            [Lemmings.SkillTypes.MINER]: Lemmings.ActionMineSystem
        };
        const alreadyDoingIt =
            redundant[skillType] && (lem.action instanceof redundant[skillType]);
        if (alreadyDoingIt) {
            return false;
        }
        const wasBlocking = (lem.action instanceof Lemmings.ActionBlockerSystem);
        const ok = actionSystem.triggerLemAction(lem);
        if (ok && wasBlocking) {
            const keepWall =
                skillType === Lemmings.SkillTypes.BOMBER ||
                skillType === Lemmings.SkillTypes.CLIMBER ||
                skillType === Lemmings.SkillTypes.FLOATER;
            if (!keepWall) {
                this.triggerManager.removeByOwner(lem);
            }
        }
        // performance.measure(`${actionSystem.getActionName()}`, { start, detail: { devtools: { track: "LemmingManager", trackGroup: "Game State", color: "secondary-dark", tooltipText: `${lem.id} ${actionSystem.getActionName()}` } } });
        return ok;
    }

    isNuking() { return this.nextNukingLemmingsIndex >= 0; }
    doNukeAllLemmings() { this.nextNukingLemmingsIndex = 0; }

    dispose() {
        const start = performance.now();
        if (this.lemmings) this.lemmings.length = 0;
        if (this.minimapDots) this.minimapDots = new Uint8Array(0);
        this.level = null;
        this.triggerManager = null;
        this.gameVictoryCondition = null;
        this.skillActions.length = 0;
        this.releaseTickIndex = null;
        this.logging = new Lemmings.LogHandler("LemmingManager");
        this.miniMap = null;
        this.mmTickCounter = null;
        this.nextNukingLemmingsIndex = null;
        performance.measure(`LemmingManager Dispose`, { start, detail: { devtools: { track: "LemmingManager", trackGroup: "Game State", color: "error", tooltipText: `LemmingManager Dispose` } } });
    }
}

Lemmings.LemmingManager = LemmingManager;
export { LemmingManager };
