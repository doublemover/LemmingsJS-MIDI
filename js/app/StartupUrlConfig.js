// Public run links deliberately omit appearance and detailed solver policy.
const PROCGEN_URL_KEYS = Object.freeze(['seed', 'lanes', 'laneHeight', 'pack', 'speed', 'decoration', 'preset', 'musicMode', 'output', 'sound', 'soundFont', 'cameraX', 'cameraY', 'zoom', 'follow']);
const readAudioUrlConfig = params => ({
  output: params.get('output') === 'midi' ? 'midi' : 'synth',
  sound: params.get('sound') !== '0',
  ...(params.get('soundFont')?.trim() ? { soundFont: params.get('soundFont').trim().slice(0, 128) } : {})
});
const createProcgenRedirectUrl = href => {
  if (!href) return null;
  const source = new URL(href);
  const params = source.searchParams;
  if (source.pathname.endsWith('/procgen.html') || !(params.get('mode') === 'procgen' || params.get('procgen') === '1')) return null;
  const target = new URL('procgen.html', source);
  for (const key of PROCGEN_URL_KEYS) if (params.has(key)) target.searchParams.set(key, params.get(key));
  const audio = readAudioUrlConfig(params);
  target.searchParams.set('output', audio.output); target.searchParams.set('sound', audio.sound ? '1' : '0');
  return target.href;
};
export { PROCGEN_URL_KEYS, readAudioUrlConfig, createProcgenRedirectUrl };
