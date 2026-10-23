import { createMidiProject, sanitizeMidiProject } from '../../../midi/project/MidiProject.js';
import { applyProcgenGameEventMidiPreset, PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../../../midi/project/ProcgenMidiDefaults.js';
import { normalizeSeed } from '../../../core/seededRandom.js';
import { DEFAULT_LANE_HEIGHT, normalizeLaneCount, normalizeLaneHeight } from '../ProcgenLaneWorld.js';
import { DECORATION_CHOICES } from '../../../decorations/ProcgenDecorationPacks.js';
import { procgenMusicDefaults } from '../ProcgenMusicProject.js';
import { createProcgenWorkstationProject } from './ProcgenWorkstationProject.js';

const RECIPE_KEYS = ['recipe', 'seed', 'lanes', 'speed', 'pack', 'laneHeight', 'preset', 'musicPreset', 'musicMode', 'phrases', 'decoration'];
const boundedNumber = (params, key, min, max, integer = false) => {
  if (!params.has(key)) return null;
  const raw = params.get(key)?.trim(), value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(`Invalid recipe ${key}`);
  return value;
};
const resolveProcgenStartupIntent = ({ search = '', seed, legacyProject, legacySettings = {}, saved = null } = {}) => {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const hasRecipe = RECIPE_KEYS.some(key => params.has(key));
  if (hasRecipe && params.toString().length > 2048) throw new Error('Recipe URL exceeds the supported size');
  const legacySaved = saved?.project?.procgen && saved.project.procgen.version !== 2;
  const mode = hasRecipe ? 'recipe' : saved?.project && !legacySaved ? 'previous-setup' : 'fresh';
  const baseSeed = normalizeSeed(seed ?? legacySettings.seed ?? 777);
  const provenance = {}, diagnostics = [];
  if (legacySaved) diagnostics.push('legacy-project-requires-explicit-physical-conversion');
  let project, worldOptions, transport;
  if (mode === 'recipe') {
    if (params.has('recipe') && params.get('recipe') !== '1') throw new Error('Unsupported recipe version');
    const laneCount = boundedNumber(params, 'lanes', 1, 1024, true) ?? 8;
    const speed = boundedNumber(params, 'speed', 0.1, 1000) ?? 3;
    const pack = boundedNumber(params, 'pack', 1, 6, true) ?? 1;
    const laneHeight = params.has('laneHeight') ? normalizeLaneHeight(boundedNumber(params, 'laneHeight', 96, 256, true), DEFAULT_LANE_HEIGHT) : DEFAULT_LANE_HEIGHT;
    if (params.has('seed') && !params.get('seed')?.trim()) throw new Error('Invalid recipe seed');
    const recipeSeed = params.has('seed') ? normalizeSeed(params.get('seed')) : baseSeed;
    if (!params.has('seed')) diagnostics.push('recipe-seed-generated');
    const preset = params.get('preset') || params.get('musicPreset') || 'game-iron-ensemble';
    const musicMode = params.get('musicMode') || (['1', 'true'].includes(params.get('phrases')) ? 'phrase' : 'steps');
    if (!PROCGEN_GAME_EVENT_MIDI_PRESETS.some(item => item.id === preset)) throw new Error('Invalid recipe preset');
    if (!['steps', 'phrase'].includes(musicMode)) throw new Error('Invalid recipe music mode');
    if (params.has('decoration') && !DECORATION_CHOICES.some(item => item.id === params.get('decoration'))) throw new Error('Invalid recipe decoration');
    const base = applyProcgenGameEventMidiPreset(createMidiProject(), preset, { mode: musicMode });
    const musical = sanitizeMidiProject({ ...base, global: { ...base.global,
      laneMusic: procgenMusicDefaults(base, { laneCount, preset, mode: musicMode }) } });
    project = createProcgenWorkstationProject(musical, { seed: recipeSeed, lanes: Array.from({ length: laneCount }, () => ({})) });
    worldOptions = { seed: recipeSeed, laneCount, laneHeight, pack, speed };
    transport = { bpm: 120, gameSpeed: speed, speedMode: 'bpm' };
    for (const key of Object.keys(worldOptions)) provenance[key] = params.has(key === 'laneCount' ? 'lanes' : key) ? 'recipe-url' : key === 'seed' ? 'generated' : 'recipe-v1-default';
  } else if (mode === 'previous-setup') {
    project = createProcgenWorkstationProject(sanitizeMidiProject(saved.project), { seed: baseSeed });
    worldOptions = { seed: baseSeed, laneCount: project.procgen.lanes.length, laneHeight: legacySettings.laneHeight ?? DEFAULT_LANE_HEIGHT,
      pack: legacySettings.pack ?? 1, speed: saved.transport?.gameSpeed ?? legacySettings.speed ?? 1 };
    transport = { bpm: 120, gameSpeed: 1, speedMode: 'bpm', ...(saved.transport || {}) };
    provenance.seed = 'fresh-seed'; provenance.laneCount = 'previous-setup'; provenance.speed = 'previous-setup';
  } else {
    const laneCount = normalizeLaneCount(legacySettings.laneCount ?? 8);
    const source = legacyProject?.procgen?.version === 2 ? legacyProject : { ...(legacyProject || createMidiProject()), procgen: undefined };
    project = createProcgenWorkstationProject(sanitizeMidiProject(source),
      { seed: baseSeed, lanes: Array.from({ length: laneCount }, (_, index) => source.procgen?.lanes?.[index] || {}) });
    worldOptions = { seed: baseSeed, laneCount, laneHeight: legacySettings.laneHeight ?? DEFAULT_LANE_HEIGHT,
      pack: legacySettings.pack ?? 1, speed: legacySettings.speed ?? 3 };
    transport = { bpm: 120, gameSpeed: worldOptions.speed, speedMode: 'bpm' };
    provenance.seed = 'fresh-seed'; provenance.laneCount = 'preference-or-default'; provenance.speed = 'preference-or-default';
  }
  return { schemaVersion: 1, intentId: `startup-v1:${mode}:${worldOptions.seed}:${worldOptions.laneCount}`,
    mode, sourceRevision: 1, project, worldOptions, transport, provenance, diagnostics };
};
export { resolveProcgenStartupIntent };
