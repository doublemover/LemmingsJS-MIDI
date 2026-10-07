import { expect } from 'chai';
import { createGameToolHandlers } from '../mcp/gameTools.js';
import { GameSkills } from '../js/game/GameSkills.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { CommandSelectSkill } from '../js/commands/CommandSelectSkill.js';
import { CommandLemmingsAction } from '../js/commands/CommandLemmingsAction.js';

describe('MCP single skill application', function() {
  const fixture = () => {
    const counts = Array(9).fill(0); counts[SkillTypes.CLIMBER] = 1; counts[SkillTypes.BASHER] = 3;
    const skills = new GameSkills({ skills: counts });
    const actor = { id: 0, x: 50, y: 50, canClimb: false, actionType: 'walk' };
    const applications = [], presses = [];
    let tick = 0;
    const manager = { getLemming: () => actor, getSelectedLemming: () => actor,
      doLemmingAction(lem, skill) { applications.push(skill); if (skill === SkillTypes.CLIMBER) { if (lem.canClimb) return false; lem.canClimb = true; } else lem.actionType = 'bash'; return true; } };
    const game = { getGameSkills: () => skills, getLemmingManager: () => manager };
    const getState = async () => ({ game: { timer: { tickIndex: tick }, skills: { skills: [...skills.skills] },
      lemmingManager: { selectedIndex: 0 }, lemmings: [{ ...actor }] } });
    const parse = args => ({ sessionId: 'test', ...args });
    const handlers = createGameToolHandlers({
      schemas: Object.fromEntries(['InputActionSchema', 'InputKeysSchema', 'LemmingSelectSchema', 'SkillApplySchema', 'TimeSchema', 'TimeStepSchema'].map(name => [name, { parse }])),
      getSession: () => ({}), getState, getTickIndex: () => tick,
      callE2E: async (_session, method, amount) => { if (method === 'step') tick += amount; return { ok: true, value: true }; },
      attachEvents: (_session, value) => value, nudgeWatchPolling() {}, ensureGameFocus() {},
      pressAction: async (_session, action) => {
        presses.push(action);
        if (action === 'selectClimber') new CommandSelectSkill(SkillTypes.CLIMBER).execute(game);
        if (action === 'applySkillToSelected') new CommandLemmingsAction(0).execute(game);
        return { ok: true };
      },
      skillActions: { climber: 'selectClimber' }, skillIndexByName: { climber: SkillTypes.CLIMBER }
    });
    return { handlers, game, actor, skills, applications, presses };
  };

  it('uses the last climber without consuming the automatically selected basher', async function() {
    const f = fixture();
    const result = await f.handlers.applySkillTool({ skill: 'climber', lemmingId: 0, requireAvailable: true });
    expect(result.ok).to.equal(true); expect(result.verification.applied).to.equal(true);
    expect(f.actor.canClimb).to.equal(true); expect(f.actor.actionType).to.equal('walk');
    expect(f.skills.getSkill(SkillTypes.CLIMBER)).to.equal(0);
    expect(f.skills.getSelectedSkill()).to.equal(SkillTypes.BASHER);
    expect(f.skills.getSkill(SkillTypes.BASHER)).to.equal(3);
    expect(f.applications).to.deep.equal([SkillTypes.CLIMBER]);
    expect(f.presses).to.deep.equal(['selectClimber']);
  });

  it('reports a successful application for replay even if that skill was already selected', function() {
    const f = fixture();
    expect(f.skills.getSelectedSkill()).to.equal(SkillTypes.CLIMBER);
    expect(new CommandSelectSkill(SkillTypes.CLIMBER).execute(f.game)).to.equal(true);
    expect(f.skills.getSkill(SkillTypes.CLIMBER)).to.equal(0);
  });

  it('does not apply an exhausted skill or any other skill on a repeated request', async function() {
    const f = fixture();
    await f.handlers.applySkillTool({ skill: 'climber', lemmingId: 0, requireAvailable: true });
    const result = await f.handlers.applySkillTool({ skill: 'climber', lemmingId: 0, requireAvailable: true });
    expect(result.reason).to.equal('no_skill_remaining');
    expect(f.skills.getSkill(SkillTypes.BASHER)).to.equal(3);
    expect(f.applications).to.deep.equal([SkillTypes.CLIMBER]);
  });
});
