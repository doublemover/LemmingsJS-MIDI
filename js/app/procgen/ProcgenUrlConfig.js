import { DECORATION_CHOICES } from '../../decorations/ProcgenDecorationPacks.js';
import { normalizeSeed } from '../../core/seededRandom.js';
import { PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../../midi/project/ProcgenMidiDefaults.js';
import { normalizeLaneCount, normalizeLaneHeight, DEFAULT_LANE_HEIGHT } from './ProcgenLaneWorld.js';
import { PROCGEN_URL_KEYS, readAudioUrlConfig } from '../StartupUrlConfig.js';
import { PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE } from './ProcgenCameraController.js';

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
const createProcgenShareUrl = ({ url, seed, settings, camera }) => {
  const result = new URL(url), params = result.searchParams;
  for (const key of [...params.keys()]) if (!PROCGEN_URL_KEYS.includes(key)) params.delete(key);
  for (const [key, value] of Object.entries({ seed: normalizeSeed(seed), lanes: settings.laneCount, pack: settings.pack, speed: settings.speed, decoration: settings.decoration,
    laneHeight: settings.laneHeight, output: settings.output || 'synth', sound: settings.sound === false ? '0' : '1', soundFont: settings.soundFont,
    preset: settings.preset, musicMode: settings.mode, cameraX: camera.cameraX, cameraY: camera.cameraY, zoom: camera.scale, follow: camera.follow ? '1' : '0' })) {
    if (value !== undefined) params.set(key, String(typeof value === 'number' ? Math.round(value * 1000000) / 1000000 : value));
  }
  return result.href;
};
export { readProcgenUrlConfig, createProcgenShareUrl };
