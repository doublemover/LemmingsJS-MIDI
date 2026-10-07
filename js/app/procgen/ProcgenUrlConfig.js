import { normalizeSeed } from '../../core/seededRandom.js';
import { CHARACTER_COLORS } from '../../lemmings/characterColors.js';
import { CHARACTER_ACCESSORY_CHOICES, CHARACTER_ACCESSORIES } from '../../lemmings/CharacterAccessories.js';
import { GAME_EVENT_MIDI_PRESETS } from '../../midi/project/GameEventMidiPresets.js';
import { normalizeLaneCount } from './ProcgenLaneWorld.js';
import { PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE } from './ProcgenCameraController.js';

const PROCGEN_SHAPES = ['mixed', 'classic', 'rounded_triangle', 'capsule', 'circle', 'circle_two_ears', 'four_lobed_butterfly', 'heart', 'rounded_cube', 'rounded_diamond', 'rounded_head_two_ears', 'six_lobed_flower', 'twelve_scalloped_rosette', 'donut'];
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
  const settings = {}, appearance = {}, camera = {};
  const lanes = numberValue(params, ['lanes'], 1), speed = numberValue(params, ['speed'], 0.1), pack = numberValue(params, ['pack'], 1, 6);
  if (lanes !== undefined) settings.laneCount = normalizeLaneCount(lanes);
  if (speed !== undefined) settings.speed = speed;
  if (pack !== undefined && Number.isInteger(pack)) settings.pack = pack;
  const preset = enumValue(params, ['preset', 'musicPreset'], GAME_EVENT_MIDI_PRESETS.map(p => p.id));
  if (preset) settings.preset = preset;
  const mode = enumValue(params, ['musicMode'], ['steps', 'phrase']);
  if (mode) settings.mode = mode;
  else if (params.has('phrases')) { const value = enumValue(params, ['phrases'], ['1', '0', 'true', 'false']); if (value) settings.mode = ['1', 'true'].includes(value) ? 'phrase' : 'steps'; }
  const shape = enumValue(params, ['shape', 'appearance'], PROCGEN_SHAPES); if (shape) appearance.shape = shape;
  for (const [part, aliases] of [['body', ['bodyColor', 'body']], ['prop', ['propColor', 'accessoryColor']], ['eyewear', ['eyewearColor', 'frameColor']]]) {
    const value = enumValue(params, aliases, ['random', ...CHARACTER_COLORS[part === 'body' ? 'body' : 'prop'].map(c => c.hex)]);
    if (value) appearance[`${part}Color`] = value;
  }
  const accessory = enumValue(params, ['accessory'], CHARACTER_ACCESSORY_CHOICES.map(c => c.id)); if (accessory) appearance.accessory = accessory;
  const eyewear = enumValue(params, ['eyewear'], ['none', ...CHARACTER_ACCESSORIES.eyewear.map(c => c.id)]); if (eyewear) appearance.eyewear = eyewear;
  if (params.get('appearanceSeed')?.trim()) appearance.seed = normalizeSeed(params.get('appearanceSeed'));
  for (const [field, keys, min, max] of [['cameraX', ['cameraX', 'x'], 0, Number.MAX_SAFE_INTEGER], ['cameraY', ['cameraY', 'y'], 0, Number.MAX_SAFE_INTEGER], ['scale', ['zoom', 'scale'], PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE]]) {
    const value = numberValue(params, keys, min, max); if (value !== undefined) camera[field] = value;
  }
  const follow = enumValue(params, ['follow'], ['1', '0', 'true', 'false']);
  if (follow) camera.follow = ['1', 'true'].includes(follow);
  else if (camera.cameraX !== undefined || camera.cameraY !== undefined || camera.scale !== undefined) camera.follow = false;
  return { settings, appearance, camera, ...(params.get('seed')?.trim() ? { seed: normalizeSeed(params.get('seed')) } : {}) };
};
const createProcgenShareUrl = ({ url, seed, settings, appearance, camera }) => {
  const result = new URL(url), params = result.searchParams;
  for (const alias of ['appearance', 'body', 'accessoryColor', 'frameColor', 'musicPreset', 'phrases', 'x', 'y', 'scale']) params.delete(alias);
  for (const [key, value] of Object.entries({ seed: normalizeSeed(seed), lanes: settings.laneCount, pack: settings.pack, speed: settings.speed,
    shape: appearance.shape, bodyColor: appearance.bodyColor || 'random', propColor: appearance.propColor || '#ff8066', eyewearColor: appearance.eyewearColor || '#1f1f1f',
    accessory: appearance.accessory || 'beret', eyewear: appearance.eyewear || 'none', appearanceSeed: appearance.seed || 0,
    preset: settings.preset, musicMode: settings.mode, cameraX: camera.cameraX, cameraY: camera.cameraY, zoom: camera.scale, follow: camera.follow ? '1' : '0' })) {
    if (value !== undefined) params.set(key, String(typeof value === 'number' ? Math.round(value * 1000000) / 1000000 : value));
  }
  return result.href;
};
export { readProcgenUrlConfig, createProcgenShareUrl, PROCGEN_SHAPES };
