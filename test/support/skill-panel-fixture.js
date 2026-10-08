import { NodeFileProvider } from '../../tools/NodeFileProvider.js';
import { FileContainer } from '../../js/data/FileContainer.js';
import { GroundReader } from '../../js/level/GroundReader.js';
import { SkillPanelSprites } from '../../js/render/SkillPanelSprites.js';
import { GameGui } from '../../js/game/GameGui.js';
import { DisplayImage } from '../../js/render/DisplayImage.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';

export async function loadPanelFixture(pack = 'lemmings', ground = 0, palette = null, Sprites = SkillPanelSprites) {
  const files = new NodeFileProvider('.');
  const main = new FileContainer(await files.loadBinary(pack, 'MAIN.DAT'));
  const vga = new FileContainer(await files.loadBinary(pack, `VGAGR${ground}.DAT`));
  const source = new GroundReader(await files.loadBinary(pack, `GROUND${ground}O.DAT`), vga.getPart(0), vga.getPart(1));
  return { sprites: new Sprites(main.getPart(2), main.getPart(6), palette || source.colorPalette), source, main };
}

export function renderPanelFixture(sprites, counts = { [SkillTypes.DIGGER]: 10 }, Gui = GameGui) {
  const stage = { createImage: (display, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    getGuiOverlayDisplay: () => overlay, setGuiOverlayVisible() {} };
  const display = new DisplayImage(stage), overlay = new DisplayImage(stage); overlay.initSize(320, 40);
  const skills = { onCountChanged: new EventHandler(), onSelectionChanged: new EventHandler(),
    getSkill: skill => counts[skill] || 0, getSelectedSkill: () => SkillTypes.UNKNOWN };
  const timer = { speedFactor: 1, tickIndex: 116, eachGameSecond: new EventHandler(), isRunning: () => true,
    getGameTime: () => 7, getGameLeftTimeString: () => '4-52' };
  const victory = { getMinReleaseRate: () => 20, getCurrentReleaseRate: () => 20, getMaxReleaseRate: () => 99,
    getReleaseCount: () => 2, getSurvivorPercentage: () => 0 };
  const game = { getLemmingManager: () => ({ spawnTotal: 2 }), gameDisplay: {}, level: {} };
  const gui = new Gui(game, sprites, skills, timer, victory);
  gui.display = display; gui.render();
  return { gui, display, overlay, skills, counts };
}
