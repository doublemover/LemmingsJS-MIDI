// Pure numerical admission shared by offline fixture producers and their controls.
export function requireFiniteMetric(value, name = 'metric') {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Nonfinite or missing PCM ' + name + '.');
  return value;
}

export function admitPcmChannels(channels, { expectedChannels = channels?.length, expectedFrames = channels?.[0]?.length } = {}) {
  if (!Array.isArray(channels) || !Number.isSafeInteger(expectedChannels) || expectedChannels < 1 || channels.length !== expectedChannels ||
      !Number.isSafeInteger(expectedFrames) || expectedFrames < 1) throw new TypeError('Invalid required PCM shape.');
  for (let channel = 0; channel < expectedChannels; channel++) {
    const values = channels[channel];
    if (!(values instanceof Float32Array || values instanceof Float64Array) || values.length !== expectedFrames) throw new TypeError('PCM channel length mismatch.');
    for (let frame = 0; frame < expectedFrames; frame++) if (!Number.isFinite(values[frame])) throw new TypeError('Nonfinite PCM at channel ' + channel + ', frame ' + frame + '.');
  }
  if (!Number.isSafeInteger(expectedChannels * expectedFrames)) throw new TypeError('PCM sample count exceeds exact range.');
  return Object.freeze({ channels: expectedChannels, frames: expectedFrames, samples: expectedChannels * expectedFrames, nonfinite: 0 });
}

export function admitPcmBuffer(buffer, expectedChannels) {
  if (!buffer || !Number.isSafeInteger(buffer.sampleRate) || buffer.sampleRate <= 0 || buffer.numberOfChannels !== expectedChannels) throw new TypeError('Invalid rendered PCM buffer.');
  const channels = Array.from({ length: expectedChannels }, (_, index) => buffer.getChannelData(index));
  admitPcmChannels(channels, { expectedChannels, expectedFrames: buffer.length }); return channels;
}

export function measurePcmWindow(channels, sampleRate, fromSeconds, toSeconds) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds) ||
      fromSeconds < 0 || toSeconds <= fromSeconds || !Array.isArray(channels) || !channels.length) throw new TypeError('Invalid PCM window.');
  const first = Math.ceil(fromSeconds * sampleRate), last = Math.floor(toSeconds * sampleRate), frames = last - first, samples = frames * channels.length;
  if (!Number.isSafeInteger(samples) || samples < 1 || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)) throw new TypeError('Empty PCM window.');
  let square = 0, peak = 0, dc = 0, maximumDelta = 0, fullScaleSamples = 0, aboveKneeSamples = 0;
  for (const values of channels) {
    if (!(values instanceof Float32Array || values instanceof Float64Array) || last > values.length) throw new TypeError('PCM window exceeds required channel.');
    for (let frame = first; frame < last; frame++) {
      const value = requireFiniteMetric(values[frame], 'sample'), absolute = Math.abs(value);
      square += value * value; dc += value; peak = Math.max(peak, absolute);
      if (frame > first) maximumDelta = Math.max(maximumDelta, Math.abs(value - values[frame - 1]));
      if (absolute >= 1) fullScaleSamples++; if (absolute > 0.7) aboveKneeSamples++;
    }
  }
  const result = { rms: Math.sqrt(square / samples), peak, dc: dc / samples, maximumDelta, fullScaleSamples, aboveKneeSamples, frames, samples, nonfinite: 0 };
  for (const [key, value] of Object.entries(result)) requireFiniteMetric(value, key);
  return Object.freeze(result);
}

export function comparePcmChannels(expected, actual) {
  const shape = admitPcmChannels(expected); admitPcmChannels(actual, { expectedChannels: shape.channels, expectedFrames: shape.frames });
  let error = 0;
  for (let channel = 0; channel < shape.channels; channel++) for (let frame = 0; frame < shape.frames; frame++)
    error = Math.max(error, Math.abs(expected[channel][frame] - actual[channel][frame]));
  return requireFiniteMetric(error, 'comparison error');
}

export function admitPcmMetrics(report, requiredPaths) {
  if (!report || !Array.isArray(requiredPaths) || !requiredPaths.length) throw new TypeError('Required PCM metrics are missing.');
  for (const path of requiredPaths) requireFiniteMetric(path.split('.').reduce((value, key) => value?.[key], report), path);
  return true;
}
