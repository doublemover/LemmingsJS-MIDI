const MiB = 1048576;
const profiles = Object.freeze({
  'balanced-v1': Object.freeze({ id: 'balanced-v1', aggregateBytes: 352 * MiB, workerLimitBytes: 320 * MiB, inputReservationBytes: 96 * MiB, maxInputBytes: 32 * MiB, maxInputNodes: 1000000, inputPeakBytes: 96 * MiB, checkpointBytes: 32 * MiB, checkpointPeakBytes: 96 * MiB, checkpointGraphBytes: 16 * MiB, checkpointSemanticBytes: 8 * MiB }),
  'compact-v1': Object.freeze({ id: 'compact-v1', aggregateBytes: 256 * MiB, workerLimitBytes: 192 * MiB, inputReservationBytes: 64 * MiB, maxInputBytes: 16 * MiB, maxInputNodes: 262144, inputPeakBytes: 64 * MiB, checkpointBytes: 16 * MiB, checkpointPeakBytes: 64 * MiB, checkpointGraphBytes: 8 * MiB, checkpointSemanticBytes: 4 * MiB })
});
export function procgenSimulationProfile(id = 'balanced-v1') {
  if (!Object.hasOwn(profiles, id)) throw new Error('Select a declared bounded simulation memory profile.'); return profiles[id];
}
