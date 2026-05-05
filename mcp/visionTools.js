const createVisionToolHandlers = ({
  schemas,
  getSession,
  callE2E,
  getTickIndex,
  attachEvents,
  formatToMime,
  makeId,
  nowIso,
  maxCaptureSequenceFrames
}) => {
  const { VisionCaptureSchema, VisionSequenceSchema } = schemas;
  const MCP_MAX_CAPTURE_SEQUENCE_FRAMES = maxCaptureSequenceFrames;

  const resolveCanvasMetrics = async (session) => {
    const result = await callE2E(session, 'getCanvasMetrics');
    return result.ok ? result.value : null;
  };
  
  const resolveCanvasClip = (metrics, target, rect) => {
    if (!metrics) return null;
    const scaleX = metrics.rect.width / metrics.size.width;
    const scaleY = metrics.rect.height / metrics.size.height;
  
    let base = null;
    if (target === 'gameCanvas' && metrics.gameRect) {
      base = metrics.gameRect;
    } else if (target === 'guiCanvas' && metrics.guiRect) {
      base = metrics.guiRect;
    } else if (target === 'stageCanvas') {
      base = null;
    }
  
    const baseCss = base
      ? {
        x: base.x * scaleX,
        y: base.y * scaleY,
        width: base.width * scaleX,
        height: base.height * scaleY
      }
      : { x: 0, y: 0, width: metrics.rect.width, height: metrics.rect.height };
  
    const clip = rect
      ? {
        x: baseCss.x + rect.x,
        y: baseCss.y + rect.y,
        width: rect.width,
        height: rect.height
      }
      : baseCss;
  
    return {
      clip: {
        x: metrics.rect.x + clip.x,
        y: metrics.rect.y + clip.y,
        width: clip.width,
        height: clip.height
      },
      width: clip.width,
      height: clip.height
    };
  };
  
  const captureFrame = async (session, options) => {
    const target = options.target || 'page';
    const rect = options.rect || null;
    const format = options.format || 'png';
    const quality = Number.isFinite(options.quality)
      ? Math.max(1, Math.min(100, Math.trunc(options.quality)))
      : null;
    const delivery = options.delivery || 'resource';
    const tag = options.tag || null;
    const mimeType = formatToMime(format);
  
    let clip = null;
    let width = null;
    let height = null;
  
    if (target === 'rect') {
      if (!rect) return { ok: false, reason: 'rect_required' };
      clip = rect;
      width = rect?.width ?? null;
      height = rect?.height ?? null;
    } else if (target === 'gameCanvas' || target === 'guiCanvas' || target === 'stageCanvas') {
      const metrics = await resolveCanvasMetrics(session);
      if (!metrics) return { ok: false, reason: 'canvas_missing' };
      const resolved = resolveCanvasClip(metrics, target, rect);
      clip = resolved?.clip || null;
      width = resolved?.width ?? null;
      height = resolved?.height ?? null;
    } else if (rect) {
      clip = rect;
      width = rect.width;
      height = rect.height;
    } else {
      const viewport = session.page.viewportSize();
      width = viewport?.width ?? null;
      height = viewport?.height ?? null;
    }
  
    if (clip && (!Number.isFinite(clip.width) || !Number.isFinite(clip.height) || clip.width <= 0 || clip.height <= 0)) {
      return { ok: false, reason: 'invalid_clip' };
    }
  
    const screenshotOptions = {
      type: format
    };
    if (quality != null && (format === 'jpeg' || format === 'webp')) {
      screenshotOptions.quality = quality;
    }
    if (clip) {
      screenshotOptions.clip = clip;
    }
  
    const bytes = await session.page.screenshot(screenshotOptions);
    const sizeBytes = bytes.length;
    const tickIndex = await getTickIndex(session);
  
    const frame = {
      id: makeId(),
      mimeType,
      width: Math.round(width ?? 0),
      height: Math.round(height ?? 0),
      tickIndex: Number.isFinite(tickIndex) ? tickIndex : null,
      takenAt: nowIso(),
      target,
      tag: tag || undefined
    };
    if (rect) {
      frame.clip = rect;
    }
  
    if (delivery === 'inline') {
      frame.dataBase64 = Buffer.from(bytes).toString('base64');
      return { ok: true, frame };
    }
  
    const stored = session.resources.put({
      sessionId: session.id,
      bytes,
      mimeType,
      meta: { kind: 'capture', target, tag }
    });
    if (!stored?.uri) {
      return { ok: false, reason: 'resource_store_failed' };
    }
    frame.resourceUri = stored?.uri;
    frame.sizeBytes = sizeBytes;
    if (stored?.expiresAt) {
      frame.expiresAt = stored.expiresAt;
    }
    return { ok: true, frame };
  };
  
  const captureSequence = async (session, args) => {
    const frames = [];
    const sequenceId = makeId();
    const mode = args.mode;
    const stepBy = Number.isFinite(args.stepBy) ? args.stepBy : 1;
    const everyMs = Number.isFinite(args.everyMs) ? args.everyMs : 250;
    const capture = args.capture || {};
    const requestedFrames = Number.isFinite(args.frames) ? Math.trunc(args.frames) : 1;
    const total = Math.min(MCP_MAX_CAPTURE_SEQUENCE_FRAMES, Math.max(1, requestedFrames));
  
    if (mode === 'step') {
      await callE2E(session, 'pause');
    }
  
    for (let i = 0; i < total; i += 1) {
      const result = await captureFrame(session, capture);
      if (!result?.ok || !result?.frame) {
        return {
          ok: false,
          sequenceId,
          reason: result?.reason || 'capture_failed',
          failedAtFrame: i,
          frames
        };
      }
      frames.push(result.frame);
      if (i === total - 1) break;
      if (mode === 'step') {
        await callE2E(session, 'step', stepBy);
      } else {
        await session.page.waitForTimeout(everyMs);
      }
    }
  
    let manifestResourceUri = null;
    if (args.returnManifest !== false) {
      const manifest = {
        sequenceId,
        createdAt: nowIso(),
        frames
      };
      const stored = session.resources.put({
        sessionId: session.id,
        bytes: Buffer.from(JSON.stringify(manifest)),
        mimeType: 'application/json',
        meta: { kind: 'capture-manifest' }
      });
      if (!stored?.uri) {
        return {
          ok: false,
          sequenceId,
          reason: 'resource_store_failed',
          failedAtFrame: total,
          frames
        };
      }
      manifestResourceUri = stored?.uri || null;
    }
  
    session.events.add({
      source: 'agent',
      type: 'capture',
      summary: `captureSequence:${sequenceId}`,
      resourceUris: manifestResourceUri ? [manifestResourceUri] : undefined
    });
  
    return {
      ok: true,
      sequenceId,
      frames,
      manifestResourceUri
    };
  };

  const visionCaptureTool = async (args) => {
    const options = VisionCaptureSchema.parse(args || {});
    const session = getSession(options.sessionId);
    const result = await captureFrame(session, options);
    if (!result.ok) {
      return attachEvents(session, { ok: false, reason: result.reason });
    }
    session.events.add({
      source: 'agent',
      type: 'capture',
      summary: 'capture',
      resourceUris: result.frame?.resourceUri ? [result.frame.resourceUri] : undefined
    });
    return attachEvents(session, { frame: result.frame });
  };
  
  const visionSequenceTool = async (args) => {
    const options = VisionSequenceSchema.parse(args || {});
    const session = getSession(options.sessionId);
    const result = await captureSequence(session, options);
    return attachEvents(session, result);
  };

  return {
    captureFrame,
    captureSequence,
    resolveCanvasMetrics,
    visionCaptureTool,
    visionSequenceTool
  };
};

export { createVisionToolHandlers };
