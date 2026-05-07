const resolveMaybePromise = async (fn) => {
  if (typeof fn !== 'function') return;
  return fn();
};

/**
 * Build an idempotent shutdown controller for MCP runtime teardown.
 *
 * @param {{
 *   disposeSessions?: (() => (void|Promise<void>)),
 *   closeServer?: (() => (void|Promise<void>)),
 *   closeTransport?: (() => (void|Promise<void>)),
 *   logger?: { error?: (...args: unknown[]) => void }
 * }} [options]
 * @returns {{
 *   shutdown: (reason?: string) => Promise<void>,
 *   handleSignal: (signal: string) => void
 * }}
 */
const createShutdownController = ({
  disposeSessions,
  closeServer,
  closeTransport,
  logger = console
} = {}) => {
  let shutdownPromise = null;

  const shutdown = async (reason = 'shutdown') => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      const failures = [];
      const runStep = async (name, fn) => {
        try {
          await resolveMaybePromise(fn);
        } catch (error) {
          failures.push({ name, error });
        }
      };
      await runStep('disposeSessions', disposeSessions);
      await runStep('closeServer', closeServer);
      await runStep('closeTransport', closeTransport);
      if (failures.length) {
        const summary = failures.map(({ name }) => name).join(', ');
        const aggregate = new AggregateError(
          failures.map(({ error }) => error),
          `MCP shutdown failed (${reason}): ${summary}`
        );
        aggregate.failures = failures;
        throw aggregate;
      }
    })();
    return shutdownPromise;
  };

  const handleSignal = (signal) => {
    void shutdown(signal).catch((error) => {
      process.exitCode = 1;
      if (logger && typeof logger.error === 'function') {
        try {
          logger.error(`[mcp] graceful shutdown failed on ${signal}`, error);
        } catch {
          // Logger failures should not mask shutdown errors.
        }
      }
    });
  };

  return { shutdown, handleSignal };
};

export { createShutdownController };
