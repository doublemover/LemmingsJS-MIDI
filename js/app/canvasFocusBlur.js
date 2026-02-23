const boundCanvasHandlers = new WeakMap();

const blurActiveInput = (documentRef, windowRef) => {
  const active = documentRef?.activeElement;
  if (!active) return;
  const tag = active.tagName;
  if (active.isContentEditable ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA') {
    active.blur?.();
    if (documentRef?.body) {
      documentRef.body.tabIndex = -1;
      documentRef.body.focus?.({ preventScroll: true });
    }
    if (documentRef?.activeElement === active) {
      windowRef?.setTimeout?.(() => {
        if (documentRef?.activeElement === active) {
          active.blur?.();
        }
      }, 0);
    }
  }
};

/**
 * Bind canvas interactions that blur active form elements so gameplay input is
 * not trapped by focused controls. Returns a cleanup function for teardown.
 */
const bindCanvasFocusBlur = (canvas, { documentRef = globalThis.document, windowRef = globalThis.window } = {}) => {
  if (!canvas) return;
  const existingCleanup = boundCanvasHandlers.get(canvas);
  if (existingCleanup) {
    return existingCleanup;
  }
  if (!documentRef?.addEventListener || !canvas.addEventListener) {
    return () => {};
  }
  canvas.dataset.focusBlurBound = 'true';
  const handler = (event) => {
    const target = event?.target;
    const tag = target?.tagName;
    if (target?.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        tag === 'TEXTAREA') {
      return;
    }
    blurActiveInput(documentRef, windowRef);
  };
  documentRef.addEventListener('pointerdown', handler, { capture: true });
  documentRef.addEventListener('mousedown', handler, { capture: true });
  documentRef.addEventListener('touchstart', handler, { capture: true, passive: true });
  documentRef.addEventListener('click', handler, { capture: true });
  canvas.addEventListener('pointerdown', handler, { capture: true });
  canvas.addEventListener('mousedown', handler, { capture: true });
  canvas.addEventListener('touchstart', handler, { capture: true, passive: true });
  canvas.addEventListener('click', handler, { capture: true });
  const cleanup = () => {
    documentRef.removeEventListener?.('pointerdown', handler, { capture: true });
    documentRef.removeEventListener?.('mousedown', handler, { capture: true });
    documentRef.removeEventListener?.('touchstart', handler, { capture: true });
    documentRef.removeEventListener?.('click', handler, { capture: true });
    canvas.removeEventListener?.('pointerdown', handler, { capture: true });
    canvas.removeEventListener?.('mousedown', handler, { capture: true });
    canvas.removeEventListener?.('touchstart', handler, { capture: true });
    canvas.removeEventListener?.('click', handler, { capture: true });
    if (canvas.dataset) {
      delete canvas.dataset.focusBlurBound;
    }
    boundCanvasHandlers.delete(canvas);
  };
  boundCanvasHandlers.set(canvas, cleanup);
  return cleanup;
};

export { bindCanvasFocusBlur };
