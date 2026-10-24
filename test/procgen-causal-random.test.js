import { expect } from 'chai';
import { causalRandomDecision, CAUSAL_RANDOM_VERSION } from '../js/app/procgen/workstation/CausalRandom.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';

const draw = extra => causalRandomDecision({ seed: 42, namespace: 'musical-response', mappingId: 'wall', generation: 1,
  stableCauseId: 'actor7:contact10', drawPurpose: 'respond', probability01: 0.5, ...extra });

describe('causal keyed probability', () => {
  it('uses a declared algorithm and clamps invalid thresholds without a random cursor', () => {
    expect(draw().algorithmVersion).to.equal(CAUSAL_RANDOM_VERSION);
    expect(draw()).to.deep.equal(draw());
    expect(draw({ probability01: Infinity }).accepted).to.equal(false);
    expect(draw({ probability01: -1 }).accepted).to.equal(false);
    expect(draw({ probability01: 2 }).accepted).to.equal(true);
    expect(draw({ namespace: 'physical-route' }).drawUint32).not.to.equal(draw().drawUint32);
    expect(() => draw({ namespace: 'unknown' })).to.throw();
    expect(() => draw({ algorithmVersion: 'future' })).to.throw();
    expect(['actor7:contact10', 'actor8:contact10', 'actor7:contact11'].map(stableCauseId => draw({ stableCauseId }).drawUint32))
      .to.deep.equal([2558855495, 3635743238, 191132482]);
  });

  it('never responds at zero and always responds at one for 10000 fixed physical causes', () => {
    let half = 0;
    for (let index = 0; index < 10000; index++) {
      const stableCauseId = `actor:${index}:work:1`;
      expect(draw({ stableCauseId, probability01: 0 }).accepted).to.equal(false);
      expect(draw({ stableCauseId, probability01: 1 }).accepted).to.equal(true);
      if (draw({ stableCauseId }).accepted) half++;
    }
    // A deterministic smoke bound of +/- 3 percentage points; this measures
    // these draws only, not a claim about musical quality or random security.
    expect(half).to.be.within(4700, 5300);
  });

  it('keeps actor decisions unchanged when another instrument is enabled or muted', () => {
    const instrument = id => ({ id, sourceKind: 'ContactResolved', pitchCents: 6000, velocity01: 0.75,
      role: 'contact', route: 'local', probability01: 0.5 });
    const run = extra => {
      const graph = { version: 1, revision: 1, seed: 42, instruments: [instrument('wall'), ...extra] };
      const engine = createCausalMusicEngine({ getGraph: () => graph });
      engine.processBatch({ version: 1, worldId: 'world', generation: 1, tick: 1, batchId: 'world:1:1:0',
        completeness: { status: 'complete', dropped: 0 }, facts: [7, 8, 9].map((actorId, index) => ({
          kind: 'ContactResolved', actorId, causalSequence: index + 1, eventId: `contact:${actorId}` })) });
      return engine.diagnostics().decisions.filter(item => item.mappingId === 'wall');
    };
    expect(run([instrument('other')])).to.deep.equal(run([]));
    expect(run([{ ...instrument('other'), mute: true }])).to.deep.equal(run([]));
  });
});
