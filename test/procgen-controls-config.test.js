import { expect } from 'chai';
import { readProcgenUrlConfig, createProcgenShareUrl } from '../js/app/procgen/ProcgenUrlConfig.js';
import { createProcgenRedirectUrl } from '../js/app/StartupUrlConfig.js';
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
  it('validates core run config while ignoring appearance and private policy parameters', () => {
    const parsed = readProcgenUrlConfig('?seed=forest&lanes=2048&pack=6&speed=128&appearance=donut&body=random&accessory=crown&eyewear=monocle&frameColor=%2304bb9f&musicPreset=game-lydian-lanterns&phrases=1&x=200&y=96&scale=0.125');
    expect(parsed.settings).to.include({ laneCount: 1024, pack: 6, speed: 128, preset: 'game-lydian-lanterns', mode: 'phrase' });
    expect(parsed.appearance).to.deep.equal({});
    expect(parsed.camera).to.deep.equal({ cameraX: 200, cameraY: 96, scale: 0.125, follow: false });
    expect(parsed.seed).to.be.a('number');
    expect(readProcgenUrlConfig('?speed=Infinity&pack=7&shape=missing&bodyColor=red&cameraY=-1&zoom=0&follow=maybe').settings).to.deep.equal({ output: 'synth', sound: true });
    expect(readProcgenUrlConfig('?speed=Infinity&pack=7&shape=missing&bodyColor=red&cameraY=-1&zoom=0&follow=maybe').camera).to.deep.equal({});
  });
  it('round-trips a full run link without enabling listening', () => {
    const settings = { laneCount: 24, pack: 2, speed: 150, preset: 'game-lydian-lanterns', mode: 'phrase' };
    const appearance = { shape: 'classic', seed: 42, bodyColor: 'random', propColor: '#ff8066', eyewearColor: '#1f1f1f', accessory: 'beret', eyewear: 'none' };
    const camera = { cameraX: 400, cameraY: 192, scale: 0.125, follow: false };
    const url = createProcgenShareUrl({ url: 'https://example.test/procgen.html?seed=7&x=2&e2e=1', seed: 99, settings, appearance, camera });
    const parsed = readProcgenUrlConfig(new URL(url).search);
    expect(parsed).to.deep.equal({ seed: 99, settings: { ...settings, output: 'synth', sound: true }, appearance: {}, camera });
    expect(new URL(url).searchParams.has('shape')).to.equal(false); expect(new URL(url).searchParams.has('e2e')).to.equal(false);
    expect(url).not.to.include('listen='); expect(url).not.to.include('&x=');
  });
  it('redirects normal-game procgen selection before boot and keeps soundFont separate from the palette', () => {
    const url = createProcgenRedirectUrl('https://example.test/index.html?mode=procgen&lanes=32&laneHeight=144&soundFont=warm-bank&preset=game-lydian-lanterns&shape=donut&scoutsEvery=4');
    const target = new URL(url); expect(target.pathname).to.equal('/procgen.html');
    expect([...target.searchParams.keys()]).to.deep.equal(['lanes', 'laneHeight', 'preset', 'soundFont', 'output', 'sound']);
    expect(readProcgenUrlConfig(target.search).settings).to.include({ laneCount: 32, laneHeight: 144, preset: 'game-lydian-lanterns', soundFont: 'warm-bank', output: 'synth', sound: true });
    expect(createProcgenRedirectUrl(target.href)).to.equal(null);
    expect(createProcgenRedirectUrl('https://example.test/?midi=1')).to.equal(null);
    expect(createProcgenRedirectUrl('https://example.test/?procgen=1&output=midi&sound=0')).to.include('output=midi&sound=0');
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
  it('zooms out to the exact lane stack, preserving follow until deliberate pan', () => {
    const { renderer, camera } = cameraFixture();
    camera.setZoom(PROCGEN_MIN_SCALE);
    expect(renderer.scale).to.equal(600 / renderer.world.height); expect(camera.viewport().height).to.equal(renderer.world.height);
    expect(renderer.cameraX).to.equal(0); expect(renderer.cameraY).to.equal(0); expect(renderer.follow).to.equal(true);
    camera.setZoom(3); camera.pan(300, 300);
    expect(renderer.cameraX).to.equal(100); expect(renderer.cameraY).to.equal(100); expect(renderer.follow).to.equal(false);
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
  it('uses the usable CSS viewport and optional overview band across lane count, resize and DPR changes', () => {
    const { renderer, camera } = cameraFixture();
    renderer.canvas.clientWidth = 450; renderer.canvas.clientHeight = 300;
    renderer.canvas.width = 900; renderer.canvas.height = 600; renderer.window.devicePixelRatio = 2;
    renderer.world.height = 4 * 96; renderer.overviewBandHeight = 60;
    camera.setZoom(0.001);
    expect(renderer.scale).to.equal(240 / 384);
    expect(camera.viewport()).to.deep.equal({ width: 720, height: 384, fullHeight: 480, bandHeight: 96 });
    renderer.canvas.clientHeight = 480; renderer.canvas.height = 960; camera.update();
    expect(renderer.scale).to.equal(420 / 384); expect(camera.viewport().height).to.equal(384);
    renderer.world.height = 96; camera.update(); expect(camera.viewport().height).to.equal(96);
    renderer.canvas.clientHeight = 900; renderer.canvas.height = 1800; camera.update();
    expect(renderer.scale).to.equal(840 / 96); expect(camera.viewport().height).to.equal(96);
    camera.dispose();
  });
  it('keeps an explicit overview stable while a closeup band changes the fit threshold', () => {
    const { renderer, camera } = cameraFixture();
    renderer.world.height = 64 * 96; camera.setZoom(0.001);
    expect(renderer.overviewActive).to.equal(true);
    renderer.overviewBandHeight = 120; camera.update();
    expect(renderer.scale).to.equal(480 / (64 * 96)); expect(camera.viewport().height).to.equal(renderer.world.height);
    camera.update(); expect(renderer.overviewActive).to.equal(true);
    renderer.canvas.height = 720; camera.update(); expect(renderer.scale).to.equal(600 / (64 * 96));
    camera.setZoom(renderer.scale * 1.1);
    expect(renderer.overviewActive).to.equal(false); expect(camera.viewport().bandHeight).to.equal(0);
    camera.dispose();
  });
  it('ignores pointer jitter and zero pans while zoom and wheel keep following the moving leader', () => {
    const { renderer, camera, listeners } = cameraFixture();
    camera.pan(0, 0); camera.pan(0.2, 0.2); expect(renderer.follow).to.equal(true);
    listeners.get('pointerdown')({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    listeners.get('pointermove')({ clientX: 102, clientY: 101 }); expect(renderer.follow).to.equal(true);
    listeners.get('pointerup')();
    listeners.get('wheel')({ preventDefault() {}, deltaY: 10 }); expect(renderer.follow).to.equal(true);
    renderer.world.actors[2].x = 800; camera.update(true); expect(renderer.cameraX).to.be.greaterThan(600);
    listeners.get('pointerdown')({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    listeners.get('pointermove')({ clientX: 110, clientY: 100 }); expect(renderer.follow).to.equal(false);
    camera.dispose();
  });
  it('retains the last bounded camera position when no live leader remains', () => {
    const { renderer, camera } = cameraFixture();
    renderer.cameraX = 1234; renderer.cameraY = 432;
    for (const actor of renderer.world.actors) actor.failureReason = 'dead';
    camera.update(true); camera.followFrontier();
    expect(renderer.cameraX).to.equal(1234); expect(renderer.cameraY).to.equal(432); expect(renderer.follow).to.equal(true);
    renderer.world.actors.push({ x: 2000, y: 1000 }); camera.update(true, true);
    expect(renderer.cameraX).to.equal(1880); expect(renderer.cameraY).to.equal(920);
    camera.dispose();
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
