const createSessionToolHandlers = ({
  schemas,
  chromium,
  ResourceStore,
  EventQueue,
  WatchPollingController,
  sessions,
  normalizeSessionId,
  getSession,
  disposeSessionRuntime,
  loadKeybindings,
  pollWatches,
  startSpectatorServer,
  stopSpectatorServer,
  stopWatchLoop,
  createProtocolMetadata,
  attachEvents,
  defaults,
  makeId
}) => {
  const { SessionCloseSchema, SessionCreateSchema } = schemas;
  const { DEFAULT_BASE_URL, DEFAULT_PATH, DEFAULT_VIEWPORT } = defaults;

  const createSession = async (args) => {
    const options = SessionCreateSchema.parse(args || {});
    const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    const pathName = options.path || DEFAULT_PATH;
    const gameUrl = new URL(pathName, baseUrl).toString();
    const headless = options.headless !== false;
    const viewport = options.viewport || DEFAULT_VIEWPORT;
    const sessionId = makeId();
  
    let browser = null;
    let context = null;
    let page = null;
    let session = null;
    let keybindings = null;
    try {
      browser = await chromium.launch({
        headless,
        args: ['--allow-insecure-localhost']
      });
  
      context = await browser.newContext({
        viewport: {
          width: viewport.width,
          height: viewport.height
        },
        deviceScaleFactor: Number.isFinite(viewport.deviceScaleFactor) ? viewport.deviceScaleFactor : 1,
        ignoreHTTPSErrors: true
      });
  
      page = await context.newPage();
      keybindings = await loadKeybindings();
  
      session = {
        id: sessionId,
        browser,
        context,
        page,
        baseUrl,
        gameUrl,
        keybindings,
        resources: new ResourceStore(options.resources || {}),
        events: new EventQueue(options.events || {}),
        eventsMode: options.events?.mode || 'minimal',
        lastStateTick: null,
        editorObjectListCache: new Map(),
        watches: new Map(),
        watchController: null,
        spectator: null
      };
  
      session.watchController = new WatchPollingController({
        hasWatchesFn: () => session.watches.size > 0,
        pollFn: () => pollWatches(session)
      });
  
      sessions.set(sessionId, session);
  
      page.on('pageerror', (error) => {
        session.events.add({
          source: 'system',
          type: 'error',
          summary: 'pageerror',
          data: { message: error?.message || String(error) }
        });
      });
  
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          session.events.add({
            source: 'system',
            type: 'error',
            summary: 'console error',
            data: { message: msg.text() }
          });
        }
      });
  
      await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => window.__E2E__?.getState?.().ready === true,
        null,
        { timeout: 30000 }
      );
  
      if (options.enableSpectator) {
        await startSpectatorServer(session, options.spectator || {});
      }
    } catch (err) {
      sessions.delete(sessionId);
      if (session) {
        await disposeSessionRuntime(session, {
          stopSpectatorServer,
          stopWatchLoop
        });
      } else {
        await Promise.allSettled([
          context?.close?.(),
          browser?.close?.()
        ]);
      }
      throw err;
    }
  
    const actions = Object.keys(keybindings?.bindings || {}).sort();
    const response = {
      ok: true,
      sessionId,
      protocol: createProtocolMetadata(),
      gameUrl,
      spectatorUrl: session.spectator?.url || null,
      spectatorStream: session.spectator?.streamConfig || null,
      keybindings: {
        version: keybindings?.version || 1,
        actions
      },
      warnings: []
    };
  
    if (options.spectator?.openBrowser) {
      response.warnings.push('spectator.openBrowser is unsupported in this server version');
    }
  
    return attachEvents(session, response);
  };
  
  const closeSession = async (args) => {
    const { sessionId } = SessionCloseSchema.parse(args || {});
    const session = getSession(sessionId);
    await disposeSessionRuntime(session, {
      stopSpectatorServer,
      stopWatchLoop
    });
    sessions.delete(normalizeSessionId(sessionId));
    return { ok: true };
  };
  

  return { createSession, closeSession };
};

export { createSessionToolHandlers };
