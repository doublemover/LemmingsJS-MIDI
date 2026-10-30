const audio = (type = 'audioStereo', inputIndex = 0) => ({ type, channels: type === 'audioMono' ? 1 : 2, unit: 'audio-amplitude', inputIndex, outputIndex: 0, multiple: true });
const envelope = () => ({ type: 'detectorEnvelope', channels: 1, unit: 'normalized-amplitude', inputIndex: 0, outputIndex: 0, multiple: false });
const modulation = () => ({ type: 'parameterModulation', channels: 1, unit: 'linear-amplitude', inputIndex: null, outputIndex: 0, parameter: 'gain', multiple: false });
export const isAudioEffectPort = port => port?.type === 'audioMono' || port?.type === 'audioStereo';
export function describeEffectNodePorts(kind, parameters = {}) {
  let inputs = { audio: audio() }, outputs = { audio: audio() };
  if (kind === 'bus-in') inputs = {};
  else if (kind === 'bus-out') outputs = {};
  else if (kind === 'sidechain-in') { inputs = {}; outputs = { audio: audio(parameters.inputLayout) }; }
  else if (['multiband-vocoder', 'ring-modulator'].includes(kind)) inputs = { donorAudio: audio(parameters.donorLayout, 0), carrierAudio: audio('audioStereo', 1) };
  else if (kind === 'envelope-detector') { inputs = { audio: audio(parameters.inputLayout) }; outputs = { envelope: envelope() }; }
  else if (kind === 'envelope-mapping') { inputs = { envelope: envelope() }; outputs = { modulation: modulation() }; }
  else if (kind === 'modulated-gain') inputs = { audio: audio(), gain: modulation() };
  else if (kind === 'stereo-to-mono') outputs = { audio: audio('audioMono') };
  else if (kind === 'mono-to-stereo') inputs = { audio: audio('audioMono') };
  const legacy = ports => { const port = Object.values(ports)[0]; return !port ? null : port.type; };
  return { input: legacy(inputs), output: legacy(outputs), inputs, outputs };
}
