/** Live MCP session registry keyed by normalized session id. */
const sessions = new Map();

/**
 * Normalize incoming session ids for stable map lookups.
 *
 * @param {unknown} sessionId
 * @returns {string}
 */
const normalizeSessionId = (sessionId) => (
  sessionId == null ? '' : String(sessionId).trim()
);

/**
 * Resolve a live MCP session by id.
 *
 * @param {string} sessionId
 * @returns {any}
 * @throws {Error} When the id is missing or the session does not exist.
 */
const getSession = (sessionId) => {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    throw new Error('Session id is required');
  }
  const session = sessions.get(normalizedSessionId);
  if (!session) {
    throw new Error(`Session not found: ${normalizedSessionId}`);
  }
  return session;
};

export { getSession, normalizeSessionId, sessions };
