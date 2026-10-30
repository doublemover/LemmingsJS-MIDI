export function createProcgenShareView({ document, window, getDescriptor, getExportDescriptor, prepareExport, onPrepared } = {}) {
  let active = null, disposed = false;
  const open = () => {
    if (disposed) return false;
    if (active) { active.focus(); return true; }
    const previousFocus = document.activeElement, dialog = document.createElement('dialog');
    const node = (tag, text, id) => { const element = document.createElement(tag); if (text) element.textContent = text; if (id) element.id = id; return element; };
    const heading = node('h2', 'Share this performance'), recipeHeading = node('h3', 'Copy starting recipe link');
    const scope = node('p'), omitted = node('p'), cameraLabel = node('label'), camera = node('input', '', 'procgenShareCamera');
    const url = node('input', '', 'procgenShareUrl'), copy = node('button', 'Copy link'), status = node('output', '', 'procgenShareStatus');
    const exportHeading = node('h3', 'Export this performance'), exportScope = node('p'), exportOmitted = node('p');
    const prepare = node('button', 'Prepare performance file'), close = node('button', 'Close');
    dialog.className = 'procgen-share-dialog'; dialog.setAttribute('aria-label', 'Share this performance');
    camera.type = 'checkbox'; cameraLabel.append(camera, node('span', 'Include current camera view'));
    url.type = 'text'; url.readOnly = true; url.setAttribute('aria-label', 'Shareable starting recipe URL');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    for (const button of [copy, prepare, close]) button.type = 'button';
    copy.className = 'procgen-share-primary';
    dialog.append(heading, recipeHeading, scope, omitted, cameraLabel, url, copy, exportHeading, exportScope, exportOmitted, prepare, status, close);
    document.body.append(dialog);
    let recipe = null, exportSource = null, copyPending = false, exportPending = false, closed = false, backdropPointer = null;
    const controller = new AbortController();
    const current = () => !disposed && !closed && active?.dialog === dialog;
    const buttons = () => { copy.disabled = !recipe || copyPending || exportPending; camera.disabled = copyPending || exportPending; prepare.disabled = !exportSource?.available || exportPending || copyPending; };
    const showRecipe = descriptor => {
      recipe = descriptor; url.value = descriptor.url; url.hidden = false;
      scope.textContent = descriptor.scene ? `Starts the original authored scene “${descriptor.scene.title}”, revision ${descriptor.scene.version}, with ${descriptor.worldOptions.laneCount} lanes. The recipient needs its exact build, scene and assets; these are checked before loading. Later edits and the current performance are excluded.` :
        `Starts a new generated world with ${descriptor.worldOptions.laneCount} lanes. Source compatibility is unverified on the recipient's build; this link does not certify exact replay.`;
      omitted.textContent = `Not included: ${descriptor.omitted.join('; ')}.`;
      buttons();
    };
    const recipeError = error => {
      recipe = null; url.value = ''; url.hidden = true; scope.textContent = error?.message || String(error);
      omitted.textContent = 'Use a project checkpoint or selected take archive to preserve authored performance state.'; buttons();
    };
    const refreshRecipe = () => { try { showRecipe(getDescriptor({ includeCamera: camera.checked === true })); } catch (error) { recipeError(error); } };
    const refreshExport = () => {
      try { exportSource = getExportDescriptor?.() || null; }
      catch (error) { exportSource = { available: false, scope: error.message }; }
      exportScope.textContent = exportSource?.title ? `${exportSource.title}. ${exportSource.scope}` : exportSource?.scope || 'Performance export is available in the workstation.';
      exportOmitted.textContent = exportSource?.omitted || 'MIDI and audio files alone do not preserve the physical performance. External assets may need a separate package.';
      buttons();
    };
    const finish = ({ prepared = false } = {}) => {
      if (closed) return;
      closed = true; controller.abort(); if (active?.dialog === dialog) active = null;
      try { dialog.close?.(); } finally {
        dialog.remove();
        if (!disposed && previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true });
      }
      if (prepared && !disposed) onPrepared?.();
    };
    active = { dialog, finish, focus: () => (recipe ? copy : close).focus?.() };
    camera.addEventListener('change', () => { status.textContent = ''; refreshRecipe(); });
    copy.addEventListener('click', async () => {
      if (!current() || !recipe || copyPending || exportPending) return;
      try {
        const latest = getDescriptor({ includeCamera: camera.checked === true });
        if (latest.recipeIdentity !== recipe.recipeIdentity) { showRecipe(latest); status.textContent = 'The committed world changed. Review the updated starting recipe, then choose Copy link again.'; return; }
      } catch (error) { recipeError(error); return; }
      copyPending = true; buttons(); status.textContent = 'Copying starting recipe link…';
      const reviewedUrl = recipe.url;
      try {
        if (!window.navigator?.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
        await window.navigator.clipboard.writeText(reviewedUrl);
        if (current()) status.textContent = 'Starting recipe link copied. Edits, takes, assets and output permissions are excluded.';
      } catch {
        if (current()) { status.textContent = 'Clipboard access failed. Select this read-only URL and press Ctrl+C (Windows/Linux) or Command+C (macOS).'; url.focus?.(); url.select?.(); }
      } finally { if (current()) { copyPending = false; buttons(); } }
    });
    prepare.addEventListener('click', async () => {
      if (!current() || !exportSource?.available || exportPending || copyPending) return;
      exportPending = true; buttons(); status.textContent = 'Preparing the reviewed performance source…';
      try {
        const artifact = await prepareExport(exportSource, { signal: controller.signal });
        if (current()) {
          if (!artifact?.retained) throw new Error('The source changed before preparation finished. Review and prepare again.');
          finish({ prepared: true });
        }
      } catch (error) { if (current()) { status.textContent = `Could not prepare performance: ${error.message}`; refreshExport(); } }
      finally { if (current()) { exportPending = false; buttons(); } }
    });
    const outside = event => { const bounds = dialog.getBoundingClientRect?.(); return event.target === dialog && bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom); };
    dialog.addEventListener('pointerdown', event => { backdropPointer = event.isPrimary !== false && (event.button ?? 0) === 0 && outside(event) ? event.pointerId : null; });
    dialog.addEventListener('pointerup', event => { if (backdropPointer == null || event.pointerId !== backdropPointer) return; backdropPointer = null; if (outside(event)) finish(); });
    dialog.addEventListener('pointercancel', event => { if (event.pointerId === backdropPointer) backdropPointer = null; });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); }); dialog.addEventListener('close', () => finish()); close.addEventListener('click', () => finish());
    refreshRecipe(); refreshExport();
    try { dialog.showModal(); active.focus(); } catch { finish(); return false; }
    return true;
  };
  return Object.freeze({ open, dispose() { if (disposed) return; disposed = true; active?.finish(); } });
}
