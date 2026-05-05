import {
  ActionDiggSystem,
  DisplayImage,
  EventHandler,
  Frame,
  GameGui,
  GamepadInputController,
  HistoryStore,
  Level,
  Mask,
  MidiEventRouter,
  MidiScheduler,
  MiniMap,
  ObjectManager,
  SkillTypes,
  Stage,
  estimateBytes,
  fileURLToPath,
  makeCanvas,
  makeContext,
  makePalette,
  measureN,
  nsToMs,
  parseArgs,
  path,
  percentile,
  setupRenderEnvironment,
  summarizeSamples,
  toNumberOrNaN,
  toPositiveInt,
  withGlobalStubs
} from './shared.js';
const runDirtyRectBench = ({ iterations, rectsPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const stageCanvas = makeCanvas(640, 360);
  const stage = new Stage(stageCanvas);
  stage.setGuiEnabled(false);
  stage.gameImgProps.display.initSize(640, 320);
  stage.updateStageSize();

  const display = stage.gameImgProps.display;
  const img = display.getImageData();
  const width = display.getWidth();
  const height = display.getHeight();
  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      for (let r = 0; r < rectsPerIter; r += 1) {
        const rw = 4 + ((i + r) % 12);
        const rh = 3 + ((i + (r * 3)) % 10);
        const x = (i * 31 + r * 47) % Math.max(1, width - rw);
        const y = (i * 17 + r * 29) % Math.max(1, height - rh);
        display.markDirtyRect(x, y, rw, rh);
      }
      stage.draw(stage.gameImgProps, img);
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  stage.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});
const runTileCompositionBench = ({ iterations, tilesPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const stageCanvas = makeCanvas(960, 540);
  const stage = new Stage(stageCanvas);
  stage.setGuiEnabled(false);
  stage.gameImgProps.display.initSize(960, 512);
  stage.updateStageSize();

  const display = stage.gameImgProps.display;
  display.setDirtyTileSize(32);
  const img = display.getImageData();
  const width = display.getWidth();
  const height = display.getHeight();
  const tileSize = 32;

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      for (let t = 0; t < tilesPerIter; t += 1) {
        const x = ((i * 37) + (t * 59)) % Math.max(1, width - tileSize);
        const y = ((i * 23) + (t * 43)) % Math.max(1, height - tileSize);
        display.markPresentDirtyRect(x, y, tileSize, tileSize);
      }
      stage.draw(stage.gameImgProps, img);
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  stage.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});
const runMarchingAntBench = ({ iterations, repeats }) => {
  const stage = {
    createImage(_display, width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    redraw() {},
    setGameViewPointPosition() {}
  };
  const display = new DisplayImage(stage);
  display.initSize(640, 360);
  display.clear(0);

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const offset = i & 15;
      display.drawMarchingAntRect(32, 24, 220, 120, 4, offset);
      display.drawMarchingAntRect(300, 32, 96, 52, 3, offset + 2);
      display.drawMarchingAntRect(120, 180, 300, 100, 5, offset + 4, 0xFF00FFFF, 0xFF0044AA);
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
};
const makeGuiDisplay = () => ({
  worldDataSize: { width: 320, height: 40 },
  stage: { updateStageSize() {} },
  onMouseDown: new EventHandler(),
  onMouseUp: new EventHandler(),
  onMouseRightDown: new EventHandler(),
  onMouseRightUp: new EventHandler(),
  onDoubleClick: new EventHandler(),
  onMouseMove: new EventHandler(),
  initSize(width, height) { this.worldDataSize = { width, height }; },
  setBackground() {},
  redraw() {},
  drawRect() {},
  drawFrame() {},
  drawFrameCovered() {},
  drawFrameResized() {},
  drawStippleRect() {},
  drawMarchingAntRect() {},
  drawHorizontalLine() {},
  setPixel() {}
});
const runGuiOverlayBench = ({ iterations, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();

  const skills = {
    onCountChanged: new EventHandler(),
    onSelectionChanged: new EventHandler(),
    getSelectedSkill() { return SkillTypes.BASHER; },
    getSkill() { return 5; },
    clearSelectedSkill() { return false; }
  };
  const timer = {
    speedFactor: 1,
    tickIndex: 99,
    eachGameSecond: new EventHandler(),
    isRunning() { return false; },
    getGameTime() { return 0; },
    getGameLeftTimeString() { return '1-00'; },
    getGameLeftTimeSString() { return '1-00'; }
  };
  const victory = {
    releaseRate: 20,
    getMinReleaseRate() { return 1; },
    getCurrentReleaseRate() { return this.releaseRate; },
    getMaxReleaseRate() { return 99; },
    getReleaseCount() { return 25; },
    getSurvivorPercentage() { return 75; }
  };
  const panelSprite = {
    width: 320,
    height: 40,
    getData() { return new Uint8ClampedArray(320 * 40 * 4); }
  };
  const sprites = {
    getPanelSprite() { return panelSprite; },
    getNumberSpriteEmpty() { return { id: 'empty' }; },
    getNumberSpriteLeft(v) { return { id: `L${v}` }; },
    getNumberSpriteRight(v) { return { id: `R${v}` }; },
    getLetterSprite(ch) { return { id: `G${ch}` }; }
  };
  const game = {
    queueCommand() {},
    showDebug: false,
    level: {
      width: 100,
      height: 50,
      mechanics: {},
      objects: [],
      screenPositionX: 0,
      getGroundMaskLayer() { return { countMaskInRect() { return 0; } }; }
    },
    gameDisplay: { hoverLemming: null },
    lemmingManager: { setMiniMap() {} },
    getLemmingManager() { return { spawnTotal: 20, getLemmings() { return []; } }; }
  };

  const gui = new GameGui(game, sprites, skills, timer, victory);
  gui.display = makeGuiDisplay();
  gui.backgroundChanged = true;
  gui.gameTimeChanged = true;
  gui.skillsCountChanged = true;
  gui.releaseRateChanged = true;

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      gui.nukePrepared = (i & 1) === 0;
      gui._hoverPanelIdx = gui.nukePrepared ? 11 : 10;
      gui.gameTimeChanged = true;
      gui.render();
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  gui.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});
const runOverlayPlaneBench = ({ iterations, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const stageCanvas = makeCanvas(640, 360);
  const stage = new Stage(stageCanvas);
  stage.setGuiEnabled(false);
  stage.gameImgProps.display.initSize(640, 320);
  stage.updateStageSize();
  stage.redraw(true);

  const overlay = stage.getGameOverlayDisplay();

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const offset = i & 15;
      overlay.clear(0x00000000);
      overlay.drawMarchingAntRect(32, 24, 220, 120, 4, offset);
      overlay.drawMarchingAntRect(300, 40, 96, 52, 3, offset + 2);
      stage.setGameOverlayVisible(true);
      stage.redraw();
    }
    overlay.clear(0x00000000);
    stage.setGameOverlayVisible(false);
    stage.redraw();
  };

  const measured = measureN(repeats + 1, runOnce);
  stage.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});
