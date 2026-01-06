import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import { DummyAction } from './helpers/lemming-actions.js';
import { makeManager } from './helpers/lemming-manager.js';
import '../js/render/SolidLayer.js';
import '../js/lemmings/LemmingStateType.js';
import '../js/lemmings/Lemming.js';
import '../js/LemmingsBootstrap.js';

useGlobalLemmings({ bench: false, extraLemmings: 0, game: { showDebug: true } });

function makeManagerWithActions(options){
  const { manager, gvc } = makeManager(options);
  for (const key in manager.actions) manager.actions[key] = new DummyAction(key);
  for (const key in manager.skillActions) manager.skillActions[key] = manager.actions[key] || new DummyAction(key);
  return { manager, gvc };
}

describe('LemmingManager spawning and removal', function(){
  it('adds extra lemmings when extraLemmings is set', function(){
    const { manager } = makeManagerWithActions({ width: 20, height: 20 });
    lemmings.extraLemmings = 2;
    manager.addLemming(5,5);
    expect(manager.lemmings.length).to.equal(3);
    expect(manager.spawnTotal).to.equal(3);
  });

  it('addNewLemmings ignores left count in bench mode', function(){
    const { manager, gvc } = makeManagerWithActions();
    gvc.leftCount = 0;
    lemmings.bench = true;
    manager.releaseTickIndex = 103;
    manager.addNewLemmings();
    expect(manager.lemmings.length).to.equal(1);
    expect(gvc.getOutCount()).to.equal(0);
  });

  it('removeOne records deaths except when exiting', function(){
    const { manager, gvc } = makeManagerWithActions();
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
