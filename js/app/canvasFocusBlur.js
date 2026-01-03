const blurActiveInput = () => {
  const active = document.activeElement;
  if (!active) return;
  const tag = active.tagName;
  if (active.isContentEditable ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA') {
    active.blur?.();
    if (document.body) {
      document.body.tabIndex = -1;
      document.body.focus?.({ preventScroll: true });
    }
    if (document.activeElement === active) {
      window.setTimeout?.(() => {
        if (document.activeElement === active) {
          active.blur?.();
        }
      }, 0);
    }
  }
};

const bindCanvasFocusBlur = (canvas) => {
  if (!canvas) return;
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
    blurActiveInput();
  };
  document.addEventListener('pointerdown', handler, { capture: true });
  document.addEventListener('mousedown', handler, { capture: true });
  document.addEventListener('touchstart', handler, { capture: true, passive: true });
  document.addEventListener('click', handler, { capture: true });
  canvas.addEventListener('pointerdown', handler, { capture: true });
  canvas.addEventListener('mousedown', handler, { capture: true });
  canvas.addEventListener('touchstart', handler, { capture: true, passive: true });
  canvas.addEventListener('click', handler, { capture: true });
};

export { bindCanvasFocusBlur };
