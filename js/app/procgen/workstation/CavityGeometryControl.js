import { planTerrainCommand } from '../TerrainAuthoringAdapter.js';

export function prepareCavityGeometryControl({ scene, world, controlId, value, transactionId }) {
  const control = scene?.physicalControls.find(control => control.id === controlId), target = control?.target.split(';')[0], parts = target?.split(':'), numbers = parts?.slice(1).map(Number);
  if (!control || control.scope !== 'geometry' || !Number.isSafeInteger(value) || value < control.minimum || value > control.maximum || (value - control.minimum) % control.step || !parts || numbers.some(number => !Number.isSafeInteger(number) || number < 0) || typeof transactionId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(transactionId)) throw new TypeError('Choose a bounded current chamber control and integer value.');
  const spans = [];
  if (parts[0] === 'cavity-square' && numbers.length === 4) {
    const [right, bottom, minimum, maximum] = numbers;
    if (minimum !== 8 || maximum !== 16 || control.minimum !== minimum || control.maximum !== maximum || control.step !== 8 || right < maximum + 1 || bottom < maximum + 1) throw new TypeError('The chamber square definition changed.');
    for (let y = bottom - maximum - 1; y < bottom; y++) {
      if (y < bottom - value) spans.push({ x1: right - maximum - 1, x2: right, y, solid: true });
      else spans.push({ x1: right - maximum - 1, x2: right - value, y, solid: true }, { x1: right - value, x2: right, y, solid: false });
      spans.push({ x1: right, x2: right + 1, y, solid: true });
    }
  } else if (parts[0] === 'cavity-throat' && numbers.length === 2 && control.minimum === 0 && control.maximum === 1 && control.step === 1) spans.push({ x1: numbers[0], x2: numbers[0] + 1, y: numbers[1], solid: value === 0 });
  else throw new TypeError('The scene has no supported chamber geometry control.');
  const terrain = { operation: 'replaceSolid', generation: world.generation, transactionId, expectedScoreRevision: world.terrainScoreState.serial, spans, occupancyPolicy: 'reject-occupied', maxCells: 512, maxChunks: 4 };
  const plan = planTerrainCommand(terrain, world); if (plan.status !== 'prepared') throw new Error('Chamber edit unavailable: ' + plan.reason);
  return Object.freeze({ id: transactionId, kind: 'terrain-edit', origin: 'manual', transactionId, target: { generation: world.generation }, parameters: { terrain: plan.command } });
}
