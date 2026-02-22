const sessions = new Map();

const getSession = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
};

export { getSession, sessions };
