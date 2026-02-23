const noop = () => {};

const closeSafely = async (target, methodName) => {
  if (!target || typeof target[methodName] !== 'function') return;
  try {
    await target[methodName]();
  } catch (error) {
    // Ignore close failures during teardown.
  }
};

const invokeHookSafely = async (hook, session) => {
  if (typeof hook !== 'function') return;
  try {
    await hook(session);
  } catch (error) {
    // Ignore hook failures during teardown.
  }
};

/**
 * Dispose runtime resources associated with a single MCP session.
 * Hook failures and close failures are intentionally ignored so teardown can
 * progress and preserve the original caller error context.
 *
 * @param {any} session
 * @param {{
 *   stopSpectatorServer?: (session: any) => (void|Promise<void>),
 *   stopWatchLoop?: (session: any) => (void|Promise<void>)
 * }} [hooks]
 * @returns {Promise<void>}
 */
const disposeSessionRuntime = async (
  session,
  {
    stopSpectatorServer = noop,
    stopWatchLoop = noop
  } = {}
) => {
  if (!session) return;
  await invokeHookSafely(stopSpectatorServer, session);
  await invokeHookSafely(stopWatchLoop, session);
  session.resources?.clearSession?.(session.id);
  await closeSafely(session.context, 'close');
  await closeSafely(session.browser, 'close');
};

/**
 * Dispose runtime resources for all provided sessions.
 *
 * @param {Iterable<any>} sessions
 * @param {{
 *   stopSpectatorServer?: (session: any) => (void|Promise<void>),
 *   stopWatchLoop?: (session: any) => (void|Promise<void>)
 * }} [hooks]
 * @returns {Promise<void>}
 */
const disposeAllSessionRuntimes = async (
  sessions,
  {
    stopSpectatorServer = noop,
    stopWatchLoop = noop
  } = {}
) => {
  const list = Array.from(sessions || []);
  for (const session of list) {
    await disposeSessionRuntime(session, {
      stopSpectatorServer,
      stopWatchLoop
    });
  }
};

export { disposeAllSessionRuntimes, disposeSessionRuntime };
