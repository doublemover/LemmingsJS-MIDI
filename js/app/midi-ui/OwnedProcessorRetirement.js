let nextRetirement = 0;
export function retireOwnedProcessorState(node, context, { timeoutMs = 4000 } = {}) {
  if (!node?.port?.postMessage || !context || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 4000 || nextRetirement === Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid owned processor retirement.');
  if (context.state === 'closed') { node.port.onmessage = null; node.port.close(); return Promise.resolve(Object.freeze({ stage: 'closed-context', acousticReceipt: false })); }
  const retirementId = ++nextRetirement;
  return new Promise((resolve, reject) => {
    let finished = false;
    const complete = (error, receipt) => {
      if (finished) return; finished = true; clearTimeout(timer);
      try { context.removeEventListener?.('statechange', changed); node.port.onmessage = null; } catch (failure) { error ||= failure; }
      try { node.port.close(); } catch (failure) { error ||= failure; }
      if (error) { error.retainedProducer = { node, context, retirementId }; reject(error); } else resolve(Object.freeze(receipt));
    };
    const changed = () => { if (context.state === 'closed') complete(null, { stage: 'closed-context', acousticReceipt: false }); };
    const timer = setTimeout(() => complete(new Error('Owned processor state retirement acknowledgement timed out.')), timeoutMs);
    node.port.onmessage = event => {
      const data = event.data;
      if (data?.type !== 'processor-retired' || data.retirementId !== retirementId) return;
      if (data.protocol !== 1 || data.retirementProtocol !== 1 || data.stage !== 'processor-state-released' || !Number.isSafeInteger(data.frame) || data.frame < 0 || data.renderingContinues !== false) return complete(new Error('Invalid owned processor retirement receipt.'));
      complete(null, { stage: data.stage, frame: data.frame, retirementId, renderingContinues: false, acousticReceipt: false });
    };
    try { context.addEventListener?.('statechange', changed); node.port.postMessage({ type: 'retire-processor', protocol: 1, retirementProtocol: 1, retirementId }); changed(); }
    catch (error) { complete(error); }
  });
}
