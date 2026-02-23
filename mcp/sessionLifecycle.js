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
