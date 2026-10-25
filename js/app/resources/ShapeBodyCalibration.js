import { verifyShapeBodyAsset, selectShapeBodyTier, shapeBodyFailure } from '../../midi/content/ShapeBodyAsset.js';
import { encodeOwnedAudioWav } from '../midi-ui/OwnedAudioWav.js';
import { hashData, freezeData } from '../../core/CanonicalData.js';

export async function renderShapeBodyCalibration(input, { estimatedPeakBytes = 64 * 1048576, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) shapeBodyFailure('The calibration owner changed.'); }; check();
  if (!input || Object.keys(input).some(key => !['asset', 'modeCount', 'sampleRate', 'seconds'].includes(key)) || !Number.isFinite(input.seconds) || input.seconds < 0.1 || input.seconds > 4 || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 64 * 1048576 || estimatedPeakBytes > 512 * 1048576) shapeBodyFailure('Calibration needs bounded duration and its complete offline reservation.');
  const asset = await verifyShapeBodyAsset(input.asset), tier = selectShapeBodyTier(asset, input), { sampleRate } = tier, frames = Math.ceil(input.seconds * sampleRate), files = [], sites = asset.source.excitationSites, pickups = asset.source.pickupSites;
  let bound = 0;
  for (let site = 0; site < sites.length; site++) for (let channel = 0; channel < 2; channel++) bound = Math.max(bound, tier.modes.reduce((sum, mode) => sum + Math.abs(mode.excitation[site] * mode.pickup[Math.min(channel, pickups.length - 1)] / (2 * Math.PI * mode.frequencyHz)), 0));
  if (!(bound > 0) || !Number.isFinite(bound)) shapeBodyFailure('Degenerate calibration peak bound.'); const gain = 0.8 / bound;
  for (let site = 0; site < sites.length; site++) {
    check(); const pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer), real = new Float64Array(tier.modeCount), imaginary = new Float64Array(tier.modeCount), a = new Float64Array(tier.modeCount), b = new Float64Array(tier.modeCount);
    const residues = tier.modes.map(mode => [0, 1].map(channel => gain * mode.excitation[site] * mode.pickup[Math.min(channel, pickups.length - 1)] / (2 * Math.PI * mode.frequencyHz)));
    for (let mode = 0; mode < tier.modeCount; mode++) { const entry = tier.modes[mode], radius = Math.exp(-Math.log(1000) / (entry.t60Seconds * sampleRate)), angle = 2 * Math.PI * entry.frequencyHz / sampleRate; real[mode] = 1; a[mode] = radius * Math.cos(angle); b[mode] = radius * Math.sin(angle); }
    let peak = 0, squares = 0;
    for (let frame = 0; frame < frames; frame++) {
      let left = 0, right = 0;
      for (let mode = 0; mode < tier.modeCount; mode++) { left += imaginary[mode] * residues[mode][0]; right += imaginary[mode] * residues[mode][1]; const r = real[mode], i = imaginary[mode]; real[mode] = r * a[mode] - i * b[mode]; imaginary[mode] = r * b[mode] + i * a[mode]; }
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.max(Math.abs(left), Math.abs(right)) > 0.800001) shapeBodyFailure('Calibration exceeded the prepared signed-residue peak bound.');
      peak = Math.max(peak, Math.abs(left), Math.abs(right)); squares += left * left + right * right; view.setFloat32(frame * 8, left, true); view.setFloat32(frame * 8 + 4, right, true);
      if (frame % 8192 === 8191) { check(); onProgress({ phase: 'rendering-shape-calibration', completedUnits: site * frames + frame + 1, totalUnits: sites.length * frames }); await yieldControl(); }
    }
    const pcmHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pcm))].map(value => value.toString(16).padStart(2, '0')).join(''), manifest = freezeData({ schema: 'lemmings-shape-body-calibration/v1', assetHash: asset.assetHash, sourceHash: asset.sourceHash, meshHash: asset.meshHash, solver: asset.solver,
      site: { ...sites[site], positionMeters: asset.source.mesh.vertices[sites[site].vertex].map(value => value * asset.source.mesh.scaleMeters) }, pickups, sampleRate, frames, pcmHash, modeIndices: tier.modeIndices, modeCount: tier.modeCount, peak, rms: Math.sqrt(squares / (frames * 2)),
      gain: { applied: gain, law: 'same-all-sites-and-channels;0.8-divided-by-largest-signed-residue-L1-bound', normalization: 'global-body-calibration;no-per-site-loudness-matching' },
      excitation: 'unit-impulse-initial-modal-velocity;not-a-physical-collision', decayUnits: 'amplitude-T60-seconds', tail: { exactCropFrames: frames, truncated: tier.modes.some(mode => mode.t60Seconds * 2 > input.seconds) },
      tier: { ...tier, modes: tier.modes.map(({ index, frequencyHz, t60Seconds, excitation, pickup, salience }) => ({ index, frequencyHz, t60Seconds, excitation, pickup, salience })) }, qualification: 'authored-numerical-calibration;mesh-refinement-listening-and-device-evidence-required' });
    const bytes = encodeOwnedAudioWav(pcm, frames, sampleRate, manifest), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    files.push({ siteId: sites[site].id, bytes, hash, manifest }); check();
  }
  return { schema: 'lemmings-shape-body-calibration-set/v1', assetHash: asset.assetHash, tierHash: await hashData(tier), modeCount: tier.modeCount, sampleRate, frames, files };
}
