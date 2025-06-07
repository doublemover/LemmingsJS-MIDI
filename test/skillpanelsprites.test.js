import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/SkillTypes.js';
import '../js/SpriteTypes.js';
import '../js/MaskTypes.js';
import { ActionBaseSystem } from '../js/ActionBaseSystem.js';
import { ActionCountdownSystem } from '../js/ActionCountdownSystem.js';

class FakeAnimation {
  constructor(label) { this.label = label; }
  getFrame() { return this.label; }
}

class FakeSprites {
  getAnimation(type, right) {
    return new FakeAnimation(`anim-${type}-${right}`);
  }
}

class FakeMaskList {
  constructor(label) { this.label = label; }
  GetMask(idx) { return `${this.label}-${idx}`; }
}

class FakeMasks {
  GetMask(type) {
    return new FakeMaskList(`mask-${type}`);
  }
}

globalThis.lemmings = { game: { showDebug: false } };

describe('Skill panel action sprites', function () {
  it('retrieves animations and masks for each SkillType', function () {
    const sprites = new FakeSprites();
    const masks = new FakeMasks();

    // clear static countdown masks between runs
    ActionCountdownSystem.numberMasks.clear();

    const systems = {
      [Lemmings.SkillTypes.CLIMBER]: new ActionBaseSystem({ sprites, spriteType: Lemmings.SpriteTypes.CLIMBING }),
      [Lemmings.SkillTypes.FLOATER]: new ActionBaseSystem({ sprites, spriteType: Lemmings.SpriteTypes.UMBRELLA }),
      [Lemmings.SkillTypes.BOMBER]: new ActionCountdownSystem(masks),
      [Lemmings.SkillTypes.BLOCKER]: new ActionBaseSystem({ sprites, spriteType: Lemmings.SpriteTypes.BLOCKING, singleSprite: true }),
      [Lemmings.SkillTypes.BUILDER]: new ActionBaseSystem({ sprites, spriteType: Lemmings.SpriteTypes.BUILDING }),
      [Lemmings.SkillTypes.BASHER]: new ActionBaseSystem({
        sprites,
        spriteType: Lemmings.SpriteTypes.BASHING,
        masks,
        maskTypes: { left: Lemmings.MaskTypes.BASHING_L, right: Lemmings.MaskTypes.BASHING_R }
      }),
      [Lemmings.SkillTypes.MINER]: new ActionBaseSystem({
        sprites,
        spriteType: Lemmings.SpriteTypes.MINING,
        masks,
        maskTypes: { left: Lemmings.MaskTypes.MINING_L, right: Lemmings.MaskTypes.MINING_R }
      }),
      [Lemmings.SkillTypes.DIGGER]: new ActionBaseSystem({ sprites, spriteType: Lemmings.SpriteTypes.DIGGING })
    };

    // CLIMBER
    let sys = systems[Lemmings.SkillTypes.CLIMBER];
    expect(sys.sprites.get('left').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.CLIMBING}-false`);
    expect(sys.sprites.get('right').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.CLIMBING}-true`);

    // FLOATER
    sys = systems[Lemmings.SkillTypes.FLOATER];
    expect(sys.sprites.get('left').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.UMBRELLA}-false`);
    expect(sys.sprites.get('right').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.UMBRELLA}-true`);

    // BLOCKER (single sprite)
    sys = systems[Lemmings.SkillTypes.BLOCKER];
    expect(sys.sprites.get('both').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.BLOCKING}-false`);

    // BUILDER
    sys = systems[Lemmings.SkillTypes.BUILDER];
    expect(sys.sprites.get('left').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.BUILDING}-false`);
    expect(sys.sprites.get('right').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.BUILDING}-true`);

    // BASHER with masks
    sys = systems[Lemmings.SkillTypes.BASHER];
    expect(sys.sprites.get('left').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.BASHING}-false`);
    expect(sys.sprites.get('right').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.BASHING}-true`);
    expect(sys.masks.get('left').label)
      .to.equal(`mask-${Lemmings.MaskTypes.BASHING_L}`);
    expect(sys.masks.get('right').label)
      .to.equal(`mask-${Lemmings.MaskTypes.BASHING_R}`);

    // MINER with masks
    sys = systems[Lemmings.SkillTypes.MINER];
    expect(sys.sprites.get('left').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.MINING}-false`);
    expect(sys.sprites.get('right').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.MINING}-true`);
    expect(sys.masks.get('left').label)
      .to.equal(`mask-${Lemmings.MaskTypes.MINING_L}`);
    expect(sys.masks.get('right').label)
      .to.equal(`mask-${Lemmings.MaskTypes.MINING_R}`);

    // DIGGER
    sys = systems[Lemmings.SkillTypes.DIGGER];
    expect(sys.sprites.get('left').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.DIGGING}-false`);
    expect(sys.sprites.get('right').label)
      .to.equal(`anim-${Lemmings.SpriteTypes.DIGGING}-true`);

    // BOMBER uses countdown masks
    sys = systems[Lemmings.SkillTypes.BOMBER];
    const m = ActionCountdownSystem.numberMasks.get('numbers');
    expect(m.label).to.equal(`mask-${Lemmings.MaskTypes.NUMBERS}`);
    expect(m.GetMask(2)).to.equal(`mask-${Lemmings.MaskTypes.NUMBERS}-2`);
  });

  it('maps every skill to the correct sprite directions', function () {
    const sprites = new FakeSprites();
    const masks = new FakeMasks();

    ActionCountdownSystem.numberMasks.clear();

    const cases = {
      [Lemmings.SkillTypes.CLIMBER]: {
        type: Lemmings.SpriteTypes.CLIMBING,
        left: 'left',
        right: 'right'
      },
      [Lemmings.SkillTypes.FLOATER]: {
        type: Lemmings.SpriteTypes.UMBRELLA,
        left: 'left',
        right: 'right'
      },
      [Lemmings.SkillTypes.BOMBER]: {
        countdown: true
      },
      [Lemmings.SkillTypes.BLOCKER]: {
        type: Lemmings.SpriteTypes.BLOCKING,
        single: true
      },
      [Lemmings.SkillTypes.BUILDER]: {
        type: Lemmings.SpriteTypes.BUILDING,
        left: 'left',
        right: 'right'
      },
      [Lemmings.SkillTypes.BASHER]: {
        type: Lemmings.SpriteTypes.BASHING,
        masks: {
          left: Lemmings.MaskTypes.BASHING_L,
          right: Lemmings.MaskTypes.BASHING_R
        }
      },
      [Lemmings.SkillTypes.MINER]: {
        type: Lemmings.SpriteTypes.MINING,
        masks: {
          left: Lemmings.MaskTypes.MINING_L,
          right: Lemmings.MaskTypes.MINING_R
        }
      },
      [Lemmings.SkillTypes.DIGGER]: {
        type: Lemmings.SpriteTypes.DIGGING,
        left: 'left',
        right: 'right'
      }
    };

    for (const [skill, info] of Object.entries(cases)) {
      let sys;
      if (info.countdown) {
        sys = new ActionCountdownSystem(masks);
        const mask = ActionCountdownSystem.numberMasks.get('numbers');
        expect(mask.GetMask(1)).to.equal(`mask-${Lemmings.MaskTypes.NUMBERS}-1`);
        continue;
      }

      const opts = { sprites, spriteType: info.type };
      if (info.single) opts.singleSprite = true;
      if (info.masks) {
        opts.masks = masks;
        opts.maskTypes = info.masks;
      }
      sys = new ActionBaseSystem(opts);

      if (info.single) {
        expect(sys.sprites.get('both').label)
          .to.equal(`anim-${info.type}-false`);
      } else {
        expect(sys.sprites.get('left').label)
          .to.equal(`anim-${info.type}-false`);
        expect(sys.sprites.get('right').label)
          .to.equal(`anim-${info.type}-true`);
      }

      if (info.masks) {
        expect(sys.masks.get('left').label)
          .to.equal(`mask-${info.masks.left}`);
        expect(sys.masks.get('right').label)
          .to.equal(`mask-${info.masks.right}`);
      }
    }
  });
});
