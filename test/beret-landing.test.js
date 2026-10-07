import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { ActionBaseSystem } from '../js/actions/ActionBaseSystem.js';
import { ActionFallSystem } from '../js/actions/ActionFallSystem.js';
import { ActionFloatingSystem } from '../js/actions/ActionFloatingSystem.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';
import { SolidLayer } from '../js/render/SolidLayer.js';

const manifest = JSON.parse(fs.readFileSync('assets/hydro/hydro-skin.json', 'utf8'));
const create = (input = manifest) => {
  const skin = new PixelSpriteSkin(input);
  const actions = { fall: new ActionFallSystem(skin), float: new ActionFloatingSystem(skin), walk: new ActionWalkSystem(skin) };
  return { skin, actions };
};
const capture = lem => {
  const calls = [];
  lem.render({ drawFrame(frame, x, y) { calls.push({ frame, x, y }); } });
  assert.equal(calls.length, 1);
  return calls[0];
};
const enter = (actions, right = true, phase = 8) => {
  const lem = new Lemming(40, 80, 1);
  lem.lookRight = right;
  lem.setAction(actions.float);
  lem.frameIndex = phase;
  lem.setAction(actions.walk);
  return lem;
};
const rgba = rows => rows.flatMap(row => [...row].flatMap(s => manifest.palette[manifest.symbols.indexOf(s)]));
const expected = (index, direction = 1, sway = 0) => manifest.cosmetics.beretLanding.variants.find(v => v.direction === direction && v.startSway === sway).frames[index];
const canonical = (skin, lem) => skin.getAnimation(SpriteTypes.WALKING, lem.lookRight).getFrame(lem.frameIndex);

