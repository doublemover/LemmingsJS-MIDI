import { DECORATION_CHOICES } from '../../decorations/ProcgenDecorationPacks.js';
import { normalizeSeed } from '../../core/seededRandom.js';
import { PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../../midi/project/ProcgenMidiDefaults.js';
import { normalizeLaneCount, normalizeLaneHeight, DEFAULT_LANE_HEIGHT } from './ProcgenLaneWorld.js';
import { readAudioUrlConfig } from '../StartupUrlConfig.js';
import { PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE } from './ProcgenCameraController.js';
import { resolveProcgenStartupIntent } from './workstation/ProcgenStartupIntent.js';
import { sceneRecipeShareIdentity } from './workstation/ProcgenSceneRecipeShare.js';
import { materializePerformanceSceneProject } from './workstation/PerformanceSceneProject.js';

const enumValue = (params, keys, values) => {
  for (const key of keys) if (params.has(key)) { const value = params.get(key); return values.includes(value) ? value : undefined; }
};
const numberValue = (params, keys, min, max = Infinity) => {
  for (const key of keys) if (params.has(key)) {
    const raw = params.get(key), value = Number(raw);
    return raw?.trim() && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
  }
};
const readProcgenUrlConfig = search => {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const settings = { ...readAudioUrlConfig(params) }, appearance = {}, camera = {};
  const decoration = enumValue(params, ['decoration'], DECORATION_CHOICES.map(choice => choice.id));
  if (decoration) settings.decoration = decoration;
  const lanes = numberValue(params, ['lanes'], 1), speed = numberValue(params, ['speed'], 0.1), pack = numberValue(params, ['pack'], 1, 6);
  if (lanes !== undefined) settings.laneCount = normalizeLaneCount(lanes);
  if (params.has('laneHeight')) settings.laneHeight = normalizeLaneHeight(params.get('laneHeight'), DEFAULT_LANE_HEIGHT);
  if (speed !== undefined) settings.speed = speed;
  if (pack !== undefined && Number.isInteger(pack)) settings.pack = pack;
  const preset = enumValue(params, ['preset', 'musicPreset'], PROCGEN_GAME_EVENT_MIDI_PRESETS.map(p => p.id));
  if (preset) settings.preset = preset;
  const mode = enumValue(params, ['musicMode'], ['steps', 'phrase']);
  if (mode) settings.mode = mode;
  else if (params.has('phrases')) { const value = enumValue(params, ['phrases'], ['1', '0', 'true', 'false']); if (value) settings.mode = ['1', 'true'].includes(value) ? 'phrase' : 'steps'; }
  for (const [field, keys, min, max] of [['cameraX', ['cameraX', 'x'], 0, Number.MAX_SAFE_INTEGER], ['cameraY', ['cameraY', 'y'], 0, Number.MAX_SAFE_INTEGER], ['scale', ['zoom', 'scale'], PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE]]) {
    const value = numberValue(params, keys, min, max); if (value !== undefined) camera[field] = value;
  }
  const follow = enumValue(params, ['follow'], ['1', '0', 'true', 'false']);
  if (follow) camera.follow = ['1', 'true'].includes(follow);
  else if (camera.cameraX !== undefined || camera.cameraY !== undefined || camera.scale !== undefined) camera.follow = false;
  return { settings, appearance, camera, ...(params.get('seed')?.trim() ? { seed: normalizeSeed(params.get('seed')) } : {}) };
};
const createProcgenShareUrl = ({ url, seed, settings, sceneOrigin = null, camera, includeCamera = true }) => {
  const result = new URL(url), params = result.searchParams;
  if (!['http:', 'https:'].includes(result.protocol) || !result.pathname.endsWith('/procgen.html')) throw new Error('Starting recipe requires the ProcGen application URL');
  result.username = ''; result.password = '';
  for (const key of [...params.keys()]) params.delete(key);
  result.hash = '';
  const scene = sceneOrigin ? sceneRecipeShareIdentity(sceneOrigin) : null;
  params.set('recipe', scene ? '2' : '1');
  const presentation = includeCamera ? { cameraX: camera?.cameraX, cameraY: camera?.cameraY, zoom: camera?.scale, follow: camera?.follow ? '1' : '0' } : {};
  const physical = scene ? { sceneId: scene.id, sceneRevision: scene.version, sceneHash: scene.hash, sourceHash: scene.sourceHash, scoreHash: scene.recipeHash } :
    { seed: normalizeSeed(seed), lanes: settings.laneCount, pack: settings.pack, speed: settings.speed, decoration: settings.decoration,
      laneHeight: settings.laneHeight, preset: settings.preset, musicMode: settings.mode };
  for (const [key, value] of Object.entries({ ...physical, ...presentation })) {
    if (value !== undefined) params.set(key, String(value));
  }
  if (result.href.length > 2048) throw new Error('Starting recipe link exceeds the supported URL size');
  return result.href;
};
const createProcgenRecipeShareDescriptor = options => {
  if (options.sceneOrigin && !options.sceneOrigin.manifest) throw Object.assign(new Error('This authored scene has no portable original recipe. Export its project or selected take instead.'), { code: 'scene-recipe-unsupported' });
  const url = createProcgenShareUrl(options), target = new URL(url);
  const plan = resolveProcgenStartupIntent({ search: target.search, seed: options.seed,
    legacyProject: null, legacySettings: {}, saved: null, sceneRecipe: options.sceneOrigin ? materializePerformanceSceneProject(options.sceneOrigin) : null });
  const presentation = readProcgenUrlConfig(target.search).camera;
  if (options.includeCamera !== false) for (const field of ['cameraX', 'cameraY', 'scale']) {
    if (options.camera?.[field] !== undefined && presentation[field] !== options.camera[field]) throw new Error('The camera framing is outside the supported recipe range');
  }
  return Object.freeze({ schema: options.sceneOrigin ? 'procgen-recipe-share/v2' : 'procgen-recipe-share/v1', url, scope: 'starting-recipe', recipeIdentity: plan.intentId,
    worldOptions: Object.freeze({ ...plan.worldOptions }), sourceCompatibility: 'unverified-on-recipient',
    ...(options.sceneOrigin ? { scene: Object.freeze({ ...sceneRecipeShareIdentity(options.sceneOrigin), title: options.sceneOrigin.manifest.title }), sourceCompatibility: 'requires-pinned-build-and-assets' } : {}),
    includesCamera: options.includeCamera !== false, camera: Object.freeze(presentation), omitted: Object.freeze([
      'edited terrain and routes', 'current actors', 'instrument patches and external assets',
      'recorded takes and audio', 'custom worker and population policies', 'local devices and output permissions'
    ]) });
};
export { readProcgenUrlConfig, createProcgenShareUrl, createProcgenRecipeShareDescriptor };
