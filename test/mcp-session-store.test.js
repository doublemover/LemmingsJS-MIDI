import { expect } from 'chai';
import { getSession, normalizeSessionId, sessions } from '../mcp/sessionStore.js';

describe('mcp session store', function () {
  beforeEach(function () {
    sessions.clear();
  });

  afterEach(function () {
    sessions.clear();
  });

  it('resolves an existing session by id', function () {
    const session = { id: 'abc123' };
    sessions.set('abc123', session);
    expect(getSession('abc123')).to.equal(session);
  });

  it('normalizes non-string ids before lookup', function () {
    const session = { id: '7' };
    sessions.set('7', session);
    expect(getSession(7)).to.equal(session);
  });

  it('trims surrounding whitespace from ids before lookup', function () {
    const session = { id: 'alpha' };
    sessions.set('alpha', session);
    expect(getSession('  alpha  ')).to.equal(session);
  });

  it('throws when id is missing or session does not exist', function () {
    expect(() => getSession('')).to.throw('Session id is required');
    expect(() => getSession(null)).to.throw('Session id is required');
    expect(() => getSession('missing')).to.throw('Session not found: missing');
  });

  it('normalizes ids with trimming and null handling', function () {
    expect(normalizeSessionId('  abc  ')).to.equal('abc');
    expect(normalizeSessionId(7)).to.equal('7');
    expect(normalizeSessionId(null)).to.equal('');
  });
});
