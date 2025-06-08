import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/SolidLayer.js';
import '../js/LemmingStateType.js';
import '../js/Lemming.js';
import { Level } from '../js/Level.js';
import { LemmingManager } from '../js/LemmingManager.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';
import '../js/LemmingsBootstrap.js';

const spriteStub = {
  getAnimation() {
    return { frames: [], getFrame() { return {}; } };
  }
};

const maskStub = {
  GetMask() {
    return { width:0,height:0,offsetX:0,offsetY:0,at() { return 0; } };
  }
};

const triggerStub = { trigger() { return 0; }, removeByOwner() {} };
const particleStub = {};

class DummyAction {
  constructor(name){ this.name=name; }
  getActionName(){ return this.name; }
  triggerLemAction(lem){ lem.setAction(this); return true; }
  process(){ return Lemmings.LemmingStateType.NO_STATE_TYPE; }
}

beforeEach(function(){
  globalThis.lemmings = { bench:false, extraLemmings:0, game:{ showDebug:true } };
});

afterEach(function(){
  delete globalThis.lemmings;
});

function makeManager(level){
  const gvc = new GameVictoryCondition(level);
  const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);
  for (const key in manager.actions) manager.actions[key] = new DummyAction(key);
  for (const key in manager.skillActions) manager.skillActions[key] = manager.actions[key] || new DummyAction(key);
  return { manager, gvc };
}

describe('LemmingManager spawning and removal', function(){
  it('adds extra lemmings when extraLemmings is set', function(){
    const level = new Level(20,20); level.entrances=[{x:0,y:0}];
    const { manager } = makeManager(level);
    lemmings.extraLemmings = 2;
    manager.addLemming(5,5);
    expect(manager.lemmings.length).to.equal(3);
    expect(manager.spawnTotal).to.equal(3);
  });

  it('addNewLemmings ignores left count in bench mode', function(){
    const level = new Level(10,10); level.entrances=[{x:0,y:0}];
    const { manager, gvc } = makeManager(level);
    gvc.leftCount = 0;
    lemmings.bench = true;
    manager.releaseTickIndex = 103;
    manager.addNewLemmings();
    expect(manager.lemmings.length).to.equal(1);
    expect(gvc.getOutCount()).to.equal(0);
  });

  it('removeOne records deaths except when exiting', function(){
    const level = new Level(10,10); level.entrances=[{x:0,y:0}];
    const { manager, gvc } = makeManager(level);
    gvc.leftCount = 1;
    gvc.releaseCount = 1;
    manager.addLemming(1,1);
    gvc.releaseOne();
    const lem = manager.lemmings[0];
    const mm = { addDeath(x,y){ this.coords=[x,y]; } };
    manager.setMiniMap(mm);
    manager.removeOne(lem);
    expect(mm.coords).to.eql([1,1]);
    expect(gvc.getOutCount()).to.equal(0);

    manager.addLemming(2,2);
    const lem2 = manager.lemmings[1];
    lem2.setAction(manager.actions[Lemmings.LemmingStateType.EXITING]);
    mm.coords = null;
    manager.removeOne(lem2);
    expect(mm.coords).to.equal(null);
  });
});
