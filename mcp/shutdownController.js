const resolveMaybePromise = async (fn) => {
  if (typeof fn !== 'function') return;
  return fn();
};

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
      if (logger && typeof logger.error === 'function') {
        logger.error(`[mcp] graceful shutdown failed on ${signal}`, error);
      }
      process.exitCode = 1;
    });
  };

  return { shutdown, handleSignal };
};

export { createShutdownController };
