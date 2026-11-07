export function measureGestureOnsetResponse(planes, sampleRate, { onsetFrame, gateSeconds = null } = {}) {
  if (!Array.isArray(planes) || planes.length < 1 || planes.length > 2 || ![44100, 48000, 96000].includes(sampleRate) || !Number.isSafeInteger(onsetFrame) || onsetFrame < 0 ||
      planes.some(plane => !(plane instanceof Float32Array) || plane.length !== planes[0].length) || onsetFrame >= planes[0].length || gateSeconds != null && (!Number.isFinite(gateSeconds) || gateSeconds <= 0)) return { status: 'unknown', reason: 'missing-isolated-onset-frame-or-PCM-domain' };
  const block = Math.max(1, Math.round(sampleRate / 1000)), end = Math.min(planes[0].length, onsetFrame + sampleRate * 2), envelope = []; let maximum = 0;
  for (let first = onsetFrame; first < end; first += block) {
    let squares = 0, count = 0; for (const plane of planes) for (let index = first; index < Math.min(end, first + block); index++) { if (!Number.isFinite(plane[index])) return { status: 'unknown', reason: 'nonfinite-PCM' }; squares += plane[index] ** 2; count++; }
    const rms = Math.sqrt(squares / count); maximum = Math.max(maximum, rms); envelope.push(rms);
  }
  if (maximum <= 1e-8) return { status: 'measured-silent', method: 'isolated-onset-1ms-RMS-to25pct-observed-peak-v1', onsetFrame, sampleRate, observedFrames: end - onsetFrame, maximumRms: maximum, timeToReferenceSeconds: null, resolutionSeconds: block / sampleRate };
  const threshold = maximum * 0.25, first = envelope.findIndex(value => value >= threshold), seconds = first * block / sampleRate;
  return { status: 'measured', method: 'isolated-onset-1ms-RMS-to25pct-observed-peak-v1', onsetFrame, sampleRate, observedFrames: end - onsetFrame, maximumRms: maximum, referenceRms: threshold,
    timeToReferenceSeconds: seconds, resolutionSeconds: block / sampleRate, gateSeconds, referenceWithinDeclaredGate: gateSeconds == null ? null : seconds <= gateSeconds, scope: 'digital-relative-rise;not-listener-audibility-or-perceptual-attack' };
}
