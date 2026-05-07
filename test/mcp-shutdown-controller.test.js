import { expect } from 'chai';
import { createShutdownController } from '../mcp/shutdownController.js';

describe('mcp shutdown controller', function () {
  it('runs shutdown steps once and in order for repeated calls', async function () {
    const calls = [];
    let disposed = 0;
    let closedServer = 0;
    let closedTransport = 0;
    const controller = createShutdownController({
      disposeSessions: async () => {
        disposed += 1;
        calls.push('dispose');
      },
      closeServer: async () => {
        closedServer += 1;
        calls.push('server');
      },
      closeTransport: async () => {
        closedTransport += 1;
        calls.push('transport');
      }
    });

    await Promise.all([
      controller.shutdown('SIGINT'),
      controller.shutdown('SIGTERM'),
      controller.shutdown('manual')
    ]);

    expect(disposed).to.equal(1);
    expect(closedServer).to.equal(1);
    expect(closedTransport).to.equal(1);
    expect(calls).to.deep.equal(['dispose', 'server', 'transport']);
  });

  it('sets process exit code and logs when shutdown fails', async function () {
    const loggerCalls = [];
    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    const controller = createShutdownController({
      disposeSessions: async () => {
        throw new Error('boom');
      },
      logger: {
        error: (...args) => loggerCalls.push(args)
      }
    });

    controller.handleSignal('SIGINT');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(process.exitCode).to.equal(1);
    expect(loggerCalls.length).to.equal(1);
    expect(String(loggerCalls[0][0])).to.include('SIGINT');
    process.exitCode = originalExitCode;
  });

  it('still sets exit code when logger.error throws', async function () {
    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    const controller = createShutdownController({
      disposeSessions: async () => {
        throw new Error('boom');
      },
      logger: {
        error: () => {
          throw new Error('logger boom');
        }
      }
    });

    controller.handleSignal('SIGTERM');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(process.exitCode).to.equal(1);
    process.exitCode = originalExitCode;
  });
});