const makeScaleFrame = (size = 16) => {
  const width = Math.max(2, Math.trunc(size));
  const height = width;
  const pixels = new Uint32Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const idx = row + x;
      const r = (x * 17 + y * 9) & 0xff;
      const g = (x * 11 + y * 13) & 0xff;
      const b = (x * 7 + y * 19) & 0xff;
      pixels[idx] = 0xFF000000 | (b << 16) | (g << 8) | r;
      mask[idx] = ((x + y) % 5) === 0 ? 0 : 1;
    }
  }
  return {
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    getBuffer() { return pixels; },
    getMask() { return mask; },
    _version: 1
  };
};
const runScaledBlitBench = ({ iterations, repeats }) => {
  const stage = {
    createImage(_display, width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    redraw() {},
    setGameViewPointPosition() {}
  };
  const display = new DisplayImage(stage);
  display.initSize(640, 360);
  display.clear(0);
  const frame = makeScaleFrame(16);
  const modes = ['nearest', 'xbrz', 'hqx'];

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const mode = modes[i % modes.length];
      const x = (i * 13) % 560;
      const y = (i * 7) % 280;
      display._blit(frame, x, y, {
        size: { width: 64, height: 64 },
        scaleMode: mode
      });
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
};
export {
  runDirtyRectBench,
  runTileCompositionBench,
  runMarchingAntBench,
  makeGuiDisplay,
  runGuiOverlayBench,
  runOverlayPlaneBench,
  makeScaleFrame,
  runScaledBlitBench
};