describe('Hydro beret landing cosmetic', function () {
  it('accepts older manifests without a cosmetic and retains normal drawing', function () {
    const old = structuredClone(manifest);
    delete old.cosmetics;
    const { skin, actions } = create(old);
    const lem = enter(actions);
    assert.equal(capture(lem).frame, canonical(skin, lem));
  });

  it('rejects malformed cosmetic geometry, directions, coverage, and pixel rows', function () {
    const mutations = [
      m => { m.cosmetics = {}; },
      m => { m.cosmetics.beretLanding.frameCount = 8; },
      m => { m.cosmetics.beretLanding.offsetY = -15; },
      m => { m.cosmetics.beretLanding.variants.pop(); },
      m => { m.cosmetics.beretLanding.variants[0].direction = 0; },
      m => { m.cosmetics.beretLanding.variants[0].startSway = 3; },
      m => { m.cosmetics.beretLanding.variants[0] = m.cosmetics.beretLanding.variants[1]; },
      m => { m.cosmetics.beretLanding.variants[0].frames.pop(); },
      m => { m.cosmetics.beretLanding.variants[0].frames[0].pop(); },
      m => { m.cosmetics.beretLanding.variants[0].frames[0][0] = 'Z'.repeat(16); }
    ];
    for (const mutate of mutations) {
      const input = structuredClone(manifest);
      mutate(input);
      assert.throws(() => new PixelSpriteSkin(input), /Invalid sprite skin/);
    }
  });

  it('plays seven walking-clock frames and resumes the unchanged eighth walking frame', function () {
    const { skin, actions } = create();
    const lem = enter(actions);
    for (let index = 0; index < 7; index++) {
      lem.frameIndex = index;
      lem.x++;
      const call = capture(lem);
      assert.deepEqual([call.x, call.y], [lem.x, lem.y]);
      assert.deepEqual([call.frame.width, call.frame.height, call.frame.offsetX, call.frame.offsetY], [16, 16, -8, -16]);
      assert.deepEqual([...call.frame.getData()], rgba(expected(index)));
      assert(call.frame.getSpanCache());
    }
    lem.frameIndex = 7;
    assert.equal(capture(lem).frame, canonical(skin, lem));
  });

  it('decodes all 42 cosmetic frames with exact RGBA, binary masks, and span caches', function () {
    const { actions } = create();
    for (const right of [true, false]) for (const [phase, sway] of [[8, 0], [9, 1], [14, -1]]) {
      const lem = enter(actions, right, phase);
      for (let index = 0; index < 7; index++) {
        lem.frameIndex = index;
        const frame = capture(lem).frame;
        const data = frame.getData();
        assert.deepEqual([...data], rgba(expected(index, right ? 1 : -1, sway)));
        const spans = frame.getSpanCache();
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const pixel = y * 16 + x;
          assert.equal(frame.mask[pixel], data[pixel * 4 + 3] === 255 ? 1 : 0);
          const row = spans.rows[y];
          let covered = false;
          if (row) for (let n = 0; n < row.length; n += 2) if (x >= row[n] && x < row[n + 1]) covered = true;
          assert.equal(covered, Boolean(frame.mask[pixel]));
        }
      }
    }
  });

  it('keeps the walking body, squash, hop, and feet unchanged beneath the moving hat', function () {
    const { skin, actions } = create();
    for (const right of [true, false]) {
      const lem = enter(actions, right);
      for (let index = 0; index < 7; index++) {
        lem.frameIndex = index;
        const frame = capture(lem).frame;
        const walk = canonical(skin, lem);
        const hop = [0, 0, 1, 2, 2, 1, 0][index];
        const top = 16 - ([1, 6].includes(index) ? 7 : 8) - hop;
        for (let y = top + 4; y < 16; y++) for (let x = 0; x < 16; x++) {
          assert.deepEqual([...frame.getData().slice((y * 16 + x) * 4, (y * 16 + x + 1) * 4)], [...walk.getData().slice(((y - 6) * 16 + x) * 4, ((y - 6) * 16 + x + 1) * 4)]);
        }
        if (index === 6) {
          for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
            assert.deepEqual([...frame.getData().slice(((y + 6) * 16 + x) * 4, ((y + 6) * 16 + x + 1) * 4)], [...walk.getData().slice((y * 16 + x) * 4, (y * 16 + x + 1) * 4)]);
          }
        }
      }
    }
  });

  it('does not advance on repeated rendering or pause, and honors skipped simulation frames', function () {
    const { skin, actions } = create();
    const lem = enter(actions);
    const first = capture(lem).frame;
    for (let n = 0; n < 10; n++) assert.equal(capture(lem).frame, first);
    assert.equal(lem.frameIndex, 0);
    lem.frameIndex = 5;
    assert.deepEqual([...capture(lem).frame.getData()], rgba(expected(5)));
    lem.frameIndex = 50;
    assert.equal(capture(lem).frame, canonical(skin, lem));
    lem.frameIndex = 0;
    assert.equal(capture(lem).frame, canonical(skin, lem));
  });

  it('uses real ground contact from all 16 float phases in both directions', function () {
    const { skin, actions } = create();
    for (const right of [true, false]) for (let phase = 0; phase < 16; phase++) {
      const lem = new Lemming(40, 80, phase);
      lem.lookRight = right;
      lem.setAction(actions.float);
      lem.frameIndex = phase;
      let state;
      let count = 0;
      do {
        state = actions.float.process({ hasGroundAt: (x, y) => y >= 80 }, lem);
        assert(++count <= 3);
      } while (state === LemmingStateType.NO_STATE_TYPE);
      assert.equal(state, LemmingStateType.WALKING);
      assert.equal(lem.y, 80);
      lem.setAction(actions.walk);
      assert.equal(lem.frameIndex, 0);
      assert.notEqual(capture(lem).frame, canonical(skin, lem));
    }
  });

  it('respects all canopy sway variants and changes facing during the flourish', function () {
    const { actions } = create();
    for (const [phase, sway] of [[8, 0], [9, 1], [14, -1]]) {
      const lem = enter(actions, true, phase);
      assert.deepEqual([...capture(lem).frame.getData()], rgba(expected(0, 1, sway)));
      lem.lookRight = false;
      assert.deepEqual([...capture(lem).frame.getData()], rgba(expected(0, -1, sway)));
      lem.frameIndex = 3;
      assert.deepEqual([...capture(lem).frame.getData()], rgba(expected(3, -1, sway)));
    }
  });

  it('does not affect ordinary walking or other actors sharing the same action systems', function () {
    const { skin, actions } = create();
    const landing = enter(actions);
    const ordinary = new Lemming(90, 80, 2);
    ordinary.setAction(actions.walk);
    assert.notEqual(capture(landing).frame, canonical(skin, landing));
    assert.equal(capture(ordinary).frame, canonical(skin, ordinary));
    ordinary.frameIndex = 3;
    assert.equal(capture(ordinary).frame, canonical(skin, ordinary));
    ordinary.setAction(actions.fall);
    ordinary.setAction(actions.walk);
    assert.equal(capture(ordinary).frame, canonical(skin, ordinary));
  });

  it('cancels on every action interruption, including interruptions without a render', function () {
    const { skin, actions } = create();
    for (const [name, state] of [['falling', 'FALLING'], ['digging', 'DIGGING'], ['blocking', 'BLOCKING'], ['climbing', 'CLIMBING'], ['splatting', 'SPLATTING']]) {
      const lem = enter(actions);
      const interrupt = new ActionBaseSystem({ sprites: skin, spriteType: SpriteTypes[state], actionName: name });
      lem.setAction(interrupt);
      lem.setAction(actions.walk);
      assert.equal(capture(lem).frame, canonical(skin, lem));
    }
  });

  it('clears on removal, pooled reset, frame rewind, and sprite-provider replacement', function () {
    const { skin, actions } = create();
    for (const clear of [lem => lem.remove(), lem => lem.reset(40, 80, 99)]) {
      const lem = enter(actions);
      clear(lem);
      lem.setAction(actions.walk);
      assert.equal(capture(lem).frame, canonical(skin, lem));
    }
    const rewind = enter(actions);
    rewind.frameIndex = 4;
    capture(rewind);
    rewind.frameIndex = 2;
    assert.equal(capture(rewind).frame, canonical(skin, rewind));
    const replacement = create();
    const swapped = enter(actions);
    swapped.setAction(replacement.actions.walk);
    assert.equal(capture(swapped).frame, canonical(replacement.skin, swapped));
  });

  it('rearms cleanly after another actual fall and landing', function () {
    const { skin, actions } = create();
    const lem = enter(actions);
    lem.frameIndex = 7;
    capture(lem);
    lem.setAction(actions.fall);
    lem.setAction(actions.float);
    lem.frameIndex = 9;
    lem.setAction(actions.walk);
    assert.notEqual(capture(lem).frame, canonical(skin, lem));
    assert.deepEqual([...capture(lem).frame.getData()], rgba(expected(0, 1, 1)));
  });

  it('keeps simulation positions, state transitions, frame indices, and walking speed identical', function () {
    const plain = structuredClone(manifest);
    delete plain.cosmetics;
    const setups = [create(), create(plain)];
    const ground = new SolidLayer(160, 96);
    for (let y = 80; y < 96; y++) for (let x = 0; x < 160; x++) ground.setGroundAt(x, y);
    const level = { width: 160, height: 96, hasGroundAt: (x, y) => ground.hasGroundAt(x, y), getGroundMaskLayer: () => ground };
    const actors = setups.map(({ actions }) => {
      const lem = new Lemming(60, 12, 1);
      lem.setAction(actions.fall);
      lem.hasParachute = true;
      return lem;
    });
    for (let tick = 0; tick < 70; tick++) {
      actors.forEach(capture);
      assert.deepEqual(actors.map(lem => [lem.x, lem.y, lem.state, lem.frameIndex, lem.getDirection(), lem.action.getActionName()])[0], actors.map(lem => [lem.x, lem.y, lem.state, lem.frameIndex, lem.getDirection(), lem.action.getActionName()])[1]);
      actors.forEach((lem, i) => {
        const next = lem.process(level);
        if (next === LemmingStateType.FLOATING) lem.setAction(setups[i].actions.float);
        else if (next === LemmingStateType.WALKING) lem.setAction(setups[i].actions.walk);
        else assert.equal(next, LemmingStateType.NO_STATE_TYPE);
      });
    }
  });
});
