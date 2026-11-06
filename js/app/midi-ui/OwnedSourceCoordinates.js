const shift = (value, frames) => value == null ? value : value + frames;
export function mapOwnedCommandFrames(input, engineId, frames) {
  const packet = [...input], opcode = packet[3], mask = packet[15]; packet[1] += frames;
  if (opcode === 1 || opcode === 6 || opcode === 3 && packet[16] > 0) packet[16] += frames;
  if (opcode === 1 && engineId === 'worklet-sample' && packet[30] === 1) { packet[24] += frames; packet[25] += frames; }
  if (opcode === 1 && ['worklet-wind', 'worklet-friction', 'worklet-texture', 'worklet-spectrum'].includes(engineId) && packet[38] === 1) { packet[34] += frames; packet[35] += frames; }
  if (opcode === 2 && engineId === 'worklet-sample' && mask & 8) { packet[18] += frames; packet[19] += frames; }
  if (opcode === 2 && engineId === 'worklet-seed-layers' && mask & 1024) { packet[40] += frames; packet[41] += frames; }
  return packet;
}
const mapReceipt = (receipt, frames) => receipt ? { ...receipt, deltas: receipt.deltas.map(delta => ({ ...delta, applyFrame: shift(delta.applyFrame, frames) })) } : receipt;
const mapTravelReceipt = (receipt, frames) => receipt ? { ...receipt, ...(receipt.targetFrame != null ? { targetFrame: shift(receipt.targetFrame, frames) } : {}),
  ...(receipt.firstOutputFrame != null ? { firstOutputFrame: shift(receipt.firstOutputFrame, frames), endOutputFrame: shift(receipt.endOutputFrame, frames) } : {}) } : receipt;
export function mapOwnedHostFrames(input, frames, rate, frameDomain = 'source-continuation-frame') {
  const seconds = frames / rate;
  return { ...input, frameDomain, leases: input.leases.map(([key, frame]) => [key, shift(frame, frames)]),
    inFlight: input.inFlight.map(command => ({ ...command, frame: shift(command.frame, frames), data: mapOwnedCommandFrames(command.data, input.engineId, frames) })),
    voices: input.voices.map(voice => ({ ...voice, start: voice.start + seconds, releaseAt: voice.releaseAt + seconds, end: voice.end + seconds,
      initialLeaseEndFrame: shift(voice.initialLeaseEndFrame, frames), requestedLeaseEndFrame: shift(voice.requestedLeaseEndFrame, frames), effectiveLeaseEndFrame: shift(voice.effectiveLeaseEndFrame, frames),
      pendingLeases: voice.pendingLeases.map(([sequence, frame]) => [sequence, shift(frame, frames)]), performanceFrame: shift(voice.performanceFrame, frames), physicalFrame: shift(voice.physicalFrame, frames), panFrame: shift(voice.panFrame, frames),
      onsetPerformance: mapReceipt(voice.onsetPerformance, frames),
      positionFrontier: voice.positionFrontier ? { ...voice.positionFrontier, frame: shift(voice.positionFrontier.frame, frames), lastEndFrame: shift(voice.positionFrontier.lastEndFrame, frames), lastSeekFrameIsInitial: voice.positionFrontier.lastSeekFrameIsInitial ?? voice.positionFrontier.lastSeekFrame < 0, lastSeekFrame: (voice.positionFrontier.lastSeekFrameIsInitial ?? voice.positionFrontier.lastSeekFrame < 0) ? voice.positionFrontier.lastSeekFrame : shift(voice.positionFrontier.lastSeekFrame, frames) } : null,
      circularTravel: voice.circularTravel ? { ...voice.circularTravel, lastEndFrame: shift(voice.circularTravel.lastEndFrame, frames) } : null,
      seedLayerMotion: voice.seedLayerMotion ? { ...voice.seedLayerMotion, lastEndFrame: shift(voice.seedLayerMotion.lastEndFrame, frames), receipt: mapTravelReceipt(voice.seedLayerMotion.receipt, frames), lastMotion: mapTravelReceipt(voice.seedLayerMotion.lastMotion, frames) } : null })) };
}
