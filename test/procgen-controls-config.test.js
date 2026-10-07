import { expect } from 'chai';
import { readProcgenUrlConfig, createProcgenShareUrl } from '../js/app/procgen/ProcgenUrlConfig.js';
import { changeProcgenSpeed, normalizeProcgenSpeed } from '../js/app/procgen/ProcgenSpeedControl.js';
import { createProcgenCameraController, PROCGEN_MIN_SCALE } from '../js/app/procgen/ProcgenCameraController.js';
import { PROCGEN_HUD_GLYPHS } from '../js/app/procgen/ProcgenBitmapHud.js';
import { resolvePreviewColors } from '../js/app/characterPreviews.js';

const cameraFixture = () => {
  const listeners = new Map();
  const renderer = { scale: 3, cameraX: 0, cameraY: 0, follow: true,
    canvas: { width: 900, height: 600, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) },
    world: { height: 1024 * 96, actors: [{ x: 120, y: 60 }, { x: 5000, y: 700, failureReason: 'dead' }, { x: 600, y: 300 }] },
    window: { devicePixelRatio: 1 }, render() { this.renders = (this.renders || 0) + 1; } };
  const camera = createProcgenCameraController(renderer);
  return { renderer, camera, listeners };
};

describe('procgen compact controls and share configuration', () => {
  it('validates explicit query config while retaining compatible aliases and free-form seeds', () => {
    const parsed = readProcgenUrlConfig('?seed=forest&lanes=2048&pack=6&speed=128&appearance=donut&body=random&accessory=crown&eyewear=monocle&frameColor=%2304bb9f&musicPreset=game-lydian-lanterns&phrases=1&x=200&y=96&scale=0.125');
    expect(parsed.settings).to.include({ laneCount: 1024, pack: 6, speed: 128, preset: 'game-lydian-lanterns', mode: 'phrase' });
    expect(parsed.appearance).to.include({ shape: 'donut', bodyColor: 'random', accessory: 'crown', eyewear: 'monocle', eyewearColor: '#04bb9f' });
    expect(parsed.camera).to.deep.equal({ cameraX: 200, cameraY: 96, scale: 0.125, follow: false });
    expect(parsed.seed).to.be.a('number');
    expect(readProcgenUrlConfig('?speed=Infinity&pack=7&shape=missing&bodyColor=red&cameraY=-1&zoom=0&follow=maybe').settings).to.deep.equal({});
    expect(readProcgenUrlConfig('?speed=Infinity&pack=7&shape=missing&bodyColor=red&cameraY=-1&zoom=0&follow=maybe').camera).to.deep.equal({});
  });
  it('round-trips a full run link without enabling listening', () => {
    const settings = { laneCount: 24, pack: 2, speed: 150, preset: 'game-lydian-lanterns', mode: 'phrase' };
    const appearance = { shape: 'classic', seed: 42, bodyColor: 'random', propColor: '#ff8066', eyewearColor: '#1f1f1f', accessory: 'beret', eyewear: 'none' };
    const camera = { cameraX: 400, cameraY: 192, scale: 0.125, follow: false };
    const url = createProcgenShareUrl({ url: 'https://example.test/procgen.html?seed=7&x=2&e2e=1', seed: 99, settings, appearance, camera });
    const parsed = readProcgenUrlConfig(new URL(url).search);
    expect(parsed).to.deep.equal({ seed: 99, settings, appearance, camera });
    expect(url).not.to.include('listen='); expect(url).not.to.include('&x=');
  });
  it('matches classic keyboard/panel steps while allowing speeds beyond the old procgen dropdown and game cap', () => {
    expect(changeProcgenSpeed(0.1, -1)).to.equal(0.1);
    expect(changeProcgenSpeed(0.9, 1)).to.equal(1);
    expect(changeProcgenSpeed(1, -1)).to.equal(0.9);
    expect(changeProcgenSpeed(3, 1)).to.equal(4);
    expect(changeProcgenSpeed(10, 1, { panel: true })).to.equal(20);
    expect(changeProcgenSpeed(20, -1, { panel: true })).to.equal(10);
    expect(changeProcgenSpeed(120, 1, { panel: true })).to.equal(130);
    expect(changeProcgenSpeed(120, 1, { fast: true })).to.equal(125);
    expect(normalizeProcgenSpeed('NaN', 5)).to.equal(5);
  });
  it('zooms out to all lanes with the left/top origin pinned and leaves follow after manual view changes', () => {
    const { renderer, camera } = cameraFixture();
    camera.setZoom(PROCGEN_MIN_SCALE);
    expect(renderer.scale).to.equal(1 / 256); expect(camera.viewport().height).to.be.greaterThan(renderer.world.height);
    expect(renderer.cameraX).to.equal(0); expect(renderer.cameraY).to.equal(0); expect(renderer.follow).to.equal(false);
    camera.setZoom(3); camera.pan(300, 300);
    expect(renderer.cameraX).to.equal(100); expect(renderer.cameraY).to.equal(100);
    camera.dispose();
  });
  it('resumes follow on the furthest living actor, including its lane, then follows a new survivor', () => {
    const { renderer, camera, listeners } = cameraFixture();
    camera.pan(3000, 3000); camera.followFrontier();
    expect(renderer.cameraX).to.equal(480); expect(renderer.cameraY).to.equal(220); expect(renderer.follow).to.equal(true);
    renderer.world.actors[2].failureReason = 'dead'; camera.update(true);
    expect(renderer.cameraX).to.equal(0); expect(renderer.cameraY).to.equal(0);
    camera.dispose(); expect(listeners.size).to.equal(0);
  });
  it('uses only native classic HUD glyphs and stable, independently colored preview identities', () => {
    expect(PROCGEN_HUD_GLYPHS.test('SCORE 123 BEST 400 LANE 2 DIST 99')).to.equal(true);
    expect(PROCGEN_HUD_GLYPHS.test('2 · 123 px')).to.equal(false);
    const p = { seed: 42, bodyColor: 'random', propColor: '#ff8066', eyewearColor: 'random' };
    expect(resolvePreviewColors(p, 3)).to.deep.equal(resolvePreviewColors(p, 3));
    expect(resolvePreviewColors(p, 3).bodyColor).not.to.equal(resolvePreviewColors(p, 4).bodyColor);
    expect(resolvePreviewColors(p, 3).propColor).to.equal('#ff8066');
  });
});
