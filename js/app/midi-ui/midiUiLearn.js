/**
 * @param {{
 *   runMidiIntent?: (intent: {type: string, target?: string, value?: unknown}) => void,
 *   setNoteCapture?: (handler: ((captured: unknown) => boolean) | null) => void,
 *   getIntentState?: () => {learn?: {target?: string|null}} | null
 * }} [options]
 * @returns {{
 *   armMidiLearn: (target: string, onCapture: (captured: unknown) => boolean | void) => boolean,
 *   disarmMidiLearn: (target?: string | null) => boolean,
 *   clearNoteCapture: () => void
 * }}
 */
const createMidiLearnController = ({
  runMidiIntent,
  setNoteCapture,
  getIntentState
} = {}) => {
  const learnHandlers = new Map();

  const armMidiLearn = (target, onCapture) => {
    if (!target || typeof onCapture !== 'function') return false;
    const targetKey = String(target);
    learnHandlers.clear();
    learnHandlers.set(targetKey, onCapture);
    runMidiIntent?.({ type: 'learn.arm', target: targetKey });
    setNoteCapture?.((captured) => {
      const active = getIntentState?.()?.learn?.target || null;
      const handler = active ? learnHandlers.get(active) : null;
      if (typeof handler !== 'function') return false;
      const consumed = handler(captured);
      if (consumed !== false) {
        runMidiIntent?.({ type: 'learn.capture', value: captured });
        learnHandlers.delete(active);
        runMidiIntent?.({ type: 'learn.disarm', target: active });
        setNoteCapture?.(null);
        return true;
      }
      return false;
    });
    return true;
  };

  const disarmMidiLearn = (target = null) => {
    const active = getIntentState?.()?.learn?.target || null;
    if (target && active && String(target) !== active) return false;
    learnHandlers.clear();
    runMidiIntent?.({ type: 'learn.disarm', target: target ? String(target) : null });
    setNoteCapture?.(null);
    return true;
  };

  const clearNoteCapture = () => {
    disarmMidiLearn();
  };

  return {
    armMidiLearn,
    disarmMidiLearn,
    clearNoteCapture
  };
};

export { createMidiLearnController };
