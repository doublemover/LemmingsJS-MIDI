import { getOwnedSourceProfile } from './OwnedSourceProfiles.js';
import { loadOwnedWorkletModule } from './OwnedWorkletModuleCache.js';
import { retireOwnedProcessorState } from './OwnedProcessorRetirement.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { admitBrowserAudioTransport } from '../../runtime/BrowserDeploymentPolicy.js';

export async function prepareDirectOwnedSineSource({ context, destination, resources, owner, generation, signal, isCurrent = () => true, onFailure = () => {} } = {}) {
  signal?.throwIfAborted();
  if (!context || context.state !== 'running' || !destination || !resources?.reserveWorkletRuntime || !isCurrent() || admitBrowserAudioTransport({ context }).status !== 'available') throw new Error('Enable the owned browser output before preparing its independent source.');
  const source = getOwnedSourceProfile('worklet-sine'), scope = createProcgenRetirementScope(), lease = resources.reserveWorkletRuntime(owner, generation, 4096, 0, true);
  let node = null, gain = null, transferred = false, prepared = false, retired = false, disposed = false, proof = null, resolveProof;
  const remote = new Promise(resolve => { resolveProof = resolve; });
  const changed = () => {
    if (context.state === 'closed') { retired = true; resolveProof({ stage: 'closed-context' }); return; }
    if (prepared && context.state !== 'running') { try { gain.gain.setValueAtTime(0, context.currentTime); } catch {} try { onFailure(new Error('The direct browser context stopped; restart explicitly from a paused source.')); } catch {} }
  };
  const dispose = () => {
    if (scope.getReceipt()) return scope.getReceipt(); disposed = true;
    try { gain?.gain.setValueAtTime(0, context.currentTime); node?.disconnect(); gain?.disconnect(); } catch {}
    return scope.retire([{ name: 'direct-owned-native-processor', run: async () => {
      if (node && !retired && context.state !== 'closed') {
        if (!transferred) { await retireOwnedProcessorState(node, context); retired = true; }
        else { let timer; try { await Promise.race([remote, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('The direct processor retains unconfirmed state until its context closes.')), 4000); })]); } finally { clearTimeout(timer); } }
      }
      if (node && !retired && context.state !== 'closed') throw new Error('The direct source state still belongs to its native processor.');
      context.removeEventListener('statechange', changed); signal?.removeEventListener('abort', abort); if (node) node.onprocessorerror = null; node = gain = null; lease.release();
    } }]);
  };
  const abort = () => { try { onFailure(signal.reason || new Error('Direct source preparation was canceled.')); } catch {} dispose(); };
  context.addEventListener('statechange', changed); signal?.addEventListener('abort', abort, { once: true });
  try {
    await loadOwnedWorkletModule(context, source, resources); signal?.throwIfAborted();
    if (disposed || !isCurrent() || context.state !== 'running') throw new Error('The direct browser source owner changed during preparation.');
    gain = context.createGain(); gain.gain.setValueAtTime(0, context.currentTime); gain.connect(destination);
    node = new globalThis.AudioWorkletNode(context, 'lemmings-owned-sine-v1', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { maxVoices: 8 } }); node.connect(gain);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The direct owned sine processor did not become ready.')), 5000);
      node.onprocessorerror = () => { const error = new Error('The direct owned sine processor failed.'); if (!prepared) { clearTimeout(timer); reject(error); } else { try { onFailure(error); } catch {} } };
      node.port.onmessage = event => {
        const data = event.data; if (data?.type !== 'ready') return; clearTimeout(timer);
        if (data.protocol !== 1 || data.engineId !== source.runtime.engineId || data.engineVersion !== source.runtime.engineVersion || data.runtimeABI !== source.runtime.runtimeABI || data.buildId !== source.runtime.buildId || data.retirementProtocol !== 1 || data.width !== source.width || data.capacity !== 512 || data.maxVoices !== 8 || data.sampleRate !== context.sampleRate) reject(new Error('The direct source runtime differs from its exact owned engine contract.')); else resolve();
      };
    });
    signal?.throwIfAborted(); if (disposed || !isCurrent()) throw new Error('The direct source owner changed before publication.'); prepared = true;
    return Object.freeze({ sampleRate: context.sampleRate, maxVoices: 8,
      transferPort() { if (disposed || transferred || !isCurrent()) throw new Error('The direct source port has already transferred or retired.'); transferred = true; node.port.onmessage = null; return node.port; },
      mute() { if (gain && context.state !== 'closed') gain.gain.setValueAtTime(0, context.currentTime); },
      activate() { if (disposed || !transferred || !isCurrent() || context.state !== 'running') throw new Error('The direct source is not attached to a current enabled context.'); gain.gain.setValueAtTime(1, context.currentTime); },
      confirmRetirement(value) { if (!transferred || retired || value?.stage !== 'processor-state-released' || value.renderingContinues !== false || !Number.isSafeInteger(value.frame) || value.frame < 0) return false; retired = true; proof = value; resolveProof(value); return true; },
      onOwnerStop() { try { gain?.gain.setValueAtTime(0, context.currentTime); } catch {} try { onFailure(new Error('The direct audio performance owner stopped.')); } catch {} return dispose(); },
      state: () => ({ prepared, transferred, disposed, retired, proof, sampleRate: context.sampleRate, engineId: 'worklet-sine', path: 'transferred-native-worklet-port;no-main-thread-command-producer' }), dispose });
  } catch (error) { const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
