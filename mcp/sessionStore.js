const sessions = new Map();

/**
 * Resolve a live MCP session by id.
 *
 * @param {string} sessionId
 * @returns {any}
 * @throws {Error} When the id is missing or the session does not exist.
 */
const getSession = (sessionId) => {
  const normalizedSessionId = sessionId == null ? '' : String(sessionId);
  if (!normalizedSessionId) {
    throw new Error('Session id is required');
  }
  const session = sessions.get(normalizedSessionId);
  if (!session) {
    throw new Error(`Session not found: ${normalizedSessionId}`);
  }
  return session;
};

export { getSession, sessions };
