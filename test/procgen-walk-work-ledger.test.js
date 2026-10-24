import { expect } from 'chai';
import { ProcgenWalkContinuation } from '../js/app/procgen/ProcgenWalkContinuation.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const world = () => ({ width: 1000, height: 96, laneHeight: 96, laneCount: 1, accessTasks: [[]],
  terrain: { chunkWidth: 128 }, generatedThrough: [512], terrainRevision: 0, frontierRevision: 0, generation: 1, tickIndex: 0 });
describe('shared passive WALK work ledger', () => {
  for (const budget of [0, 1, 2, 48, 64, 72, 128]) {
    it(`reserves terrain and action units before working with budget ${budget}`, () => {
      const proof = new ProcgenWalkContinuation(world()), actor = new Lemming(64, 72, 1);
      let reads = 0, steps = 0;
      for (const action of Object.values(proof.actions)) {
        const original = action.process; action.process = function(...args) { steps++; return original.apply(this, args); };
      }
      const result = proof.prove(actor, (x, y) => { reads++; return y >= 72; }, [], budget);
      expect(reads + steps).to.be.at.most(budget); expect(result.actionSteps).to.equal(steps);
      expect(result.terrainReads).to.equal(reads); expect(result.work).to.equal(reads + steps);
      expect(result.safe).to.equal(budget >= 72); expect(actor.x).to.equal(64); expect(actor.y).to.equal(72);
      proof.dispose();
    });
  }
  for (const ground of [(x, y) => y >= 72 || x >= 70 && y >= 64, (x, y) => x < 70 && y >= 72, () => false]) {
    it('bounds turned and falling rejected continuations with the same ledger', () => {
      const proof = new ProcgenWalkContinuation(world()), actor = new Lemming(64, 72, 1); let reads = 0, steps = 0;
      for (const action of Object.values(proof.actions)) { const original = action.process; action.process = function(...args) { steps++; return original.apply(this, args); }; }
      const result = proof.prove(actor, (x, y) => { reads++; return ground(x, y); }, [], 48);
      expect(result.safe).to.equal(false); expect(reads + steps).to.be.at.most(48); expect(result.actionSteps).to.equal(steps);
      expect(result.work).to.equal(reads + steps); expect(proof.actions[State.WALKING]).to.exist; proof.dispose();
    });
  }
});
