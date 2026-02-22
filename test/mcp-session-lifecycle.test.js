import { expect } from 'chai';
import { disposeAllSessionRuntimes, disposeSessionRuntime } from '../mcp/sessionLifecycle.js';

const createSession = (id) => {
  const calls = [];
  const session = {
    id,
    resources: {
      clearSession(sessionId) {
        calls.push(`clear:${sessionId}`);
      }
    },
    context: {
      async close() {
        calls.push('context.close');
      }
    },
    browser: {
      async close() {
        calls.push('browser.close');
      }
    }
  };
  return { session, calls };
};

describe('session lifecycle disposal', function () {
  it('disposes spectator/watch hooks and closes browser resources', async function () {
    const { session, calls } = createSession('s1');
    const hookCalls = [];
    await disposeSessionRuntime(session, {
      stopSpectatorServer(target) {
        hookCalls.push(`spectator:${target.id}`);
      },
      stopWatchLoop(target) {
        hookCalls.push(`watch:${target.id}`);
      }
    });

    expect(hookCalls).to.deep.equal(['spectator:s1', 'watch:s1']);
    expect(calls).to.deep.equal(['clear:s1', 'context.close', 'browser.close']);
  });

  it('continues cleanup when close methods throw', async function () {
    const { session, calls } = createSession('s2');
    session.context.close = async () => {
      calls.push('context.close');
      throw new Error('context fail');
    };
    session.browser.close = async () => {
      calls.push('browser.close');
      throw new Error('browser fail');
    };

    await disposeSessionRuntime(session);
    expect(calls).to.deep.equal(['clear:s2', 'context.close', 'browser.close']);
  });

  it('disposes all sessions from an iterable', async function () {
    const first = createSession('a');
    const second = createSession('b');
    await disposeAllSessionRuntimes([first.session, second.session]);

    expect(first.calls).to.include.members(['clear:a', 'context.close', 'browser.close']);
    expect(second.calls).to.include.members(['clear:b', 'context.close', 'browser.close']);
  });
});
